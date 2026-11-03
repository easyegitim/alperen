"""Gerçek adaptörler — httpx.MockTransport ile (ağ yok): istek biçimi, yanıt ayrıştırma, hata eşlemesi."""

from __future__ import annotations

import base64
import json
from pathlib import Path

import httpx
import pytest

from conftest import FIXTURES
from ogrenmen_common.adapters.anthropic import AnthropicLLM
from ogrenmen_common.adapters.arxiv import ArxivScholar, parse_atom
from ogrenmen_common.adapters.base import LLMRequest, Media, gte, in_, is_null, not_null
from ogrenmen_common.adapters.cfai import CloudflareAILLM
from ogrenmen_common.adapters.crossref import CrossrefResolver
from ogrenmen_common.adapters.gemini import GeminiEmbedding, GeminiLLM
from ogrenmen_common.adapters.groq import GroqLLM, seconds_to_ts
from ogrenmen_common.adapters.notify import LogNotifier, format_notice
from ogrenmen_common.adapters.openalex import OpenAlexScholar, abstract_from_index, strip_doi
from ogrenmen_common.adapters.openrouter import OpenRouterLLM
from ogrenmen_common.adapters.postgrest import MESSAGES_COLUMNS, PostgrestDb, filter_params, order_param
from ogrenmen_common.adapters.router import ProviderRouter
from ogrenmen_common.adapters.semanticscholar import SemanticScholar
from ogrenmen_common.adapters.storage import SupabaseStorage
from ogrenmen_common.adapters.structured import api_model, parse_json_text
from ogrenmen_common.adapters.unpaywall import UnpaywallResolver
from ogrenmen_common.errors import AdapterError, DbError, DbPermissionError, RpcError, StorageError
from ogrenmen_common.fakes import FakeLLM

QUERY = {"queries": ["aralıklı tekrar", "spaced repetition", "kesir öğrenimi"]}


class Recorder:
    def __init__(self, *responses):
        self.responses = list(responses)
        self.requests: list[httpx.Request] = []

    def __call__(self, request):
        self.requests.append(request)
        r = self.responses.pop(0) if len(self.responses) > 1 else self.responses[0]
        if isinstance(r, Exception):
            raise r
        return r

    def transport(self):
        return httpx.MockTransport(self)


def _req(**kw):
    base = {"purpose": "query_expand", "model": "gemini-2.5-flash-lite@free", "prompt": "aralıklı tekrar",
            "system": "Sorguları genişlet.", "schema_id": "query-expand", "max_tokens": 300}
    base.update(kw)
    return LLMRequest(**base)


def test_gemini_request_and_response():
    rec = Recorder(httpx.Response(200, json={"candidates": [{"content": {"parts": [{"text": json.dumps(QUERY)}]}}],
                                             "usageMetadata": {"promptTokenCount": 40, "candidatesTokenCount": 12}}))
    llm = GeminiLLM("key-x", provider_id="gemini-free", transport=rec.transport())
    res = llm.complete(_req(media=(Media(b"\x89PNG", "image/png"),)))
    req = rec.requests[0]
    assert req.url.path.endswith("/models/gemini-2.5-flash-lite:generateContent")
    assert req.headers["x-goog-api-key"] == "key-x" and "key=" not in str(req.url)
    body = json.loads(req.content)
    assert body["systemInstruction"]["parts"][0]["text"] == "Sorguları genişlet."
    assert body["contents"][0]["parts"][1]["inline_data"] == {"mime_type": "image/png",
                                                              "data": base64.b64encode(b"\x89PNG").decode()}
    cfg = body["generationConfig"]
    assert cfg["responseMimeType"] == "application/json" and cfg["responseSchema"]["type"] == "object"
    assert cfg["maxOutputTokens"] == 300
    assert res.ok and res.json == QUERY and (res.tokens_in, res.tokens_out, res.images) == (40, 12, 1)


@pytest.mark.parametrize("status,error", [(429, "rate_limited"), (503, "server"), (401, "config"), (400, "config")])
def test_gemini_error_mapping(status, error):
    rec = Recorder(httpx.Response(status, headers={"retry-after": "7"}, json={"error": {}}))
    res = GeminiLLM("k", transport=rec.transport()).complete(_req())
    assert not res.ok and res.error == error and res.status == status
    if status == 429:
        assert res.retry_after_ms == 7000


def test_gemini_timeout_and_empty():
    res = GeminiLLM("k", transport=Recorder(httpx.ReadTimeout("yavaş")).transport()).complete(_req())
    assert res.error == "timeout"
    blocked = GeminiLLM("k", transport=Recorder(httpx.Response(200, json={"promptFeedback": {
        "blockReason": "SAFETY"}})).transport()).complete(_req())
    assert blocked.error == "bad_output" and "SAFETY" in blocked.error_detail
    with pytest.raises(AdapterError):
        GeminiLLM("")


def test_gemini_embedding_normalizes():
    rec = Recorder(httpx.Response(200, json={"embeddings": [{"values": [3.0, 4.0]}, {"values": [0.0, 2.0]}]}))
    vecs = GeminiEmbedding("k", model="gemini-embedding-001", dims=2, transport=rec.transport()).embed(["a", "b"])
    assert vecs == [[0.6, 0.8], [0.0, 1.0]]
    body = json.loads(rec.requests[0].content)
    assert body["requests"][0]["outputDimensionality"] == 2
    assert body["requests"][1]["content"]["parts"][0]["text"] == "b"
    assert rec.requests[0].url.path.endswith("/models/gemini-embedding-001:batchEmbedContents")
    with pytest.raises(AdapterError):
        GeminiEmbedding("k", model="gemini-embedding-001", dims=2,
                        transport=Recorder(httpx.Response(200, json={"embeddings": []})).transport()).embed(["a"])
    with pytest.raises(TypeError):  # model adı koda gömülü varsayılan değil (§4.9): models.json'dan verilir
        GeminiEmbedding("k")  # type: ignore[call-arg]


def _chat_ok(text, pt=10, ct=5):
    return httpx.Response(200, json={"choices": [{"message": {"content": text}}],
                                     "usage": {"prompt_tokens": pt, "completion_tokens": ct}})


def test_openai_compatible_json_schema_then_fallback():
    rec = Recorder(httpx.Response(400, json={"error": "json_schema desteklenmiyor"}), _chat_ok(json.dumps(QUERY)))
    res = GroqLLM("gk", transport=rec.transport()).complete(_req(model="llama-3.3-70b-versatile"))
    first, second = (json.loads(r.content) for r in rec.requests)
    assert first["response_format"]["type"] == "json_schema" and first["response_format"]["json_schema"]["name"]
    assert second["response_format"] == {"type": "json_object"}
    assert "JSON şemasına uygun" in second["messages"][-1]["content"]
    assert first["messages"][0] == {"role": "system", "content": "Sorguları genişlet."}
    assert rec.requests[0].headers["authorization"] == "Bearer gk"
    assert res.ok and res.json == QUERY and (res.tokens_in, res.tokens_out) == (10, 5)


def test_openrouter_headers_and_fenced_json():
    rec = Recorder(_chat_ok("```json\n" + json.dumps(QUERY) + "\n```"))
    res = OpenRouterLLM("ok", transport=rec.transport()).complete(_req(model="meta-llama/llama-3.3-70b-instruct:free"))
    assert rec.requests[0].headers["x-title"] == "Ogrenmen" and res.json == QUERY
    assert json.loads(rec.requests[0].content)["model"] == "meta-llama/llama-3.3-70b-instruct:free"


def test_groq_whisper_transcription_returns_unlabeled_segments():
    rec = Recorder(httpx.Response(200, json={"duration": 19.6, "segments": [
        {"start": 0.0, "end": 2.1, "text": " Bugün kesirler."}, {"start": 61.5, "end": 64.0, "text": " Tamam."}]}))
    res = GroqLLM("gk", transport=rec.transport()).complete(LLMRequest(
        purpose="transcribe", model="whisper-large-v3-turbo", prompt="", media=(Media(b"RIFF", "audio/wav", "a.wav"),)))
    assert rec.requests[0].url.path.endswith("/audio/transcriptions")
    assert b'name="model"' in rec.requests[0].content and b"whisper-large-v3-turbo" in rec.requests[0].content
    assert res.json == {"unlabeled": True, "segments": [
        {"t": "00:00:00", "t_end": "00:00:02", "text": "Bugün kesirler."},
        {"t": "00:01:01", "t_end": "00:01:04", "text": "Tamam."}]}
    assert res.audio_sec == 20 and seconds_to_ts(3725) == "01:02:05"


def test_cloudflare_ai_object_response():
    rec = Recorder(httpx.Response(200, json={"success": True, "result": {"response": QUERY, "usage": {
        "prompt_tokens": 9, "completion_tokens": 3}}}))
    llm = CloudflareAILLM("t", "acc1", transport=rec.transport())
    res = llm.complete(_req(model="@cf/meta/llama-3.3-70b-instruct-fp8-fast"))
    assert rec.requests[0].url.path == "/client/v4/accounts/acc1/ai/run/@cf/meta/llama-3.3-70b-instruct-fp8-fast"
    assert res.json == QUERY and res.tokens_in == 9
    assert llm.complete(_req(media=(Media(b"x", "image/png"),))).error == "config"


def test_anthropic_embeds_schema():
    rec = Recorder(httpx.Response(200, json={"content": [{"type": "text", "text": json.dumps(QUERY)}],
                                             "usage": {"input_tokens": 50, "output_tokens": 20}}))
    res = AnthropicLLM("ak", transport=rec.transport()).complete(_req(model="claude-sonnet-4-5"))
    body = json.loads(rec.requests[0].content)
    assert rec.requests[0].headers["anthropic-version"] == "2023-06-01" and body["system"] == "Sorguları genişlet."
    assert "JSON şemasına uygun" in body["messages"][0]["content"][0]["text"]
    assert res.json == QUERY and (res.tokens_in, res.tokens_out) == (50, 20)


def test_router_dispatch_and_availability():
    import ogrenmen_contracts as contracts

    models = contracts.load_models()
    fake = FakeLLM()
    router = ProviderRouter(models, {"gemini-free": fake, "anthropic": fake})
    assert router.available("gemini-2.5-flash@free") and not router.available("gemini-2.5-flash")
    assert not router.available("claude-sonnet-4-5")  # models.json enabled=false
    assert router.complete(_req(model="gemini-2.5-flash-lite@free")).ok
    assert router.complete(_req(model="gemini-2.5-pro")).error == "config"
    assert api_model("gemini-2.5-flash@free") == "gemini-2.5-flash" and api_model("@cf/x") == "@cf/x"
    assert parse_json_text("değil json") is None


def test_openalex_s2_arxiv_normalization_over_transport():
    oa_fix = json.loads((FIXTURES / "kitap" / "openalex-search.json").read_text(encoding="utf-8"))
    rec = Recorder(httpx.Response(200, json=oa_fix))
    recs = OpenAlexScholar(mailto="ops@example.org", transport=rec.transport()).search("aralıklı", limit=2)
    assert rec.requests[0].url.params["mailto"] == "ops@example.org" and len(recs) == 2
    assert recs[0].doi == "10.1037/0033-2909.132.3.354" and recs[0].venue == "Psychological Bulletin"
    assert strip_doi("https://doi.org/10.1/x") == "10.1/x" and abstract_from_index({"b": [1], "a": [0]}) == "a b"
    s2_fix = json.loads((FIXTURES / "kitap" / "s2-search.json").read_text(encoding="utf-8"))
    rec2 = Recorder(httpx.Response(200, json=s2_fix))
    s2 = SemanticScholar(api_key="s2", transport=rec2.transport()).search("q")
    assert rec2.requests[0].headers["x-api-key"] == "s2" and s2[0].tldr.startswith("Aralıklı")
    atom = """<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom" xmlns:arxiv="http://arxiv.org/schemas/atom">
      <entry><id>http://arxiv.org/abs/2401.00001v1</id><published>2024-01-02T00:00:00Z</published>
      <title> Spaced  practice
      in algebra </title><summary>Özet.</summary><author><name>A. Yazar</name></author>
      <link title="pdf" href="https://arxiv.org/pdf/2401.00001v1" type="application/pdf"/>
      <arxiv:primary_category term="math.HO"/></entry></feed>"""
    parsed = parse_atom(atom)
    assert parsed == [{"arxiv_id": "2401.00001v1", "doi": None, "title": "Spaced practice in algebra",
                       "authors": ["A. Yazar"], "published": "2024-01-02",
                       "pdf_url": "https://arxiv.org/pdf/2401.00001v1", "summary": "Özet.",
                       "primary_category": "math.HO"}]
    ax = ArxivScholar(transport=Recorder(httpx.Response(200, text=atom)).transport()).search("q")
    assert ax[0].year == 2024 and ax[0].oa_pdf_url.endswith("2401.00001v1") and ax[0].source == "arxiv"
    with pytest.raises(AdapterError):
        parse_atom("<bozuk")
    assert ArxivScholar().base.startswith("https://export.arxiv.org/")


@pytest.mark.parametrize("hostile", [
    # billion laughs (iç varlık genişlemesi)
    '<?xml version="1.0"?><!DOCTYPE lolz [<!ENTITY lol "lol"><!ENTITY lol2 "&lol;&lol;&lol;">]>'
    '<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>&lol2;</title></entry></feed>',
    # XXE (dış varlık)
    '<?xml version="1.0"?><!DOCTYPE feed [<!ENTITY xxe SYSTEM "file:///etc/passwd">]>'
    '<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>&xxe;</title></entry></feed>',
    # yalnız DTD
    '<?xml version="1.0"?><!DOCTYPE feed><feed xmlns="http://www.w3.org/2005/Atom"></feed>',
])
def test_arxiv_rejects_dtd_and_entities(hostile):
    with pytest.raises(AdapterError, match="DTD"):
        parse_atom(hostile)


def test_crossref_and_unpaywall():
    ok = json.loads((FIXTURES / "kitap" / "crossref-ok.json").read_text(encoding="utf-8"))
    doi = "10.1007/s11251-007-9015-8"
    rec = Recorder(httpx.Response(200, json=ok[doi]))
    assert CrossrefResolver(transport=rec.transport()).resolve(doi)["DOI"] == doi
    assert rec.requests[0].url.path == f"/works/{doi}"
    assert CrossrefResolver(transport=Recorder(httpx.Response(404)).transport()).resolve("10.9999/fake") is None
    assert CrossrefResolver(transport=Recorder(httpx.ReadTimeout("t")).transport()).resolve("10.1/x") is None
    with pytest.raises(AdapterError):
        CrossrefResolver(transport=Recorder(httpx.Response(403)).transport()).resolve("10.1/x")
    # Kesinti (5xx) "çözülemedi" değildir: yeniden denenir, düzelmezse hata — gerçek atıf düşürülmez.
    outage = Recorder(httpx.Response(503), httpx.Response(502))
    with pytest.raises(AdapterError, match="HTTP 502"):
        CrossrefResolver(transport=outage.transport()).resolve(doi)
    assert len(outage.requests) == 2
    recovered = Recorder(httpx.Response(503), httpx.Response(200, json=ok[doi]))
    assert CrossrefResolver(transport=recovered.transport()).resolve(doi)["DOI"] == doi
    mixed = Recorder(httpx.ReadTimeout("t"), httpx.Response(500))
    with pytest.raises(AdapterError):
        CrossrefResolver(transport=mixed.transport()).resolve(doi)
    up = json.loads((FIXTURES / "kitap" / "unpaywall.json").read_text(encoding="utf-8"))
    rec2 = Recorder(httpx.Response(200, json=up[doi]))
    got = UnpaywallResolver(email="ops@example.org", transport=rec2.transport()).lookup(doi)
    assert got == {"doi": doi, "is_oa": True, "pdf_url": "https://example.org/oa/rohrer-2007.pdf"}
    assert rec2.requests[0].url.params["email"] == "ops@example.org"
    with pytest.raises(AdapterError):
        UnpaywallResolver(email="")


def test_postgrest_select_never_includes_text_raw():
    assert "text_raw" not in MESSAGES_COLUMNS
    source = (Path(__file__).parents[1] / "src" / "ogrenmen_common" / "adapters" / "postgrest.py").read_text(
        encoding="utf-8")
    block = source[source.index("MESSAGES_COLUMNS: tuple"):source.index('"""batch_worker')]
    assert "text_raw" not in block  # statik test (§6 kural 5)
    rec = Recorder(httpx.Response(200, json=[{"id": 1}]))
    db = PostgrestDb("https://proj.example.org", "jwt-x", anon_key="anon", transport=rec.transport())
    db.select("messages", where={"chat_id": 5, "answered_at": is_null()}, order="-sent_at", limit=10)
    params = dict(rec.requests[0].url.params.multi_items())
    assert params["select"] == ",".join(MESSAGES_COLUMNS) and "text_raw" not in str(rec.requests[0].url)
    assert params["chat_id"] == "eq.5" and params["answered_at"] == "is.null" and params["order"] == "sent_at.desc"
    assert rec.requests[0].headers["authorization"] == "Bearer jwt-x" and rec.requests[0].headers["apikey"] == "anon"
    with pytest.raises(DbPermissionError):
        db.select("messages", columns=["id", "text_raw"])
    with pytest.raises(DbPermissionError):
        db.select("messages", columns=["*"])
    for sneaky in ("raw:text_raw", "text_raw::text", "raw:text_raw::varchar", " text_raw ", '"text_raw"'):
        with pytest.raises(DbPermissionError, match="text_raw"):
            db.select("messages", columns=["id", sneaky])
    with pytest.raises(DbPermissionError):
        db.select("secure.answer_keys")
    assert len(rec.requests) == 1  # reddedilenler ağa hiç gitmedi


def test_postgrest_filters_writes_and_rpc_errors():
    assert filter_params({"status": in_(["a", "b c"]), "x": gte(3), "y": not_null(), "z": True, "w": ["q"]}) == [
        ("status", 'in.(a,"b c")'), ("x", "gte.3"), ("y", "not.is.null"), ("z", "eq.true"), ("w", "in.(q)")]
    assert order_param(["-a", "b", "c.desc"]) == "a.desc,b.asc,c.desc"
    rec = Recorder(httpx.Response(201, json=[{"id": 9}]), httpx.Response(200, json=[{"id": 9}]),
                   httpx.Response(400, json={"code": "P0001", "message": "OGR-KEY-003 anahtar kilitli"}),
                   httpx.Response(204), httpx.Response(404, json={"message": "Could not find the function"}))
    db = PostgrestDb("https://p.example.org/", "j", transport=rec.transport())
    assert db.insert("llm_calls", {"purpose": "ocr"}, on_conflict="ignore") == [{"id": 9}]
    assert rec.requests[0].headers["prefer"] == "return=representation,resolution=ignore-duplicates"
    assert db.update("lessons", {"status": "analyzed"}, where={"id": "l1"}, returning="representation") == [{"id": 9}]
    assert rec.requests[1].method == "PATCH" and rec.requests[1].url.params["id"] == "eq.l1"
    assert rec.requests[1].headers["prefer"] == "return=representation"
    with pytest.raises(RpcError, match="OGR-KEY-003") as exc:
        db.rpc("register_answer_key", {"p_question": "q"})
    assert exc.value.code == "OGR-KEY-003" and rec.requests[2].url.path == "/rest/v1/rpc/register_answer_key"
    assert db.rpc("set_runtime_flag", {"p_key": "x", "p_value": False}) is None
    with pytest.raises(RpcError, match="OGR-RPC-001"):
        db.rpc("yok_boyle", {})
    with pytest.raises(DbError):
        db.update("lessons", {"status": "x"}, where={})


def test_supabase_storage():
    rec = Recorder(httpx.Response(200, json={"Key": "figures/a.png"}), httpx.Response(200, content=b"PNG"),
                   httpx.Response(200, json=[]), httpx.Response(404))
    st = SupabaseStorage("https://p.example.org", "jwt", transport=rec.transport())
    assert st.upload("figures", "a.png", b"PNG", content_type="image/png") == "figures/a.png"
    assert rec.requests[0].headers["x-upsert"] == "true"
    assert rec.requests[0].url.path == "/storage/v1/object/figures/a.png"
    assert st.download("exams", "e.pdf") == b"PNG"
    st.remove("transcripts", "t/1.jsonl")
    assert json.loads(rec.requests[2].content) == {"prefixes": ["t/1.jsonl"]}
    assert st.exists("figures", "b.png") is False
    assert st.public_url("figures", "a.png") == "https://p.example.org/storage/v1/object/public/figures/a.png"
    with pytest.raises(StorageError):
        SupabaseStorage("", "jwt")


def test_log_notifier_writes_formatted_notice_to_stream():
    import io

    buf = io.StringIO()
    LogNotifier(buf).notify("Ekim: 12,4 $ / 24 $ (%52)!", level="warning")
    assert buf.getvalue() == "[bildirim] Dikkat · Ekim: 12,4 $ / 24 $ (%52).\n"


def test_format_notice_rules():
    assert format_notice("a\nb\nc\nd\ne") == "Bilgi · a\nb\nc\nd"  # en çok 4 satır
    assert "!" not in format_notice("Merhaba!") and "\U0001F600" not in format_notice("tamam \U0001F600")
    with pytest.raises(ValueError):
        format_notice("x", level="kritik")
    with pytest.raises(ValueError):
        format_notice("   ")


@pytest.mark.live
def test_live_openalex_smoke():
    assert OpenAlexScholar().search("spaced repetition", limit=1)
