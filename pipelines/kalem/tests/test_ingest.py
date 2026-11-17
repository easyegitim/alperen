"""``kalem ingest`` (§6.4): PDF → PNG → ocr zinciri → exam_items; durum geçişleri ve hata yolu."""

from __future__ import annotations

import io
import json

import pypdfium2 as pdfium
import pytest
from ogrenmen_common.adapters.media import ocr_request
from ogrenmen_common.errors import LedgerError
from ogrenmen_common.fakes import FakeOCR
from ogrenmen_pii.scrub import token_hash

from conftest import KALEM, SOURCE_2022, SOURCE_2023, copy_fixtures, edit_json, make_rt, read_jsonl, run_cli
from ogrenmen_kalem import ingest as IN
from ogrenmen_kalem import pdf as P
from ogrenmen_kalem.common import KalemError, course_by_code, course_items, stable_uuid


def giant_pdf() -> bytes:
    """553 baytlık tek sayfa, 14400 × 14400 punto (150 dpi'da 30000 × 30000 piksel)."""
    doc = pdfium.PdfDocument.new()
    doc.new_page(14400, 14400)
    buf = io.BytesIO()
    doc.save(buf)
    doc.close()
    return buf.getvalue()


DEMO_COURSE_ID = "a48b1144-f71e-5ff2-8c38-92f9d76c3805"


def two_uploaded(tmp_path, *, pdf_2023: bytes | None = None):
    """İki ``uploaded`` kaynak: 2023 (created_at önce) ve 2022; 2023 PDF'i verilirse onunla."""
    fx = copy_fixtures(tmp_path)

    def upload_all(rows):
        for r in rows:
            r["status"] = "uploaded"
    edit_json(fx / "exam_sources.json", upload_all)
    (fx / "exam-2023.pdf").write_bytes(pdf_2023 if pdf_2023 is not None else (KALEM / "exam-2022.pdf").read_bytes())
    return fx


def test_ingest_from_source_marks_ocr_done(tmp_path, monkeypatch):
    out = tmp_path / "out"
    rt = make_rt(out)
    real_call = rt.ledger.call

    def model_lies(*args, **kwargs):
        """Model takma adı/yılı/dönemi yanlış yazar: değerler kaynaktan ezilmeli."""
        res = real_call(*args, **kwargs)
        res.data = [{**d, "instructor_alias": "hoca-Z", "year": 1999, "term": "vize"} for d in res.data]
        return res

    stored: list[dict] = []
    real_store = IN.store_items

    def spy_store(rt_, source, course, items, **kwargs):
        stored.extend(dict(i) for i in items)
        return real_store(rt_, source, course, items, **kwargs)

    monkeypatch.setattr(rt.ledger, "call", model_lies)
    monkeypatch.setattr(IN, "store_items", spy_store)
    result = IN.ingest_source(rt, SOURCE_2022)
    rt.close()
    assert result.status == "ocr_done" and result.items == 5
    assert len(stored) == 5
    for obj in stored:  # sözleşme nesnesi (exam-item): takma ad, yıl, dönem kaynaktan
        assert (obj["instructor_alias"], obj["year"], obj["term"], obj["source_id"]) == (
            "hoca-A", 2022, "final", SOURCE_2022)
    sources = read_jsonl(out / "exam_sources.jsonl")
    assert [(s["id"], s["status"], s["error"]) for s in sources] == [(SOURCE_2022, "ocr_done", None)]
    items = read_jsonl(out / "exam_items.jsonl")
    assert len(items) == 5
    alias_of = {s["id"]: s["instructor_alias"] for s in sources}
    for item in items:
        assert item["source_id"] == SOURCE_2022
        # exam_items tablosunda takma ad sütunu yok (0009); takma ad kaynaktan gelir ve maddeye kaynakla bağlıdır
        assert alias_of[item["source_id"]] == "hoca-A"
        assert item["id"] == stable_uuid("exam_item", SOURCE_2022, item["item_no"])
    calls = read_jsonl(out / "llm_calls.jsonl")
    assert [(c["purpose"], c["status"], c["ref_table"], c["ref_id"], c["images"]) for c in calls] == [
        ("ocr", "ok", "exam_sources", SOURCE_2022, 3)]
    assert json.loads((out / "cost_estimate.json").read_text())["by_purpose"]["ocr"]["calls"] == 1


def test_ocr_items_carry_source_meta(tmp_path):
    """Modelin yazdığı takma ad/yıl/dönem ezilir; kaynakta takma ad yoksa maddede de yoktur."""
    rt = make_rt(None)
    meta = IN.source_meta({"id": SOURCE_2022, "year": 2022, "term": "final", "instructor_alias": None})
    rt.ocr = FakeOCR(items=[{"schema_version": "1.0", "source_id": SOURCE_2023, "item_no": 1, "topic": "Kesir",
                             "kind": "calc", "points": 5, "year": 1999, "term": "vize", "instructor_alias": "hoca-Z",
                             "skill_id": None, "ocr_text": "1) metin"}])
    items = IN.ocr_extract(rt, [b"png"], meta)
    rt.close()
    assert items[0]["source_id"] == SOURCE_2022
    assert (items[0]["year"], items[0]["term"], items[0]["instructor_alias"]) == (2022, "final", None)


def test_ocr_prompt_is_meta_only():
    req = ocr_request([b"x"], meta=IN.source_meta({"id": SOURCE_2022, "year": 2022, "term": "final",
                                                    "instructor_alias": "hoca-A"}))
    assert "hoca-A" in req.prompt and "2022" in req.prompt and req.fixture_hint == "exam-2022"
    assert "ocr_text" not in req.prompt


def test_ocr_prompt_is_scrubbed_before_provider(monkeypatch):
    """İstem sağlayıcıya gitmeden ``scrub_for_llm``'den geçer: --name-hashes'teki ad isteme sızsa da gitmez."""
    rt = make_rt(None)
    real_request = IN.ocr_request

    def leaky_request(pages, meta):
        req = real_request(pages, meta=meta)
        return req.with_prompt(req.prompt + " Yükleyen: Zeynep Kaya")

    sent: list[str] = []
    real_call = rt.ledger.call

    def spy_call(purpose, req, **kwargs):
        sent.append(req.prompt)
        return real_call(purpose, req, **kwargs)

    monkeypatch.setattr(IN, "ocr_request", leaky_request)
    monkeypatch.setattr(rt.ledger, "call", spy_call)
    meta = IN.source_meta({"id": SOURCE_2022, "year": 2022, "term": "final", "instructor_alias": "hoca-A"})
    IN.ocr_extract(rt, [b"png"], meta, name_hashes=[token_hash("Zeynep"), token_hash("Kaya")])
    rt.close()
    assert len(sent) == 1
    assert "Zeynep" not in sent[0] and "Kaya" not in sent[0] and "hoca-A" in sent[0]


def test_ocr_text_is_scrubbed_before_storage(tmp_path):
    """"Öğrenci kendi kopyası" sayfasındaki el yazısı ad OCR metnine düşse de exam_items'a yazılmaz."""
    out = tmp_path / "out"
    rt = make_rt(out)
    IN.ingest_source(rt, SOURCE_2022)
    source = rt.db.select("exam_sources", where={"id": SOURCE_2022})[0]
    course = rt.db.select("courses", where={"id": source["course_id"]})[0]
    item = rt.db.select("exam_items", where={"id": stable_uuid("exam_item", SOURCE_2022, 1)})[0]
    leaked = {**item, "ocr_text": "Ad: Zeynep Kaya. " + item["ocr_text"]}
    IN.store_items(rt, source, course, [leaked], name_hashes=[token_hash("Zeynep"), token_hash("Kaya")])
    stored = rt.db.select("exam_items", where={"id": item["id"]})[0]["ocr_text"]
    rt.close()
    assert "Zeynep" not in stored and "Kaya" not in stored and stored.endswith(item["ocr_text"])


def test_ingest_queue_processes_uploaded_only(tmp_path):
    out = tmp_path / "out"
    assert run_cli("ingest", "--queue", "--dry-run", "--fixtures", str(KALEM), "--out", str(out)) == 0
    sources = {s["id"]: s["status"] for s in read_jsonl(out / "exam_sources.jsonl")}
    assert sources == {SOURCE_2022: "ocr_done"}  # ocr_done kaynağa dokunulmaz
    report = json.loads((out / "ingest_report.json").read_text())
    assert [r["source_id"] for r in report] == [SOURCE_2022]


def test_ingest_queue_skip_when_empty(tmp_path, capsys):
    fixtures = tmp_path / "fx"
    fixtures.mkdir()
    rows = json.loads((KALEM / "exam_sources.json").read_text())
    for r in rows:
        r["status"] = "clustered"
    (fixtures / "exam_sources.json").write_text(json.dumps(rows), encoding="utf-8")
    (fixtures / "courses.json").write_text((KALEM / "courses.json").read_text(), encoding="utf-8")
    assert run_cli("ingest", "--queue", "--dry-run", "--fixtures", str(fixtures), "--out", str(tmp_path / "o")) == 0
    assert "SKIP: no uploaded sources" in capsys.readouterr().out


def test_ingest_failure_marks_failed_and_opens_one_alert(tmp_path):
    """PDF bulunamazsa: failed + error + tekil ops alarmı (ref.source_id); ikinci deneme alarmı çoğaltmaz."""
    fixtures = tmp_path / "fx"
    fixtures.mkdir()
    rows = json.loads((KALEM / "exam_sources.json").read_text())
    rows[0]["year"] = 2019  # exam-2019.pdf yok → depolamada nesne yok
    (fixtures / "exam_sources.json").write_text(json.dumps(rows), encoding="utf-8")
    (fixtures / "courses.json").write_text((KALEM / "courses.json").read_text(), encoding="utf-8")
    out = tmp_path / "out"
    rt = make_rt(out, fixtures)
    first = IN.ingest_source(rt, SOURCE_2022)
    second = IN.ingest_source(rt, SOURCE_2022)
    rt.close()
    assert first.status == second.status == "failed" and "OGR-STO-001" in first.error
    src = read_jsonl(out / "exam_sources.jsonl")[0]
    assert src["status"] == "failed" and src["error"].startswith("OGR-STO-001")
    alerts = read_jsonl(out / "instructor_alerts.jsonl")
    assert len(alerts) == 1
    a = alerts[0]
    assert (a["kind"], a["severity"], a["status"]) == ("ops", "warning", "open")
    assert a["detail"] == "Sınav arşivi OCR tamamlanamadı: 2019/final" and a["ref"] == {"source_id": SOURCE_2022}
    assert not (out / "exam_items.jsonl").exists()


def test_ingest_source_cli_returns_1_on_failure(tmp_path):
    fixtures = tmp_path / "fx"
    fixtures.mkdir()
    rows = json.loads((KALEM / "exam_sources.json").read_text())
    rows[0]["storage_path"] = "exams/yok.pdf"
    rows[0]["year"] = 2018
    (fixtures / "exam_sources.json").write_text(json.dumps(rows), encoding="utf-8")
    (fixtures / "courses.json").write_text((KALEM / "courses.json").read_text(), encoding="utf-8")
    code = run_cli("ingest", "--source", SOURCE_2022, "--dry-run", "--fixtures", str(fixtures), "--out",
                   str(tmp_path / "o"))
    assert code == 1


def test_ingest_unknown_source(tmp_path):
    rt = make_rt(None)
    with pytest.raises(KalemError, match="OGR-KALEM-002"):
        IN.ingest_source(rt, "00000000-0000-4000-8000-000000000000")
    rt.close()


def test_ingest_pdf_opens_source_with_deterministic_id(tmp_path):
    out = tmp_path / "out"
    args = ("ingest", "--pdf", str(KALEM / "exam-2022.pdf"), "--course", "DEMO", "--year", "2021", "--term", "vize",
            "--legal-basis", "öğrenci kendi kopyası", "--instructor-alias", "hoca-B", "--dry-run", "--fixtures",
            str(KALEM), "--out", str(out))
    assert run_cli(*args) == 0
    src = read_jsonl(out / "exam_sources.jsonl")
    assert len(src) == 1
    s = src[0]
    assert (s["year"], s["term"], s["instructor_alias"], s["status"]) == (2021, "vize", "hoca-B", "ocr_done")
    assert s["storage_path"] == f"exams/{s['id']}.pdf"
    assert (out / "storage" / "exams" / f"{s['id']}.pdf").read_bytes() == (KALEM / "exam-2022.pdf").read_bytes()
    out2 = tmp_path / "out2"
    assert run_cli(*args[:-1], str(out2)) == 0
    assert read_jsonl(out2 / "exam_sources.jsonl")[0]["id"] == s["id"]


@pytest.mark.parametrize("flag,value,code", [("--instructor-alias", "Ayşe Hoca", "OGR-KALEM-011")])
def test_ingest_pdf_rejects_real_names(tmp_path, flag, value, code):
    rt = make_rt(None)
    with pytest.raises(KalemError, match=code):
        IN.ingest_pdf(rt, KALEM / "exam-2022.pdf", course_code="DEMO", year=2021, term="vize",
                      legal_basis="öğrenci kendi kopyası", instructor_alias=value)
    rt.close()


def test_ingest_pdf_requires_flags(tmp_path, capsys):
    code = run_cli("ingest", "--pdf", str(KALEM / "exam-2022.pdf"), "--dry-run", "--out", str(tmp_path / "o"))
    assert code == 2 and "--course" in capsys.readouterr().err


def test_render_pages_produces_png_per_page():
    rendered = P.render_pages((KALEM / "exam-2022.pdf").read_bytes())
    assert rendered.page_count == 3 and len(rendered.pages) == 3
    assert all(p.startswith(P.PNG_SIGNATURE) and len(p) > 1000 for p in rendered.pages)


@pytest.mark.parametrize("data", [b"", b"not a pdf", b"%PDF-1.4\nbozuk"])
def test_render_pages_rejects_bad_pdf(data):
    with pytest.raises(KalemError, match="OGR-KALEM-003"):
        P.render_pages(data)


def test_render_pages_page_cap():
    with pytest.raises(KalemError, match="en çok 2 sayfa"):
        P.render_pages((KALEM / "exam-2022.pdf").read_bytes(), max_pages=2)


def test_reingest_resets_embedding_when_text_changes(tmp_path):
    rt = make_rt(None)
    IN.ingest_source(rt, SOURCE_2022)
    item_id = stable_uuid("exam_item", SOURCE_2022, 1)
    rt.db.update("exam_items", {"embedding": "[1,0]", "cluster_id": None}, where={"id": item_id})
    source = rt.db.select("exam_sources", where={"id": SOURCE_2022})[0]
    course = rt.db.select("courses", where={"id": source["course_id"]})[0]
    same = rt.db.select("exam_items", where={"id": item_id})[0]
    IN.store_items(rt, source, course, [{**same, "ocr_text": same["ocr_text"]}])
    assert rt.db.select("exam_items", where={"id": item_id})[0]["embedding"] == "[1,0]"
    IN.store_items(rt, source, course, [{**same, "ocr_text": "1) değişmiş metin"}])
    assert rt.db.select("exam_items", where={"id": item_id})[0]["embedding"] is None
    rt.close()


def test_giant_page_is_rejected_before_render():
    data = giant_pdf()
    assert len(data) < 2000
    with pytest.raises(KalemError, match="OGR-KALEM-003 PDF 1. sayfa çok büyük"):
        P.inspect_pdf(data)
    with pytest.raises(KalemError, match="OGR-KALEM-003"):
        P.render_pages(data)
    assert P.inspect_pdf((KALEM / "exam-2022.pdf").read_bytes()).page_count == 3


def test_total_pixel_budget():
    data = (KALEM / "exam-2022.pdf").read_bytes()
    info = P.inspect_pdf(data)
    one_page = info.sizes_px[0][0] * info.sizes_px[0][1]
    with pytest.raises(KalemError, match="toplam piksel"):
        P.render_pages(data, max_total_px=one_page * 2)


def test_giant_pdf_fails_one_source_and_queue_continues(tmp_path):
    """Dev sayfalı PDF: o kaynak failed + tek alarm; kuyruktaki sonraki kaynak yine işlenir."""
    fx = two_uploaded(tmp_path, pdf_2023=giant_pdf())
    out = tmp_path / "out"
    assert run_cli("ingest", "--queue", "--dry-run", "--fixtures", str(fx), "--out", str(out)) == 0
    status = {s["id"]: (s["status"], s["error"]) for s in read_jsonl(out / "exam_sources.jsonl")}
    assert status[SOURCE_2023][0] == "failed" and status[SOURCE_2023][1].startswith("OGR-KALEM-003")
    assert status[SOURCE_2022] == ("ocr_done", None)
    alerts = read_jsonl(out / "instructor_alerts.jsonl")
    assert [(a["detail"], a["ref"]) for a in alerts] == [("Sınav arşivi OCR tamamlanamadı: 2023/final",
                                                         {"source_id": SOURCE_2023})]
    assert {i["source_id"] for i in read_jsonl(out / "exam_items.jsonl")} == {SOURCE_2022}


def test_unexpected_error_fails_source_without_blocking_queue(tmp_path, monkeypatch):
    """Beklenmeyen hata (ör. MemoryError) kuyruğu düşürmez: kaynak failed + alarm, sonraki işlenir."""
    fx = two_uploaded(tmp_path)
    rt = make_rt(tmp_path / "out", fx)
    real_render = IN.render_pages
    seen: list[int] = []

    def boom_first(data):
        seen.append(1)
        if len(seen) == 1:
            raise MemoryError
        return real_render(data)

    monkeypatch.setattr(IN, "render_pages", boom_first)
    results = IN.ingest_queue(rt)
    alerts = rt.db.select("instructor_alerts", where={"kind": "ops"})
    rt.close()
    assert [(r.source_id, r.status) for r in results] == [(SOURCE_2023, "failed"), (SOURCE_2022, "ocr_done")]
    assert results[0].error == "OGR-KALEM-011 beklenmeyen hata: MemoryError"
    assert [a["ref"] for a in alerts if a.get("ref", {}).get("source_id") in (SOURCE_2022, SOURCE_2023)] == [
        {"source_id": SOURCE_2023}]


def test_ingest_pdf_rejects_giant_pdf_without_opening_source(tmp_path):
    pdf = tmp_path / "dev.pdf"
    pdf.write_bytes(giant_pdf())
    out = tmp_path / "out"
    rt = make_rt(out)
    with pytest.raises(KalemError, match="OGR-KALEM-003"):
        IN.ingest_pdf(rt, pdf, course_code="DEMO", year=2021, term="vize", legal_basis="öğrenci kendi kopyası")
    rt.close()
    assert not (out / "exam_sources.jsonl").exists()


def test_cap_block_defers_source_without_alert(tmp_path, monkeypatch, capsys, shared_runtime):
    """Harcama tavanı OCR hatası değildir: kaynak uploaded kalır, alarm yok; kalan kuyruk çağrısız ertelenir."""
    fx = two_uploaded(tmp_path)
    out = tmp_path / "out"
    calls: list[str] = []

    def capped(purpose, req, **kwargs):
        calls.append(purpose)
        raise LedgerError("OGR-LLM-002 tavan ücretli çağrıyı engelledi (ocr; durum hard)")

    rt = make_rt(out, fx)
    shared_runtime.rt = rt
    monkeypatch.setattr(rt.ledger, "call", capped)
    assert run_cli("ingest", "--queue", "--dry-run", "--fixtures", str(fx), "--out", str(out)) == 0
    stdout = capsys.readouterr().out
    rows = {s["id"]: s for s in rt.db.select("exam_sources", where={"course_id": DEMO_COURSE_ID})}
    alerts = rt.db.select("instructor_alerts", where={"kind": "ops"})
    shared_runtime.close()
    assert calls == ["ocr"]  # ikinci kaynak model çağrılmadan ertelendi
    assert stdout.count("ERTELENDİ") == 2
    assert all(rows[sid]["status"] == "uploaded" for sid in (SOURCE_2022, SOURCE_2023))
    assert rows[SOURCE_2023]["error"].startswith("cap_blocked: OGR-LLM-002")
    assert [a for a in alerts if (a.get("ref") or {}).get("source_id") in (SOURCE_2022, SOURCE_2023)] == []
    report = json.loads((out / "ingest_report.json").read_text())
    assert [r["status"] for r in report] == ["deferred", "deferred"]
    assert not (out / "instructor_alerts.jsonl").exists()


def test_reocr_with_fewer_items_retires_stale_items(tmp_path):
    rt = make_rt(None)
    IN.ingest_source(rt, SOURCE_2022)
    course = course_by_code(rt.db, "DEMO")
    source = rt.db.select("exam_sources", where={"id": SOURCE_2022})[0]
    items = sorted(rt.db.select("exam_items", where={"source_id": SOURCE_2022}), key=lambda r: r["item_no"])
    assert len(items) == 5
    stale_id = items[4]["id"]
    rt.db.update("exam_items", {"embedding": "[1,0]", "cluster_id": None}, where={"id": stale_id})
    keep = [{**i, "schema_version": "1.0", "year": 2022} for i in items[:3]]
    _, warnings = IN.store_items(rt, source, course, keep)
    stale = rt.db.select("exam_items", where={"id": stale_id})[0]
    active = course_items(rt.db, str(course["id"]))
    rt.close()
    assert (stale["ocr_text"], stale["embedding"], stale["cluster_id"]) == (None, None, None)
    assert sorted(i["item_no"] for i in active) == [1, 2, 3]
    assert any("emekliye ayrıldı" in w and "4, 5" in w for w in warnings)
