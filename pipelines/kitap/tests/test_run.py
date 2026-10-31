"""Uçtan uca araştırma akışı: kuyruk, istek, elle sorgu, Crossref silmesi, kapı, PII (BLUEPRINT §6.5)."""

from __future__ import annotations

import contextlib
import dataclasses
import hashlib
import json

import ogrenmen_contracts as contracts
import pytest
from ogrenmen_common import cli_base
from ogrenmen_common.adapters.base import ScholarRecord
from ogrenmen_common.errors import AdapterError, DbError, LedgerError

from conftest import (
    DONE,
    FAKE_DOI,
    KITAP,
    MISMATCH_DOI,
    QUEUED_1,
    QUEUED_2,
    enabled_fixtures,
    make_rt,
    only_fixture,
    read_jsonl,
    run_cli,
    set_flag,
)
from ogrenmen_kitap import cli, synthesize
from ogrenmen_kitap import pipeline as P
from ogrenmen_kitap.errors import GateBlocked, KitapError


def _research(rt, query="spaced repetition matematik", **kw):  # noqa: ANN001
    return P.research(rt, query, request_id=P.query_request_id(query), require_enabled=False, **kw)


def _spy_runtime(monkeypatch) -> list:  # noqa: ANN001
    """CLI'nin açtığı ``Runtime``'ı yakalar (aynı nesne üzerinde sonradan doğrulama için)."""
    seen: list = []
    original = cli_base.open_runtime

    @contextlib.contextmanager
    def spy(ca):  # noqa: ANN001
        with original(ca) as rt:
            seen.append(rt)
            yield rt

    monkeypatch.setattr(cli.cli_base, "open_runtime", spy)
    return seen


def test_run_queued_processes_only_queued_rows(tmp_path, monkeypatch):
    fixtures = enabled_fixtures(tmp_path)
    out = tmp_path / "out"
    seen = _spy_runtime(monkeypatch)
    assert run_cli("run", "--queued", "--limit", "5", "--dry-run", "--fixtures", str(fixtures), "--out", str(out)) == 0
    requests = read_jsonl(out / "research_requests.jsonl")
    assert sorted(r["id"] for r in requests) == sorted([QUEUED_1, QUEUED_2])
    assert {r["status"] for r in requests} == {"done"}
    assert DONE not in {r["id"] for r in requests}
    for r in requests:
        assert 3 <= len(r["expanded_queries"]) <= 5 and r["finished_at"] == "2026-10-20T09:00:00Z"
        assert r["cost_usd"] > 0
    outputs = read_jsonl(out / "research_outputs.jsonl")
    assert len(outputs) == 2 and {o["request_id"] for o in outputs} == {QUEUED_1, QUEUED_2}
    for o in outputs:
        assert o["status"] == "pending_review"
        contracts.validate("research-output", o["output"])
        assert FAKE_DOI not in json.dumps(o["output"])
        assert (out / "outputs" / f"{o['request_id']}.json").is_file()
    cits = read_jsonl(out / "citations.jsonl")
    for o in outputs:
        mine = [c for c in cits if c["output_id"] == o["id"]]
        assert len({c["ordinal"] for c in mine}) == len(mine)
        assert {c["ordinal"] for c in mine if c["status"] == "kept"} == {c["ordinal"] for c in o["output"]["citations"]}
    # done satırı dokunulmamış: CLI'nin kullandığı Runtime'da kaynak satırla aynı ve yazım günlüğünde yok
    original = next(r for r in json.loads((KITAP / "requests.json").read_text(encoding="utf-8")) if r["id"] == DONE)
    (rt,) = seen
    assert rt.db.select("research_requests", where={"id": DONE})[0] == original
    touched = [w for w in rt.db.write_log if w["table"] == "research_requests"]
    assert touched and all(DONE not in w["key"] for w in touched)
    assert {k for w in touched for k in w["key"]} == {QUEUED_1, QUEUED_2}
    calls = read_jsonl(out / "llm_calls.jsonl")
    assert {c["purpose"] for c in calls} == {"query_expand", "research"}
    assert all(c["ref_table"] == "research_requests" and c["ref_id"] in (QUEUED_1, QUEUED_2) for c in calls)
    assert all(c["student_ref"] is None for c in calls)


def test_run_queued_respects_limit_and_order(tmp_path):
    rt = make_rt(tmp_path / "out")
    results = P.run_queued(rt, limit=1)
    assert [(r.request_id, r.status) for r in results] == [(QUEUED_1, "done")]   # en eski created_at önce
    assert [r["id"] for r in rt.db.select("research_requests", where={"status": "queued"})] == [QUEUED_2]


def test_queued_skips_when_research_disabled(tmp_path, capsys):
    out = tmp_path / "out"
    assert run_cli("run", "--queued", "--dry-run", "--fixtures", str(KITAP), "--out", str(out)) == 0
    assert "SKIP: research disabled" in capsys.readouterr().out
    assert not (out / "research_requests.jsonl").exists() and not (out / "llm_calls.jsonl").exists()


def test_queued_skips_when_no_rows(tmp_path, capsys):
    fixtures = enabled_fixtures(tmp_path)
    rows = json.loads((fixtures / "requests.json").read_text(encoding="utf-8"))
    (fixtures / "requests.json").write_text(json.dumps([r for r in rows if r["status"] == "done"]), encoding="utf-8")
    assert run_cli("run", "--queued", "--dry-run", "--fixtures", str(fixtures), "--out", str(tmp_path / "o")) == 0
    assert "SKIP: no queued requests" in capsys.readouterr().out


def test_run_request_single_and_refuses_done(tmp_path, capsys):
    fixtures = enabled_fixtures(tmp_path)
    out = tmp_path / "out"
    assert run_cli("run", "--request", QUEUED_2, "--dry-run", "--fixtures", str(fixtures), "--out", str(out)) == 0
    assert [r["status"] for r in read_jsonl(out / "research_requests.jsonl")] == ["done"]
    contracts.validate("research-output", json.loads((out / "output.json").read_text(encoding="utf-8")))
    code = cli_base.run_main(cli.main, ["run", "--request", DONE, "--dry-run", "--fixtures", str(fixtures), "--out",
                                        str(tmp_path / "o2")])
    assert code == 1 and "OGR-KITAP-002" in capsys.readouterr().err


def test_query_run_writes_valid_output_and_no_db_rows(tmp_path):
    out = tmp_path / "out"
    assert run_cli("run", "--query", "spaced repetition matematik", "--dry-run", "--fixtures", str(KITAP),
                   "--out", str(out)) == 0
    o = json.loads((out / "output.json").read_text(encoding="utf-8"))
    contracts.validate("research-output", o)
    assert all(c["crossref_status"] in ("verified", "no_doi") for c in o["citations"])
    ords = {c["ordinal"] for c in o["citations"]}
    assert all(set(p["cites"]) <= ords for p in o["synthesis"])
    assert o["removed"] and FAKE_DOI not in (out / "output.json").read_text(encoding="utf-8")
    assert 3 <= len(o["expanded_queries"]) <= 5
    assert not (out / "research_outputs.jsonl").exists() and not (out / "citations.jsonl").exists()
    assert json.loads((out / "cost_estimate.json").read_text(encoding="utf-8"))["total_usd"] > 0


def test_unresolved_doi_removed_and_its_paragraph_dropped(tmp_path):
    llm = only_fixture(tmp_path, {"research": "01-spaced-repetition.json", "query_expand": "01-spaced-repetition.json"})
    rt = make_rt(tmp_path / "out", llm_options={"root": llm})
    res = _research(rt)
    o = res.output
    # model 5 numaralı (uydurma DOI'li) kaynağa dayanan paragrafı yazdı; doğrulanmış listede 4 kaynak var
    assert len(o["citations"]) == 4 and FAKE_DOI not in json.dumps(o)
    assert all(5 not in p["cites"] for p in o["synthesis"]) and len(o["synthesis"]) == 2
    assert all("kesin" not in p["text"] for p in o["synthesis"])
    assert res.report["paragraphs_regenerated"] == 1 and len(res.report["paragraphs_dropped"]) == 1
    assert [c.purpose for c in rt.llm.calls] == ["query_expand", "research", "research"]
    gone = next(c for c in res.checked if c.cand.doi == FAKE_DOI)
    assert (gone.kept, gone.reason, gone.crossref_status) == (False, "crossref_unresolved", "unresolved")
    assert {"doi_or_title": gone.title, "reason": "crossref_unresolved"} in o["removed"]
    assert FAKE_DOI in rt.doi.calls   # gerçekten Crossref'e soruldu
    assert all(m["ordinal"] in {c["ordinal"] for c in o["citations"]} for m in o["matrix"])


def test_title_mismatch_removed(tmp_path):
    res = _research(make_rt(tmp_path / "out"))
    bad = next(c for c in res.checked if c.cand.doi == MISMATCH_DOI)
    assert not bad.kept and bad.reason == "title_mismatch" and bad.title_similarity < 0.6
    assert {"doi_or_title": MISMATCH_DOI, "reason": "title_mismatch"} in res.output["removed"]
    assert MISMATCH_DOI not in {c.get("doi") for c in res.output["citations"]}


def test_arxiv_no_doi_kept_with_link(tmp_path):
    res = _research(make_rt(tmp_path / "out"))
    arx = [c for c in res.output["citations"] if c["source"] == "arxiv"]
    assert len(arx) == 1
    c = arx[0]
    assert c["crossref_status"] == "no_doi" and "doi" not in c
    assert c["oa_pdf_url"] == "https://arxiv.org/pdf/2513.00042"
    assert c["title"] not in {r["doi_or_title"] for r in res.output["removed"]}


def test_dedup_by_doi_merges_sources(tmp_path):
    res = _research(make_rt(tmp_path / "out"))
    cepeda = next(c for c in res.checked if c.cand.doi == "10.1037/0033-2909.132.3.354")
    assert set(cepeda.cand.sources) == {"openalex", "semantic_scholar"}
    assert cepeda.cand.tldr and "Aralıklı" in cepeda.cand.tldr      # S2 tldr korunur
    dois = [c.cand.doi for c in res.checked if c.cand.doi]
    assert len(dois) == len(set(dois))
    assert res.report["records"] > res.report["candidates"] == 6


@pytest.mark.parametrize("break_with", ["monthly_cap", "spend", "degraded"])
def test_quota_checked_before_network(tmp_path, break_with):
    rt = make_rt(tmp_path / "out")
    if break_with == "monthly_cap":
        set_flag(rt, "research_monthly_cap", 1)
        rt.db.seed("research_requests", {"id": "11111111-1111-4111-8111-111111111111", "query": "x", "status": "done",
                                         "expanded_queries": [], "cost_usd": 0.02, "created_at": "2026-10-02T10:00:00Z",
                                         "finished_at": "2026-10-02T11:00:00Z"})
    elif break_with == "spend":
        set_flag(rt, "paid_llm_enabled", False)
    else:
        set_flag(rt, "degraded_mode", True)
    results = P.run_queued(rt, limit=5)
    assert all(s.calls == [] for s in rt.scholars)
    assert rt.doi.calls == [] and rt.oa.calls == [] and rt.llm.calls == [] and rt.ledger.calls == []
    statuses = {r["id"]: r["status"] for r in rt.db.select("research_requests")}
    if break_with == "monthly_cap":
        assert [r.status for r in results] == ["blocked_quota", "blocked_quota"]
        assert statuses[QUEUED_1] == statuses[QUEUED_2] == "blocked_quota"
    else:   # geçici harcama engeli: satırlar kuyrukta kalır, ertesi gece yeniden denenir
        assert [r.status for r in results] == ["queued"]
        assert statuses[QUEUED_1] == statuses[QUEUED_2] == "queued"
    with pytest.raises(GateBlocked):
        _research(rt)
    assert rt.llm.calls == [] and all(s.calls == [] for s in rt.scholars)


def test_monthly_cap_counts_only_this_istanbul_month(tmp_path):
    from ogrenmen_kitap import gate

    rt = make_rt(tmp_path / "out")
    base = {"query": "x", "status": "done", "expanded_queries": [], "cost_usd": 0, "created_at": "2026-09-30T19:00:00Z"}
    # 30 Eylül 20:00Z = 23:00 İstanbul → geçen ay; 30 Eylül 22:30Z = 1 Ekim 01:30 İstanbul → bu ay
    rt.db.seed("research_requests", [{**base, "id": "22222222-2222-4222-8222-222222222222",
                                      "finished_at": "2026-09-30T20:00:00Z"},
                                     {**base, "id": "33333333-3333-4333-8333-333333333333",
                                      "finished_at": "2026-09-30T22:30:00Z"},
                                     {**base, "id": "44444444-4444-4444-8444-444444444444", "status": "failed",
                                      "finished_at": "2026-10-10T10:00:00Z"}])
    assert gate.done_this_month(rt.db, rt.clock()) == 2   # fixture done satırı (18 Ekim) + 1 Ekim gece yarısı sonrası
    set_flag(rt, "research_monthly_cap", 2)
    with pytest.raises(GateBlocked) as exc:
        gate.check(rt.db, rt.ledger, rt.clock(), require_enabled=True)
    assert exc.value.kind == "monthly_cap"
    set_flag(rt, "research_monthly_cap", 3)
    assert gate.check(rt.db, rt.ledger, rt.clock(), require_enabled=True).month_done == 2


def test_crossref_outage_fails_request_not_drops_citations(tmp_path):
    rt = make_rt(tmp_path / "out")

    class Down:
        calls: list[str] = []

        def resolve(self, doi):  # noqa: ANN001
            raise AdapterError("OGR-ADP-001 Crossref HTTP 503 (2 deneme; kesinti)")

    rt.doi = Down()
    with pytest.raises(KitapError) as exc:
        _research(rt)
    assert exc.value.code == "OGR-KITAP-010"
    results = P.run_queued(rt, limit=1)
    assert results[0].status == "failed" and "OGR-KITAP-010" in results[0].error
    row = rt.db.select("research_requests", where={"id": QUEUED_1})[0]
    assert row["status"] == "failed" and row["finished_at"]
    assert rt.db.select("research_outputs", where={"request_id": QUEUED_1}) == []


def test_empty_synthesis_marks_failed(tmp_path):
    llm = only_fixture(tmp_path, {"research": "01-spaced-repetition.json"})
    rt = make_rt(tmp_path / "out", llm_options={"root": llm})
    for name in list(rt.doi._ok):   # yalnız Dunlosky doğrulansın: tek kaynak
        if name != "10.1177/1529100612453266":
            rt.doi._missing[name] = {"status": 404}
    rt.scholars = [s for s in rt.scholars if s.source != "arxiv"]
    with pytest.raises(KitapError) as exc:
        _research(rt)
    assert exc.value.code == "OGR-KITAP-005"


def test_pii_scrubbed_before_llm_and_scholars(tmp_path):
    rt = make_rt(tmp_path / "out")
    query = "Elif için aralıklı tekrar, bana elif.kaya@example.com ya da 0532 111 22 33 üzerinden yaz"
    hashes = [hashlib.sha256(b"elif").hexdigest(), hashlib.sha256(b"kaya").hexdigest()]
    res = _research(rt, query, name_hashes=hashes)
    prompts = "\n".join(c.prompt_text for c in rt.llm.calls)
    for leak in ("Elif", "elif.kaya", "0532", "111 22 33"):
        assert leak not in prompts
        assert all(leak not in q for s in rt.scholars for q in s.calls)
    assert "[E-POSTA]" in prompts and "[TELEFON]" in prompts
    # çıktıdaki soru modele giden temizlenmiş sorudur (ham soru yalnız research_requests.query'de)
    for leak in ("Elif", "elif.kaya", "0532"):
        assert leak not in res.output["query"] and leak not in json.dumps(res.output, ensure_ascii=False)
    assert "[E-POSTA]" in res.output["query"]


class _Edited:
    """Sahte bir akademik kaynağın kayıtlarını değiştiren sarmalayıcı (``calls`` iç kaynağınkidir)."""

    def __init__(self, inner, edit=None, extra=()):  # noqa: ANN001
        self.inner, self.source, self.calls = inner, inner.source, inner.calls
        self.edit, self.extra = edit or (lambda r: r), list(extra)

    def search(self, query, *, limit=30):  # noqa: ANN001
        return [self.edit(r) for r in self.inner.search(query, limit=limit)] + self.extra


def test_whole_prompt_scrubbed_including_abstracts_and_authors(tmp_path):
    rt = make_rt(tmp_path / "out")
    note = " Görüşmeyi Elif Kaya yaptı."

    def edit(r):  # noqa: ANN001
        return dataclasses.replace(r, abstract=(r.abstract or "") + note, tldr=(r.tldr + note) if r.tldr else None,
                                   authors=(*r.authors, "Elif Kaya"))

    rt.scholars = [_Edited(s, edit) for s in rt.scholars]
    hashes = [hashlib.sha256(b"elif").hexdigest(), hashlib.sha256(b"kaya").hexdigest()]
    _research(rt, name_hashes=hashes)
    research_prompts = [c.prompt_text for c in rt.llm.calls if c.purpose == "research"]
    assert research_prompts and all("Özet:" in p for p in research_prompts)   # özetler gerçekten istemde
    for p in (c.prompt_text for c in rt.llm.calls):
        assert "Elif" not in p and "Kaya" not in p


def test_no_doi_dergipark_record_without_year_removed_not_crash(tmp_path):
    rt = make_rt(tmp_path / "out")
    yearless = ScholarRecord("Matematikte aralıklı tekrar üzerine bir inceleme", ("Ayşe Demir",), None, None, None, 3,
                             "openalex", oa_pdf_url="https://dergipark.org.tr/tr/download/article-file/9")
    rt.scholars = [_Edited(s, extra=[yearless] if s.source == "openalex" else ()) for s in rt.scholars]
    res = P.run_request(rt, QUEUED_1)
    assert res.status == "done", res.error
    assert {"doi_or_title": yearless.title, "reason": "no_doi_no_link"} in res.output["removed"]
    assert yearless.title not in {c["title"] for c in res.output["citations"]}
    assert rt.db.select("research_requests", where={"id": QUEUED_1})[0]["status"] == "done"
    row = next(c for c in rt.db.written("citations") if c["title"] == yearless.title)
    assert (row["status"], row["removed_reason"], row["crossref_status"]) == ("removed", "no_doi_no_link", "no_doi")


@pytest.mark.parametrize("failure", ["db", "bug"])
def test_unexpected_error_marks_failed_and_queue_continues(tmp_path, monkeypatch, failure):
    rt = make_rt(tmp_path / "out")
    state = {"n": 0}
    if failure == "db":
        original = rt.db.insert

        def flaky(table, rows, *, returning=None, **kw):  # noqa: ANN001
            if table == "citations" and state["n"] == 0:
                state["n"] += 1
                raise DbError("OGR-DB-003 PostgREST 503")
            return original(table, rows, **({"returning": returning} if returning else {}), **kw)

        rt.db.insert = flaky
    else:
        original_store = P.store

        def buggy(rt_, res):  # noqa: ANN001
            if state["n"] == 0:
                state["n"] += 1
                raise TypeError("int() argument must be a string, not 'NoneType'")
            return original_store(rt_, res)

        monkeypatch.setattr(P, "store", buggy)
    results = P.run_queued(rt, limit=5)
    assert [(r.request_id, r.status) for r in results] == [(QUEUED_1, "failed"), (QUEUED_2, "done")]
    assert ("OGR-DB-003" if failure == "db" else "TypeError") in results[0].error
    if failure == "db":   # research_outputs yazıldı, citations düştü: yarım çıktı hata satırında
        assert results[0].output_id and results[0].output_id in results[0].error
    statuses = {r["id"]: r["status"] for r in rt.db.select("research_requests")}
    assert statuses[QUEUED_1] == "failed" and statuses[QUEUED_2] == "done"
    assert "running" not in statuses.values()
    row = rt.db.select("research_requests", where={"id": QUEUED_1})[0]
    assert row["finished_at"] and row["cost_usd"] == pytest.approx(results[0].cost_usd) and row["cost_usd"] > 0


def test_spend_block_inside_research_requeues_and_stops(tmp_path, monkeypatch):
    rt = make_rt(tmp_path / "out")

    def capped(*a, **kw):  # noqa: ANN002, ANN003
        raise LedgerError("OGR-LLM-002 tavan ücretli çağrıyı engelledi (research; durum free_only)")

    monkeypatch.setattr(synthesize, "synthesize", capped)
    before = rt.db.select("research_requests", where={"id": QUEUED_1})[0]
    results = P.run_queued(rt, limit=5)
    assert [(r.request_id, r.status) for r in results] == [(QUEUED_1, "queued")]   # döngü durdu
    row = rt.db.select("research_requests", where={"id": QUEUED_1})[0]
    assert row["status"] == "queued" and row.get("finished_at") == before.get("finished_at")
    assert results[0].cost_usd > 0   # query_expand harcandı ve satıra eklendi
    assert row["cost_usd"] == pytest.approx(float(before.get("cost_usd") or 0) + results[0].cost_usd)
    assert all(QUEUED_2 not in w["key"] for w in rt.db.write_log if w["table"] == "research_requests")
    assert P.transient_block(GateBlocked("degraded", "x")) and P.transient_block(GateBlocked("spend", "x"))
    assert not P.transient_block(GateBlocked("monthly_cap", "x"))
    assert not P.transient_block(LedgerError("OGR-LLM-001 zincir tükendi"))


def test_queued_cli_exits_1_when_a_request_failed(tmp_path, monkeypatch, capsys):
    fixtures = enabled_fixtures(tmp_path)
    out = tmp_path / "out"

    def boom(*a, **kw):  # noqa: ANN002, ANN003
        raise KitapError("OGR-KITAP-004 doğrulanmış kaynak kalmadı")

    monkeypatch.setattr(P, "research", boom)
    assert run_cli("run", "--queued", "--dry-run", "--fixtures", str(fixtures), "--out", str(out)) == 1
    assert "HATA: 2 istek başarısız" in capsys.readouterr().err
    report = json.loads((out / "queued_report.json").read_text(encoding="utf-8"))
    assert [r["status"] for r in report] == ["failed", "failed"]
    assert {r["status"] for r in read_jsonl(out / "research_requests.jsonl")} == {"failed"}


@pytest.mark.parametrize("value", [["Elif"], ["z" * 64], [hashlib.sha256(b"elif").hexdigest()[:63] + "g"]])
def test_name_hashes_flag_rejects_plain_names(tmp_path, value):
    bad = tmp_path / "names.json"
    bad.write_text(json.dumps(value), encoding="utf-8")
    code = cli_base.run_main(cli.main, ["run", "--query", "x y z", "--dry-run", "--name-hashes", str(bad),
                                        "--out", str(tmp_path / "o")])
    assert code == 1
    good = tmp_path / "ok.json"
    good.write_text(json.dumps([hashlib.sha256(b"elif").hexdigest().upper()]), encoding="utf-8")
    assert cli.load_name_hashes(good) == [hashlib.sha256(b"elif").hexdigest()]


def test_limit_flag_default_and_explicit(tmp_path, monkeypatch):
    fixtures = enabled_fixtures(tmp_path)
    seen: list[int] = []
    monkeypatch.setattr(P, "run_queued", lambda rt, *, limit, **kw: seen.append(limit) or [])
    assert run_cli("run", "--queued", "--dry-run", "--fixtures", str(fixtures), "--out", str(tmp_path / "a")) == 0
    assert run_cli("run", "--queued", "--limit", "2", "--dry-run", "--fixtures", str(fixtures),
                   "--out", str(tmp_path / "b")) == 0
    assert seen == [5, 2]
    with pytest.raises(SystemExit) as exc:   # --limit 0 sessizce 5'e dönmez: ayrıştırıcı reddeder
        run_cli("run", "--queued", "--limit", "0", "--dry-run", "--fixtures", str(fixtures), "--out", str(tmp_path))
    assert exc.value.code == 2 and seen == [5, 2]


def test_store_respects_batch_worker_grants(tmp_path):
    rt = make_rt(tmp_path / "out")
    res = P.run_request(rt, QUEUED_1)
    assert res.status == "done"
    out_rows = rt.db.written("research_outputs")
    assert len(out_rows) == 1 and out_rows[0]["status"] == "pending_review"
    assert out_rows[0]["apa"] == "\n".join(res.output["apa"]) and out_rows[0]["bibtex"] == res.output["bibtex"]
    cits = rt.db.written("citations")
    assert len(cits) == len(res.output["citations"]) + len(res.output["removed"])
    fake = next(c for c in cits if c["doi"] == FAKE_DOI)
    assert (fake["status"], fake["crossref_status"], fake["removed_reason"]) == ("removed", "unresolved",
                                                                                   "crossref_unresolved")
    assert fake["verified_at"] == "2026-10-20T09:00:00Z"   # citations.unresolved saklama kuralının saati
    kept = [c for c in cits if c["status"] == "kept"]
    assert {c["crossref_status"] for c in kept} <= {"verified", "no_doi"}
    assert all(w["via"] == "direct" for w in rt.db.write_log if w["table"] in ("citations", "research_outputs"))
