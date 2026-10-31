"""CostLedger: zincir düşüşü, tavan kapısı (iki bütçe), şema onarımı, yapılandırma hatası, maliyet, tahmin."""

from __future__ import annotations

import json

import pytest

from conftest import as_admin, read_jsonl
from ogrenmen_common.adapters.base import LLMRequest
from ogrenmen_common.errors import LedgerError
from ogrenmen_common.fakes import FakeEmbedding, FakeLLM, FakeNotifier
from ogrenmen_common.ledger import CostLedger, LedgeredEmbedding


def _req(purpose, schema, prompt="istem"):
    return LLMRequest(purpose=purpose, model="", prompt=prompt, schema_id=schema)


def test_price_formula(ledger):
    assert ledger.price("gemini-2.5-flash-lite", 1800, 160) == pytest.approx(0.000244)
    assert ledger.price("gemini-2.5-flash-lite", 1800, 160, batch=True) == pytest.approx(0.000122)
    assert ledger.price("whisper-large-v3-turbo", 0, 0, audio_sec=3600) == pytest.approx(0.04)
    assert ledger.price("llama-3.3-70b-versatile", 10_000, 10_000) == 0
    with pytest.raises(LedgerError, match="OGR-LLM-003"):
        ledger.price("gpt-yok", 1, 1)


def test_success_writes_llm_calls_and_spend(db, ledger, out):
    res = ledger.call("nightly_facts", _req("nightly_facts", "nightly-facts-output"), student_ref="s_qk7m2rx4tn5a",
                      ref_table="messages", ref_id="24")
    assert res.model == "gemini-2.5-flash-lite" and res.provider == "gemini-paid" and res.data["facts"] is not None
    row = db.written("llm_calls")[-1]
    assert row["status"] == "ok" and row["student_ref"] == "s_qk7m2rx4tn5a" and row["ref_id"] == "24"
    assert row["cost_usd"] == ledger.price("gemini-2.5-flash-lite", row["tokens_in"], row["tokens_out"]) > 0
    assert res.attempts[0]["status"] == "ok" and set(res.attempts[0]) == {
        "provider", "model", "status", "tokens_in", "tokens_out", "cost_usd", "latency_ms", "error_code"}
    db.flush()
    assert read_jsonl(out / "llm_calls.jsonl")[-1]["purpose"] == "nightly_facts"
    led = next(r for r in db.tables["spend_ledger"] if r["day"] == "2026-10-20" and r["purpose"] == "nightly_facts")
    assert led["cost_usd"] == row["cost_usd"]


def test_rate_limit_falls_back_and_cools_down_provider(db, clock):
    llm = FakeLLM(fail_with={429: [0]})
    ledger = CostLedger(db, llm, clock=clock)
    res = ledger.call("vision_check", _req("vision_check", "figure-render-report"))
    assert [a["status"] for a in res.attempts] == ["rate_limited", "ok"]
    assert res.model == "gemini-2.5-flash" and res.attempts[0]["error_code"] == "http_429"
    second = ledger.call("vision_check", _req("vision_check", "figure-render-report", "başka"))
    assert [a["status"] for a in second.attempts] == ["cooldown_skip", "ok"]
    assert len(llm.calls) == 3  # bekleyen sağlayıcı çağrılmadı
    health = next(r for r in db.tables["provider_health"] if r["provider"] == "gemini-free")
    assert health["consecutive_errors"] == 1 and health["cooldown_until"] == "2026-10-20T09:01:00Z"
    clock.advance(minutes=2)
    assert ledger.call("vision_check", _req("vision_check", "figure-render-report")).model == "gemini-2.5-flash@free"


def test_server_and_timeout_errors_are_logged_then_next(db, clock):
    ledger = CostLedger(db, FakeLLM(fail_with={500: [0], "timeout": [1]}), clock=clock)
    with pytest.raises(LedgerError, match="OGR-LLM-001") as exc:
        ledger.call("vision_check", _req("vision_check", "figure-render-report"))
    assert [(a["status"], a["error_code"]) for a in exc.value.attempts] == [("error", "http_500"), ("timeout", None)]


def test_cap_blocks_paid_and_never_calls_model(db, clock):
    db.rpc("set_runtime_flag", {"p_key": "paid_llm_enabled", "p_value": False})
    llm = FakeLLM()
    ledger = CostLedger(db, llm, clock=clock)
    with pytest.raises(LedgerError, match="OGR-LLM-002") as exc:
        ledger.call("nightly_facts", _req("nightly_facts", "nightly-facts-output"))
    assert [a["status"] for a in exc.value.attempts] == ["cap_blocked"] and llm.calls == []
    assert db.written("llm_calls")[-1]["status"] == "cap_blocked" and db.written("llm_calls")[-1]["cost_usd"] == 0
    free = ledger.call("vision_check", _req("vision_check", "figure-render-report"))
    assert free.model == "gemini-2.5-flash@free"  # ücretsiz katman çalışmaya devam eder


def test_lesson_budget_is_separate(db, clock):
    db.insert("llm_calls", {"purpose": "chat", "provider": "gemini-paid", "model": "gemini-2.5-flash-lite",
                            "status": "ok", "cost_usd": 0.9})
    ledger = CostLedger(db, FakeLLM(), clock=clock)
    with pytest.raises(LedgerError, match="OGR-LLM-002"):
        ledger.call("nightly_facts", _req("nightly_facts", "nightly-facts-output"))
    lesson = ledger.call("lesson_analysis", _req("lesson_analysis", "lesson-analysis"), ref_table="lessons")
    assert lesson.model == "gemini-2.5-pro" and lesson.cost_usd > 0
    assert db.rpc("check_spend", {"p_purpose": "chat"})[0]["day_usd"] == pytest.approx(0.9)
    with as_admin(db):
        db.update("runtime_flags", {"value": 0.0001}, where={"key": "lesson_monthly_cap_usd"})
    ledger.invalidate_gate()
    with pytest.raises(LedgerError, match="OGR-LLM-002"):
        ledger.call("lesson_analysis", _req("lesson_analysis", "lesson-analysis"))


def test_schema_repair_once_then_next_model(db, clock):
    ledger = CostLedger(db, FakeLLM(bad_output_at=[0]), clock=clock)
    res = ledger.call("weekly_summary", _req("weekly_summary", "weekly-summary"))
    assert res.repaired and [a["status"] for a in res.attempts] == ["bad_output", "ok"]
    assert res.attempts[0]["cost_usd"] > 0  # bozuk yanıtın tokenları da ödenir
    llm = FakeLLM(bad_output_at=[0, 1])
    res2 = CostLedger(db, llm, clock=clock).call("question_gen", _req("question_gen", "question-generation"))
    assert [a["status"] for a in res2.attempts] == ["bad_output", "bad_output", "ok"]
    assert res2.model == "gemini-2.5-flash" and "Önceki yanıtın şemaya uymadı" in llm.calls[1].prompt_text
    with pytest.raises(LedgerError, match="OGR-LLM-001"):
        CostLedger(db, FakeLLM(bad_output_every=1), clock=clock).call("weekly_summary",
                                                                      _req("weekly_summary", "weekly-summary"))


def test_config_error_notifies_and_disables_provider(db, clock):
    notifier = FakeNotifier(echo=False)
    llm = FakeLLM(fail_with={401: [0]})
    ledger = CostLedger(db, llm, clock=clock, notifier=notifier)
    res = ledger.call("transcribe", _req("transcribe", "transcript"))
    assert [(a["status"], a["error_code"]) for a in res.attempts] == [("error", "config_401"), ("ok", None)]
    assert res.provider == "groq"
    assert notifier.sent and "gemini-free" in notifier.sent[0]["text"] and "!" not in notifier.sent[0]["text"]
    ledger.call("transcribe", _req("transcribe", "transcript"))
    assert [c.model for c in llm.calls] == ["gemini-2.5-flash@free", "whisper-large-v3-turbo",
                                            "whisper-large-v3-turbo"]


def test_unavailable_models_are_skipped_silently(db, clock):
    class OnlyGroq(FakeLLM):
        def available(self, model):
            return model.startswith("whisper")

    ledger = CostLedger(db, OnlyGroq(), clock=clock)
    res = ledger.call("transcribe", _req("transcribe", "transcript"))
    assert [a["model"] for a in res.attempts] == ["whisper-large-v3-turbo"]


def test_student_ref_and_purpose_guards(ledger):
    with pytest.raises(LedgerError, match="student_ref"):
        ledger.call("nightly_facts", _req("nightly_facts", "nightly-facts-output"),
                    student_ref="c661b28c-81a8-5c11-9a5e-b919b5231034")
    with pytest.raises(LedgerError, match="OGR-LLM-003"):
        ledger.call("sohbet", _req("sohbet", None))
    with pytest.raises(LedgerError, match="OGR-LLM-003"):
        ledger.call("research", _req("research", "research-output"), chain="yok")


def test_plain_text_and_custom_validator(ledger):
    text = ledger.call("query_expand", LLMRequest(purpose="query_expand", model="", prompt="p"))
    assert json.loads(text.text) == text.data  # şemasız çağrı: sağlayıcının ayrıştırdığı JSON ya da düz metin
    calls = []

    def only_three(data):
        calls.append(data)
        return [] if len(data["queries"]) >= 3 else ["az sorgu"]

    res = ledger.call("query_expand", LLMRequest(purpose="query_expand", model="", prompt="p"), validator=only_three)
    assert calls and res.data["queries"]


def test_estimate_separates_lesson_costs(ledger, out):
    ledger.call("nightly_facts", _req("nightly_facts", "nightly-facts-output"))
    ledger.call("lesson_analysis", _req("lesson_analysis", "lesson-analysis"))
    est = json.loads(ledger.write_estimate(out).read_text(encoding="utf-8"))
    assert est["dry_run"] is True and est["calls_ok"] == 2 and est["attempts"] == 2
    assert est["lesson_usd"] == est["by_purpose"]["lesson_analysis"]["cost_usd"] > 0
    assert est["chat_batch_usd"] == pytest.approx(est["by_purpose"]["nightly_facts"]["cost_usd"])
    assert est["total_usd"] == pytest.approx(est["lesson_usd"] + est["chat_batch_usd"])
    assert est["by_status"] == {"ok": 2} and est["models_verified_at"] == "2026-10-19"


def test_cf_ai_neurons_counted(db, clock):
    ledger = CostLedger(db, FakeLLM(), clock=clock)
    ledger.record("chat", provider="cf-ai", model="@cf/meta/llama-3.3-70b-instruct-fp8-fast", status="ok",
                  tokens_in=1000, tokens_out=1000)
    assert ledger.estimate()["cf_ai_neurons"] == pytest.approx(5.8)


def test_without_db_everything_allowed():
    ledger = CostLedger(None, FakeLLM())
    assert ledger.gate("chat")["paid_allowed"] is True
    assert ledger.call("query_expand", _req("query_expand", "query-expand")).data["queries"]
    assert ledger.calls[0]["status"] == "ok"


def _degrade(db):
    db.rpc("set_runtime_flag", {"p_key": "degraded_mode", "p_value": True})


@pytest.mark.parametrize("purpose,schema", [("nightly_facts", "nightly-facts-output"),
                                            ("vision_check", "figure-render-report"),  # ücretsiz zincir de durur
                                            ("lesson_analysis", "lesson-analysis")])  # ders amacı da (istisna yok)
def test_degraded_mode_calls_no_model(db, clock, purpose, schema):
    """§5.6 ``degraded`` = "LLM yok": tavanın altında olsa da hiçbir model çağrılmaz; tek cap_blocked satırı."""
    _degrade(db)
    gate = db.rpc("check_spend", {"p_purpose": purpose})[0]
    assert gate["state"] == "degraded" and gate["degraded"] is True and gate["paid_allowed"] is True
    llm = FakeLLM()
    ledger = CostLedger(db, llm, clock=clock)
    before = len(db.written("llm_calls"))
    with pytest.raises(LedgerError, match="OGR-LLM-002 degraded") as exc:
        ledger.call(purpose, _req(purpose, schema))
    assert llm.calls == []
    rows = db.written("llm_calls")[before:]
    assert len(rows) == 1 and rows[0]["status"] == "cap_blocked" and rows[0]["error_code"] == "degraded"
    assert rows[0]["cost_usd"] == 0 and [a["status"] for a in exc.value.attempts] == ["cap_blocked"]


def test_degraded_state_alone_also_blocks(clock):
    class Gate:
        def __init__(self):
            self.inserted = []

        def rpc(self, name, params):
            return [{"paid_allowed": True, "degraded": False, "state": "degraded"}]

        def insert(self, table, row):
            self.inserted.append(row)
            return [row]

        def select(self, *a, **k):
            return []

    db = Gate()
    llm = FakeLLM()
    with pytest.raises(LedgerError, match="degraded"):
        CostLedger(db, llm, clock=clock).call("chat", _req("chat", None))
    assert llm.calls == [] and [r["status"] for r in db.inserted] == ["cap_blocked"]


def test_ledgered_embedding_records_each_batch(db, clock):
    ledger = CostLedger(db, FakeLLM(), clock=clock)
    emb = LedgeredEmbedding(FakeEmbedding(), ledger, ref_table="library_chunks")
    assert emb.dims == 768 and emb.model == "gemini-embedding-001" and emb.provider == "gemini-paid"
    vecs = emb.embed(["birinci parça", "ikinci parça"])
    assert vecs == FakeEmbedding().embed(["birinci parça", "ikinci parça"])
    row = db.written("llm_calls")[-1]
    assert (row["purpose"], row["provider"], row["model"], row["status"], row["ref_table"]) == (
        "embedding", "gemini-paid", "gemini-embedding-001", "ok", "library_chunks")
    assert row["tokens_in"] == sum((len(t) + 3) // 4 for t in ["birinci parça", "ikinci parça"])
    assert emb.embed([]) == [] and len(db.written("llm_calls")) == 1  # boş çağrı satır yazmaz
    with pytest.raises(TypeError):
        emb.embed("tek metin")


def test_ledgered_embedding_respects_cap_and_degraded(db, clock):
    inner = FakeEmbedding()
    db.rpc("set_runtime_flag", {"p_key": "paid_llm_enabled", "p_value": False})
    emb = LedgeredEmbedding(inner, CostLedger(db, FakeLLM(), clock=clock))
    with pytest.raises(LedgerError, match="OGR-LLM-002 tavan"):
        emb.embed(["x"])
    assert inner.calls == [] and db.written("llm_calls")[-1]["status"] == "cap_blocked"
    with as_admin(db):  # paid_llm_enabled batch_worker için tek yönlüdür; geri açmak koordinatör işi
        db.rpc("set_runtime_flag", {"p_key": "paid_llm_enabled", "p_value": True})
    _degrade(db)
    emb2 = LedgeredEmbedding(inner, CostLedger(db, FakeLLM(), clock=clock))
    with pytest.raises(LedgerError, match="degraded"):
        emb2.embed(["x"])
    assert inner.calls == [] and db.written("llm_calls")[-1]["error_code"] == "degraded"


def test_ledgered_embedding_logs_adapter_failure(db, clock):
    from ogrenmen_common.errors import AdapterError

    class Down:
        dims = 768

        def embed(self, texts):
            raise AdapterError("OGR-ADP-001 embedding başarısız: server 503")

    emb = LedgeredEmbedding(Down(), CostLedger(db, FakeLLM(), clock=clock))
    with pytest.raises(LedgerError, match="OGR-LLM-001 embedding"):
        emb.embed(["x"])
    assert db.written("llm_calls")[-1]["status"] == "error"
