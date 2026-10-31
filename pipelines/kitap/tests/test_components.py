"""Bileşen testleri: BibTeX/APA, Crossref kuralı, PDF sınırları, skor, kaynak seçimi, sözleşme, Zotero."""

from __future__ import annotations

import io
import json
import math
from types import SimpleNamespace

import httpx
import ogrenmen_contracts as contracts
import pytest
from ogrenmen_common.adapters.arxiv import ArxivScholar
from ogrenmen_common.adapters.base import ScholarRecord
from ogrenmen_common.errors import AdapterError
from ogrenmen_common.paths import llm_fixtures_root
from pypdf import PdfReader, PdfWriter

from conftest import KITAP, make_rt, only_fixture
from ogrenmen_kitap import bib, pdfs, search, synthesize, zotero
from ogrenmen_kitap import pipeline as P
from ogrenmen_kitap import verify as V
from ogrenmen_kitap.errors import KitapError
from ogrenmen_kitap.search import Candidate


def _cand(**kw) -> Candidate:  # noqa: ANN003
    base = {"title": "Spaced practice", "authors": ("Ayşe Yılmaz",), "year": 2020, "doi": None, "venue": "Dergi",
            "cited_by": 1, "sources": ["openalex"]}
    base.update(kw)
    return Candidate(**base)


def _checked(title: str, family: str, year: int, *, doi: str | None = "10.1000/x1", status: str = "verified",
             kind: str = "journal-article") -> V.Checked:
    return V.Checked(cand=_cand(title=title, doi=doi), crossref_status=status, kept=True, title=title,
                     authors=[{"family": family, "given": "Ali Veli"}], venue="Örnek Dergi", year=year, kind=kind,
                     title_similarity=0.99, verified_at="2026-10-20T09:00:00Z", ordinal=1)


# --- BibTeX / APA ----------------------------------------------------------------------------------


def test_bibtex_valid_and_keys_unique():
    cits = [_checked("Birinci çalışma", "Şahin", 2019, doi="10.1000/a"),
            _checked("İkinci çalışma {özel} & 50% $x_1$ #", "Şahin", 2019, doi="10.1000/b"),
            _checked("Üçüncü", "Öztürk", 2021, doi="10.1000/c")]
    text = bib.bibtex(cits)
    keys = bib.validate_bibtex(text, expected=3)
    assert keys == ["sahin2019a", "sahin2019b", "ozturk2021"]
    assert r"\{özel\} \& 50\% \$x\_1\$ \#" in text
    import bibtexparser

    lib = bibtexparser.parse_string(text)
    assert [e.fields_dict["doi"].value for e in lib.entries] == ["10.1000/a", "10.1000/b", "10.1000/c"]


def test_bibtex_validation_rejects_duplicate_keys_and_garbage():
    entry = "@article{ayni2020,\n  title = {A},\n  year = {2020}\n}\n"
    with pytest.raises(KitapError) as exc:
        bib.validate_bibtex(entry + entry)
    assert exc.value.code == "OGR-KITAP-007"
    with pytest.raises(KitapError):
        bib.validate_bibtex("@article{eksik,\n  title = {kapanmayan\n", expected=1)
    with pytest.raises(KitapError):
        bib.validate_bibtex(entry, expected=2)


def test_no_doi_entry_is_misc_with_url_and_eprint():
    c = _checked("Interleaved practice", "Yazar", 2025, doi=None, status="no_doi", kind="preprint")
    c.cand.sources = ["arxiv"]
    c.cand.external_ids = ["arXiv:2513.00042"]
    c.oa_pdf_url = "https://arxiv.org/pdf/2513.00042"
    text = bib.bibtex([c])
    assert text.startswith("@misc{yazar2025,") and "eprint = {2513.00042}" in text and "doi =" not in text
    assert bib.apa([c]) == ["Yazar, A. V. (2025). Interleaved practice. Örnek Dergi. https://arxiv.org/pdf/2513.00042"]


def test_apa_format_from_crossref_metadata():
    c = _checked("Distributed practice in verbal recall tasks.", "Cepeda", 2006, doi="10.1037/0033-2909.132.3.354")
    c.authors = [{"family": "Cepeda", "given": "Nicholas J."}, {"family": "Pashler", "given": "Harold"},
                 {"family": "Rohrer", "given": "Doug"}]
    assert bib.apa_entry(c) == ("Cepeda, N. J., Pashler, H., & Rohrer, D. (2006). Distributed practice in verbal "
                                "recall tasks. Örnek Dergi. https://doi.org/10.1037/0033-2909.132.3.354")


# --- Crossref kuralı -----------------------------------------------------------------------------


class Resolver:
    def __init__(self, messages):  # noqa: ANN001
        self.messages = messages
        self.calls: list[str] = []

    def resolve(self, doi):  # noqa: ANN001
        self.calls.append(doi)
        return self.messages.get(doi)


def test_title_similarity_floors_to_two_decimals():
    assert V.title_similarity("abc", "abc") == 1.0
    raw = V.title_similarity("Spaced practice in algebra homework", "Soil moisture dynamics in semi-arid grasslands")
    assert raw < 0.6 and round(raw, 2) == raw


def test_verified_uses_crossref_metadata_and_threshold():
    msg = {"title": ["Distributed practice in verbal recall tasks"], "author": [{"given": "N.", "family": "Cepeda"}],
           "container-title": ["Psychological Bulletin"], "issued": {"date-parts": [[2006]]},
           "type": "journal-article"}
    got = V.check_candidate(Resolver({"10.1/x": msg}), _cand(title="Distributed practice in verbal recall tasks: a "
                                                                   "review", doi="10.1/x", year=None),
                            now_iso="2026-10-20T09:00:00Z")
    assert got.kept and got.crossref_status == "verified" and got.year == 2006 and got.venue == "Psychological Bulletin"
    assert got.title == "Distributed practice in verbal recall tasks" and got.title_similarity >= 0.6
    assert got.authors_text == "Cepeda, N."
    missing = V.check_candidate(Resolver({}), _cand(doi="10.1/y"), now_iso="2026-10-20T09:00:00Z")
    assert (missing.kept, missing.reason, missing.crossref_status) == (False, "crossref_unresolved", "unresolved")
    no_year = V.check_candidate(Resolver({"10.1/z": {"title": ["Spaced practice"]}}), _cand(doi="10.1/z", year=None),
                                now_iso="2026-10-20T09:00:00Z")
    assert not no_year.kept and no_year.reason == "crossref_unresolved"


@pytest.mark.parametrize(("url", "kept"), [
    ("https://arxiv.org/pdf/2513.00042", True), ("https://dergipark.org.tr/tr/download/article-file/1", True),
    ("https://tez.yok.gov.tr/UlusalTezMerkezi/x.pdf", True), ("https://acikerisim.ornek.edu.tr/a.pdf", True),
    ("https://example.org/oa/x.pdf", False), ("https://evil-arxiv.org/x.pdf", False), ("ftp://arxiv.org/x", False),
    (None, False)])
def test_no_doi_needs_institutional_link(url, kept):
    got = V.check_candidate(Resolver({}), _cand(doi=None, oa_pdf_url=url), now_iso="2026-10-20T09:00:00Z")
    assert got.kept is kept and got.crossref_status == "no_doi"
    assert got.reason == (None if kept else "no_doi_no_link")


@pytest.mark.parametrize("year", [None, 1700, 2200])
def test_no_doi_with_link_but_without_valid_year_removed(year):
    got = V.check_candidate(Resolver({}), _cand(doi=None, year=year, oa_pdf_url="https://dergipark.org.tr/x.pdf"),
                            now_iso="2026-10-20T09:00:00Z")
    assert (got.kept, got.crossref_status, got.reason) == (False, "no_doi", "no_doi_no_link")


ATOM = """<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:arxiv="http://arxiv.org/schemas/atom">
  <entry>
    <id>http://arxiv.org/abs/2501.00001v1</id>
    <published>2025-01-02T00:00:00Z</published>
    <title>Interleaved practice in
      mathematics homework</title>
    <summary>Spaced and interleaved practice in mathematics homework.</summary>
    <author><name>Ayse Demir</name></author>
    <link href="http://arxiv.org/abs/2501.00001v1" rel="alternate" type="text/html"/>
    <link title="pdf" href="http://arxiv.org/pdf/2501.00001v1" rel="related" type="application/pdf"/>
    <arxiv:primary_category term="math.HO"/>
  </entry>
  <entry>
    <id>http://arxiv.org/abs/0601.00002v2</id>
    <published>2006-05-01T00:00:00Z</published>
    <title>Distributed practice in verbal recall tasks</title>
    <summary>Spaced repetition review.</summary>
    <author><name>Nicholas Cepeda</name></author>
    <arxiv:doi>10.1037/0033-2909.132.3.354</arxiv:doi>
    <link title="pdf" href="http://arxiv.org/pdf/0601.00002v2" rel="related" type="application/pdf"/>
  </entry>
</feed>
"""


def test_real_arxiv_adapter_mapping_through_gather_and_crossref(tmp_path):
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, text=ATOM, headers={"content-type": "application/atom+xml"})

    arx = ArxivScholar(transport=httpx.MockTransport(handler))
    records, errors = search.gather([arx], ["spaced repetition"])
    assert errors == [] and len(records) == 2
    assert seen[0].url.params["search_query"] == "all:spaced repetition"
    cands, dups = search.merge(records)
    assert dups == [] and len(cands) == 2
    rt = make_rt(tmp_path / "o")
    checked = {c.title: V.check_candidate(rt.doi, c, now_iso="2026-10-20T09:00:00Z") for c in cands}
    pre = checked["Interleaved practice in mathematics homework"]
    assert (pre.kept, pre.crossref_status, pre.oa_pdf_url) == (True, "no_doi", "http://arxiv.org/pdf/2501.00001v1")
    assert pre.year == 2025 and pre.cand.external_ids == ["arXiv:2501.00001v1"] and pre.kind == "preprint"
    assert "eprint = {2501.00001v1}" in bib.bibtex([pre])
    pub = checked["Distributed practice in verbal recall tasks"]
    assert pub.cand.doi == "10.1037/0033-2909.132.3.354" and pub.cand.doi in rt.doi.calls   # Crossref'e soruldu
    assert pub.kept and pub.crossref_status == "verified" and pub.year == 2006
    assert len(rt.doi.calls) == 1   # DOI'siz ön baskı Crossref'e gitmez

    def down(request: httpx.Request) -> httpx.Response:
        return httpx.Response(503)

    _, errs = search.gather([ArxivScholar(transport=httpx.MockTransport(down)), _Static(records[:1])], ["q"])
    assert errs and errs[0]["source"] == "arxiv"


class _Static:
    source = "openalex"

    def __init__(self, records):  # noqa: ANN001
        self.records, self.calls = records, []

    def search(self, query, *, limit=30):  # noqa: ANN001
        self.calls.append(query)
        return list(self.records)


def test_forbidden_word_in_tldr_dropped_from_citation():
    c = _checked("Aralıklı tekrar", "Ak", 2020, doi="10.1000/t")
    c.cand.tldr = "Bu yöntem başarıyı kesinlikle artırır."
    assert P.citation_json(c)["tldr"] is None
    c.cand.tldr = "Aralıklı tekrar uzun süreli hatırlamayı artırır."
    assert P.citation_json(c)["tldr"] == "Aralıklı tekrar uzun süreli hatırlamayı artırır."


def test_research_response_with_invalid_citations_still_used(tmp_path):
    llm = only_fixture(tmp_path, {"research": "01-spaced-repetition.json"})
    path = llm / "research" / "01-spaced-repetition.json"
    data = json.loads(path.read_text(encoding="utf-8"))
    del data["request_id"]   # model istek kimliğini bilmez
    data["citations"] = [{"ordinal": 1, "crossref_status": "verified", "title": "x"}]   # doi/verified_at yok
    path.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    assert contracts.errors("research-output", data)
    rt = make_rt(tmp_path / "o", llm_options={"root": llm})
    res = P.research(rt, "spaced repetition matematik", request_id=P.query_request_id("q"), require_enabled=False)
    research_calls = [c for c in rt.ledger.calls if c["purpose"] == "research"]
    assert research_calls and all(c["status"] == "ok" for c in research_calls)   # onarım çağrısı yok
    assert len(res.output["synthesis"]) == 2 and res.output["matrix"]
    assert all(c["title"] != "x" for c in res.output["citations"])   # modelin atıf listesi kullanılmadı
    assert synthesize.response_errors(data) == []
    assert synthesize.response_errors({"synthesis": []}) and synthesize.response_errors({"synthesis": [{"text": 1}]})
    assert "citations" in synthesize.SYSTEM and "[]" in synthesize.SYSTEM


def test_crossref_status_enum_rejects_unresolved(tmp_path):
    res = P.research(make_rt(tmp_path / "o"), "spaced repetition matematik", request_id=P.query_request_id("q"),
                     require_enabled=False)
    out = json.loads(json.dumps(res.output))
    contracts.validate("research-output", out)
    out["citations"][0]["crossref_status"] = "unresolved"
    assert contracts.errors("research-output", out)
    bad = json.loads((llm_fixtures_root() / "research" / "bad-schema.json").read_text(encoding="utf-8"))
    assert contracts.errors("research-output", bad)
    kept = [c for c in res.checked if c.kept]   # boru hattı tutulan listeye başka durum koymaz
    assert kept and all(c.crossref_status in ("verified", "no_doi") for c in kept)
    assert {c.crossref_status for c in res.checked if not c.kept} <= {"unresolved", "no_doi", "pending"}


# --- arama, skor -----------------------------------------------------------------------------------


def test_score_formula_and_order():
    a = _cand(title="spaced repetition in algebra", cited_by=99, year=2026, doi="10.1/a")
    b = _cand(title="unrelated topic entirely", cited_by=0, year=1990, doi="10.1/b")
    search.score([a, b], ["spaced repetition"], current_year=2026)
    # §6.5: 0.3·log(atıf+1)/log(max) — max = 99
    assert a.relevance == 1.0 and a.score == pytest.approx(0.5 + 0.3 * math.log(100) / math.log(99) + 0.2)
    assert b.relevance == 0.0 and b.score == pytest.approx(0.2 * (1 - 1.0))
    # max ≤ 1: log(max) sıfır/tanımsız → payda log 2 (bölme hatası yok)
    one, zero = _cand(title="x", cited_by=1, doi="10.1/c"), _cand(title="y", cited_by=0, doi="10.1/d")
    search.score([one, zero], ["z"], current_year=2020)
    assert one.score == pytest.approx(0.3 + 0.2) and zero.score == pytest.approx(0.2)
    lone = _cand(title="w", cited_by=0, doi="10.1/e")
    search.score([lone], ["z"], current_year=2020)
    assert lone.score == pytest.approx(0.2)
    assert [c.doi for c in search.top([b, a])] == ["10.1/a", "10.1/b"]
    many = [_cand(title=f"t{i:02d}", doi=f"10.1/{i}") for i in range(40)]
    assert len(search.top(search.score(many, ["x"], current_year=2026))) == 30


def test_merge_dedups_doi_and_flags_title_duplicates():
    recs = [ScholarRecord("Spaced practice", ("A B",), 2020, "https://doi.org/10.1000/ABC", "J", 5, "openalex"),
            ScholarRecord("Spaced practice", ("A B", "C D"), 2020, "10.1000/abc", None, 9, "semantic_scholar",
                          tldr="Kısa özet."),
            ScholarRecord("Spaced Practice", (), 2020, None, "arXiv", 0, "arxiv", oa_pdf_url="https://arxiv.org/pdf/1")]
    cands, dups = search.merge(recs)
    assert len(cands) == 1 and cands[0].doi == "10.1000/abc" and cands[0].cited_by == 9
    assert cands[0].sources == ["openalex", "semantic_scholar"] and cands[0].tldr == "Kısa özet."
    assert len(cands[0].authors) == 2 and [d.source for d in dups] == ["arxiv"]


def test_semantic_scholar_only_with_key_in_real_mode(tmp_path):
    rt = make_rt(tmp_path / "o")
    assert [s.source for s in search.active_scholars(rt.scholars, fake=False, env={})] == ["openalex", "arxiv"]
    assert len(search.active_scholars(rt.scholars, fake=False, env={"S2_API_KEY": "test-key"})) == 3
    assert len(search.active_scholars(rt.scholars, fake=True, env={})) == 3


def test_expanded_queries_between_3_and_5_with_repair(tmp_path):
    llm = only_fixture(tmp_path, {"query_expand": "03-sinav-kaygisi.json"})
    rt = make_rt(tmp_path / "o", llm_options={"root": llm, "bad_output_at": [0]})
    queries, result = search.expand_queries(rt.ledger, "sınav kaygısı", ref_id=None)
    assert 3 <= len(queries) <= 5 and result.repaired
    assert [c["status"] for c in rt.ledger.calls] == ["bad_output", "ok"]


def test_scholar_error_does_not_kill_run(tmp_path):
    from ogrenmen_common.errors import AdapterError

    rt = make_rt(tmp_path / "o")

    class Broken:
        source = "openalex"
        calls: list[str] = []

        def search(self, query, *, limit=30):  # noqa: ANN001
            raise AdapterError("OGR-ADP-001 OpenAlex HTTP 503")

    rt.scholars = [Broken(), *[s for s in rt.scholars if s.source != "openalex"]]
    res = P.research(rt, "spaced repetition matematik", request_id=P.query_request_id("q"), require_enabled=False)
    assert res.report["source_errors"] and res.output["citations"]
    rt.scholars = [Broken()]
    with pytest.raises(KitapError) as exc:
        P.research(rt, "spaced repetition matematik", request_id=P.query_request_id("q"), require_enabled=False)
    assert exc.value.code == "OGR-KITAP-003"


# --- PDF -------------------------------------------------------------------------------------------


def _pdf(pages: int) -> bytes:
    src = PdfReader(str(KITAP / "sample.pdf"))
    w = PdfWriter()
    while len(w.pages) < pages:
        w.add_page(src.pages[len(w.pages) % len(src.pages)])
    buf = io.BytesIO()
    w.write(buf)
    return buf.getvalue()


class StaticFetcher:
    def __init__(self, data: bytes | None):
        self.data = data
        self.calls: list[str] = []

    def fetch(self, url):  # noqa: ANN001
        self.calls.append(url)
        return self.data


def test_pdf_limits_pages_count_and_tokens():
    fetcher = StaticFetcher(_pdf(45))
    got = pdfs.collect(fetcher, [(i, f"https://example.org/{i}.pdf") for i in range(1, 10)])
    assert len(got) == 6 and len(fetcher.calls) == 6
    assert all(g.pages_read == 40 and g.pages_total == 45 for g in got)
    small = pdfs.collect(StaticFetcher(_pdf(4)), [(1, "https://a/1.pdf"), (2, "https://a/2.pdf")], max_total_tokens=500)
    assert sum(g.tokens for g in small) <= 500 and len(small) == 2 and small[1].tokens < small[0].tokens
    assert pdfs.collect(StaticFetcher(b"%PDF-bozuk"), [(1, "https://a/1.pdf")]) == []
    assert pdfs.collect(StaticFetcher(None), [(1, "https://a/1.pdf")]) == []


def test_http_pdf_fetcher_checks_status_signature_and_size():
    good = _pdf(1)

    def handler(request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if path == "/ok.pdf":
            return httpx.Response(200, content=good)
        if path == "/redirect":
            return httpx.Response(302, headers={"location": "https://example.org/ok.pdf"})
        if path == "/html":
            return httpx.Response(200, content=b"<html>giris</html>")
        if path == "/big.pdf":
            return httpx.Response(200, content=b"%PDF" + b"0" * 2000)
        return httpx.Response(404)

    f = pdfs.HttpPdfFetcher(transport=httpx.MockTransport(handler), max_bytes=10_000_000)
    assert f.fetch("https://example.org/ok.pdf") == good
    assert f.fetch("https://example.org/redirect") == good
    assert f.fetch("https://example.org/html") is None
    assert f.fetch("https://example.org/yok.pdf") is None
    small = pdfs.HttpPdfFetcher(transport=httpx.MockTransport(handler), max_bytes=1000)
    assert small.fetch("https://example.org/big.pdf") is None

    def boom(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectTimeout("zaman aşımı", request=request)

    assert pdfs.HttpPdfFetcher(transport=httpx.MockTransport(boom)).fetch("https://example.org/x.pdf") is None


def test_fake_pdf_fetcher_offline():
    f = pdfs.FakePdfFetcher()
    assert f.fetch("https://example.org/x.pdf").startswith(b"%PDF") and f.fetch("file:///etc/passwd") is None


# --- Zotero ----------------------------------------------------------------------------------------


def test_zotero_export_posts_items_and_counts():
    seen: list[dict] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append({"url": str(request.url), "key": request.headers.get("Zotero-API-Key"),
                     "body": json.loads(request.content)})
        n = len(seen[-1]["body"])
        return httpx.Response(200, json={"successful": {str(i): {} for i in range(n - 1)}, "failed": {"x": {}}})

    exp = zotero.ZoteroExporter("test-key", "12345", transport=httpx.MockTransport(handler))
    cits = [_checked(f"Başlık {i}", "Ak", 2000 + i, doi=f"10.1/{i}") for i in range(51)]
    assert exp.export(cits) == {"successful": 49, "failed": 2}
    assert [len(s["body"]) for s in seen] == [50, 1]
    assert seen[0]["url"] == "https://api.zotero.org/users/12345/items" and seen[0]["key"] == "test-key"
    item = seen[0]["body"][0]
    assert item["itemType"] == "journalArticle" and item["DOI"] == "10.1/0" and item["creators"][0]["lastName"] == "Ak"
    assert zotero.exporter_from_env({}) is None
    assert zotero.exporter_from_env({"ZOTERO_API_KEY": "k", "ZOTERO_LIBRARY_ID": "9",
                                     "ZOTERO_LIBRARY_TYPE": "group"}).url.endswith("/groups/9/items")


def test_zotero_bad_reply_or_config_does_not_crash(monkeypatch):
    html = zotero.ZoteroExporter("test-key", "1", transport=httpx.MockTransport(
        lambda r: httpx.Response(200, text="<html>bakım</html>", headers={"content-type": "text/html"})))
    cits = [_checked("Başlık", "Ak", 2020)]
    with pytest.raises(AdapterError):
        html.export(cits)
    listy = zotero.ZoteroExporter("test-key", "1", transport=httpx.MockTransport(
        lambda r: httpx.Response(200, json=["beklenmeyen"])))
    with pytest.raises(AdapterError):
        listy.export(cits)
    rt = SimpleNamespace(is_fake=False, dry_run=False)   # gerçek kip taklidi (yalnız bu iki alan okunur)
    res = SimpleNamespace(checked=cits)
    monkeypatch.setattr(zotero, "exporter_from_env", lambda env: html)
    assert "Zotero yanıtı JSON değil" in P.export_zotero(rt, res, env={})["error"]
    monkeypatch.setattr(zotero, "exporter_from_env", ZOTERO_FROM_ENV)
    bad_type = P.export_zotero(rt, res, env={"ZOTERO_API_KEY": "k", "ZOTERO_LIBRARY_ID": "1",
                                             "ZOTERO_LIBRARY_TYPE": "kurum"})
    assert "user | group" in bad_type["error"]
    assert P.export_zotero(rt, res, env={}) is None


ZOTERO_FROM_ENV = zotero.exporter_from_env


def test_zotero_not_called_in_dry_run(tmp_path, monkeypatch):
    monkeypatch.setenv("ZOTERO_API_KEY", "test-key")
    monkeypatch.setenv("ZOTERO_LIBRARY_ID", "1")
    rt = make_rt(tmp_path / "o")
    res = P.run_request(rt, "9480be99-349a-5e9e-8b49-cc81722b83f6")
    assert res.status == "done" and res.report["zotero"] is None


def test_real_mode_without_unpaywall_email_skips_fake_oa(tmp_path):
    rt = make_rt(tmp_path / "o")
    rt.mode = "real"   # gerçek kip taklidi: Runtime UNPAYWALL_EMAIL yokken FakeUnpaywall verir
    res = P.research(rt, "spaced repetition matematik", request_id=P.query_request_id("q"), require_enabled=False,
                     fetcher=StaticFetcher(None))
    assert res.report["oa_skipped"] and rt.oa.calls == []
    for c in res.checked:   # yalnız kaynağın kendi bağlantısı kalır
        assert c.oa_pdf_url == c.cand.oa_pdf_url
