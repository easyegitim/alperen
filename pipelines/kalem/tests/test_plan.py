"""``kalem plan`` (§6.4, §4.5): başlık sabiti, yasaklı kelimeler, telif kemeri, sıralama, durum."""

from __future__ import annotations

import json

import ogrenmen_contracts as contracts
import pytest

from conftest import (
    DEMO_COURSE,
    KALEM,
    copy_fixtures,
    edit_json,
    fixture_ocr_texts,
    make_rt,
    read_jsonl,
    run_cli,
    substrings_12,
)
from ogrenmen_kalem import plan as PL
from ogrenmen_kalem.common import KalemError, course_by_code, round_half_up

FORBIDDEN = ("tahmin", "çıkacak", "kesin", "garanti")


@pytest.fixture
def plan_out(tmp_path):
    out = tmp_path / "out"
    assert run_cli("plan", "--course", "DEMO", "--period", "2026", "--dry-run", "--fixtures", str(KALEM),
                   "--out", str(out)) == 0
    return out


def _plan(out):
    rows = read_jsonl(out / "exam_priority_plans.jsonl")
    assert len(rows) == 1
    return rows[0]


def test_plan_title_exact(plan_out):
    row = _plan(plan_out)
    assert row["plan"]["title"] == "Sıklık analizine göre öncelikler"
    assert (row["status"], row["course_id"], row["period"]) == ("pending_review", DEMO_COURSE, "2026")
    assert row["evidence_count"] == row["plan"]["evidence_count"] == 10
    contracts.validate("exam-priority-plan", row["plan"])


def test_forbidden_words(plan_out):
    text = json.dumps(_plan(plan_out)["plan"], ensure_ascii=False).lower()
    for word in FORBIDDEN:
        assert word not in text


def test_plan_never_contains_ocr_text(plan_out):
    plan = _plan(plan_out)["plan"]
    text = json.dumps(plan, ensure_ascii=False)
    assert "ocr_text" not in text
    hits = [s for s in substrings_12(fixture_ocr_texts()) if s in text]
    assert hits == []


def test_plan_rows_ranked_by_years_then_hits(plan_out):
    plan = _plan(plan_out)["plan"]
    rows = plan["rows"]
    assert plan["years_total"] == 2 and [r["rank"] for r in rows] == list(range(1, len(rows) + 1))
    assert [(r["topic"], r["years"], r["hits"]) for r in rows[:2]] == [("Rasyonel sayılar", 2, 2),
                                                                       ("Yüzde problemleri", 2, 2)]
    keys = [(-r["years"], -r["hits"]) for r in rows]
    assert keys == sorted(keys)
    first = rows[0]
    assert first["kind"] == "hesap" and first["points_text"] == "≈10 puan" and len(first["evidence_item_ids"]) == 2
    assert first["syllabus_alignment"] == "covered_and_asked"
    proofs = [r for r in rows if r["kind"] == "ispat"]
    assert len(proofs) == 2 and all(r["syllabus_alignment"] == "asked_not_in_syllabus" for r in proofs)
    assert plan["uncovered_topics"] == ["Ondalık gösterim", "Köklü ifadeler", "Hareket problemleri"]


def test_plan_evidence_ids_are_archive_items(plan_out):
    items = {i["id"]: i for i in read_jsonl(plan_out / "exam_items.jsonl")}
    for row in _plan(plan_out)["plan"]["rows"]:
        assert all(i in items for i in row["evidence_item_ids"])
        assert row["evidence_count"] == len(row["evidence_item_ids"]) == row["hits"]


def test_plan_requires_two_years(tmp_path):
    rt = make_rt(None)
    from ogrenmen_kalem import ingest as IN

    IN.ingest_source(rt, "c97a5607-ead2-5620-b865-cf6bb93495e4")  # yalnız 2022
    course = course_by_code(rt.db, "DEMO")
    rt.fixtures = None  # yeniden oynatma kapalı
    with pytest.raises(KalemError, match="OGR-KALEM-004"):
        PL.plan_course(rt, course, "2026")
    rt.close()


def test_plan_on_dev_seed_course_uses_existing_clusters(tmp_path):
    """Taban dünyanın TYT-MAT kursu (3 yıl ÖSYM): kümeler zaten var, plan yeniden kümelemez."""
    rt = make_rt(tmp_path / "out", fixtures=None)
    course = course_by_code(rt.db, "TYT-MAT")
    res = PL.plan_course(rt, course, "YKS 2027")
    rt.close()
    plan = res["plan"]
    assert res["notes"]["clustered"] is False and plan["years_total"] == 3
    assert [r["topic"] for r in plan["rows"][:2]] == ["Rasyonel sayılarda dört işlem", "Yüzde ve kâr–zarar"]
    assert plan["rows"][0]["kind"] == "çoktan seçmeli" and plan["rows"][0]["points_text"] == "≈4 puan"
    assert plan["uncovered_topics"] == ["Ondalık gösterim"]


def test_round_half_up():
    assert [round_half_up(x) for x in (4.5, 2.5, 7.49, 0.0)] == [5, 3, 7, 0]


def test_plan_cli_writes_cost_estimate(plan_out):
    est = json.loads((plan_out / "cost_estimate.json").read_text())
    assert est["dry_run"] is True and "embedding" in est["by_purpose"]
    assert json.loads((plan_out / "priority_plan.json").read_text())["title"] == "Sıklık analizine göre öncelikler"


def _set_topic(path, item_no, topic):
    def fn(items):
        for i in items:
            if i["item_no"] == item_no:
                i["topic"] = topic
    edit_json(path, fn)


def _ocr_texts(fx):
    return [i["ocr_text"] for name in ("ocr-2022.json", "ocr-2023.json")
            for i in json.loads((fx / name).read_text(encoding="utf-8"))]


def test_plan_rejects_short_verbatim_topic(tmp_path):
    """12–19 karakterlik birebir kopya konu (OCR metninden "Etiket fiyatı 250") plana girmez (§6.4: 12+)."""
    fx = copy_fixtures(tmp_path)
    _set_topic(fx / "ocr-2022.json", 2, "Etiket fiyatı 250")
    out = tmp_path / "out"
    assert run_cli("plan", "--course", "DEMO", "--period", "2026", "--dry-run", "--fixtures", str(fx),
                   "--out", str(out)) == 0
    plan = _plan(out)["plan"]
    text = json.dumps(plan, ensure_ascii=False)
    assert "Etiket fiyatı" not in text
    assert [s for s in substrings_12(_ocr_texts(fx)) if s in text] == []
    clusters = read_jsonl(out / "exam_clusters.jsonl")
    assert not [c for c in clusters if "Etiket" in c["label"]]
