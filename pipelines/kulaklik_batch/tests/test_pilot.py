"""Pilot ölçütleri (``pilot_metrics``): fixture değerleri, az veride null, ayrıntıda kimlik yok, sentetik vakalar."""

from __future__ import annotations

import json
from datetime import date

from ogrenmen_common.fakes.jsonl_db import JsonlDb

from conftest import KULAKLIK, all_uuids_of_people, make_rt, read_jsonl, run_cli
from ogrenmen_kulaklik import pilot as P
from ogrenmen_kulaklik.common import Window

WEEK = Window(date(2026, 10, 13), date(2026, 10, 20))
SIX = ("diagnostic_agreement", "citation_relevance", "priority_uplift", "flagged_response_share", "degraded_share",
       "question_accuracy")


def _metrics(out):
    return {r["metric"]: r for r in read_jsonl(out / "pilot_metrics.jsonl")}


def test_fixture_metrics(tmp_path):
    assert run_cli("metrics", "--dry-run", "--fixtures", str(KULAKLIK), "--out", str(tmp_path)) == 0
    m = _metrics(tmp_path)
    assert set(SIX) <= set(m) and set(m) == set(P.METRICS)
    assert len(read_jsonl(tmp_path / "pilot_metrics.jsonl")) == 8
    assert {r["period"] for r in m.values()} == {"2026-10-12"}  # haftanın pazartesisi
    f = m["flagged_response_share"]
    assert (f["detail"]["flagged"], f["detail"]["n"], f["value"]) == (4, 30, round(4 / 30, 4))
    d = m["degraded_share"]
    assert (d["detail"]["degraded"], d["detail"]["schema_invalid"], d["value"]) == (3, 2, round(5 / 30, 4))
    q = m["question_accuracy"]
    assert (q["detail"]["approved"], q["detail"]["rejected"], q["value"]) == (8, 3, 0.7273)
    assert q["detail"]["by_reason"] == {"SymPy": 1, "Çeldirici": 1, "Şekil": 1}
    c = m["cost_per_student"]
    assert c["detail"]["lesson_usd"] == 0.9 and c["detail"]["month_usd"] == 3.0
    assert c["value"] == round(3.0 / c["detail"]["active_students"], 4)  # ders analizi dahil değil
    # az veri → value=null
    for name in ("diagnostic_agreement", "citation_relevance", "priority_uplift"):
        assert m[name]["value"] is None


def test_detail_has_no_people_ids_or_names(tmp_path):
    run_cli("metrics", "--dry-run", "--fixtures", str(KULAKLIK), "--out", str(tmp_path))
    text = (tmp_path / "pilot_metrics.jsonl").read_text(encoding="utf-8")
    for uid in all_uuids_of_people():
        assert uid not in text
    for ref in ("s_qk7m2rx4tn5a", "s_vd3hp6wz2kc7", "s_mb5tj7ye4ql2", "Elif", "Mert", "Ayşe", "Selin"):
        assert ref not in text


def test_small_question_sample_gives_null():
    db = JsonlDb({"questions": [{"id": f"q{i}", "source": "llm", "status": "approved",
                                 "reviewed_at": "2026-10-14T10:00:00Z"} for i in range(9)]})
    res = P.question_accuracy(db, WEEK)
    assert res["value"] is None and res["detail"]["n"] == 9


def _db_with_diagnostic(n_low: int, n_agree: int) -> JsonlDb:
    skills = [f"tyt.mat.s{i}" for i in range(n_low)]
    per_skill = [{"skill_id": s, "p": 0.2} for s in skills] + [{"skill_id": "tyt.mat.ok", "p": 0.9}]
    questions = [{"id": f"q-{s}", "skill_ids": [s]} for s in skills]
    attempts = []
    for i, s in enumerate(skills):
        correct = i >= n_agree  # ilk n_agree kazanımda pratik yanlış → örtüşme
        attempts += [{"id": 2 * i + k, "enrollment_id": "e1", "question_id": f"q-{s}", "context": "practice",
                      "is_correct": correct, "created_at": "2026-10-03T10:00:00Z"} for k in (1, 2)]
    session = {"id": "d1", "enrollment_id": "e1", "status": "finished", "finished_at": "2026-09-28T10:00:00Z",
               "result": {"per_skill": per_skill}}
    return JsonlDb({"diagnostic_sessions": [session],
                    "questions": questions, "attempts": attempts})


def test_diagnostic_agreement():
    res = P.diagnostic_agreement(_db_with_diagnostic(10, 7), WEEK)
    assert res["detail"]["n"] == 10 and res["detail"]["numerator"] == 7 and res["value"] == 0.7
    small = P.diagnostic_agreement(_db_with_diagnostic(4, 4), WEEK)
    assert small["value"] is None and small["detail"]["n"] == 4


def test_citation_relevance():
    rows = [{"id": f"c{i}", "status": "kept", "relevance": 2 if i < 8 else 1} for i in range(10)]
    rows += [{"id": "c-removed", "status": "removed", "relevance": 0}, {"id": "c-unrated", "status": "kept",
                                                                        "relevance": None}]
    res = P.citation_relevance(JsonlDb({"citations": rows}), WEEK)
    assert res["value"] == 0.8 and res["detail"] == {"n_rated": 10, "n_total": 11, "n_supported": 8}


def test_priority_uplift():
    plan = {"id": "p1", "course_id": "c1", "status": "approved", "approved_at": "2026-09-20T00:00:00Z",
            "plan": {"rows": [{"skill_id": "s.in"}]}}
    hist = [
        {"id": 1, "enrollment_id": "e1", "skill_id": "s.in", "p_before": 0.3, "p_after": 0.4,
         "created_at": "2026-09-21T00:00:00Z"},
        {"id": 2, "enrollment_id": "e1", "skill_id": "s.in", "p_before": 0.4, "p_after": 0.6,
         "created_at": "2026-09-25T00:00:00Z"},
        {"id": 3, "enrollment_id": "e1", "skill_id": "s.out", "p_before": 0.5, "p_after": 0.55,
         "created_at": "2026-09-22T00:00:00Z"},
        {"id": 4, "enrollment_id": "e1", "skill_id": "s.in", "p_before": 0.6, "p_after": 0.9,
         "created_at": "2026-10-10T00:00:00Z"},  # 14 günlük pencerenin dışında
    ]
    db = JsonlDb({"exam_priority_plans": [plan], "courses": [{"id": "c1", "curriculum_id": "cur"}],
                  "enrollments": [{"id": "e1", "curriculum_id": "cur", "student_id": "x"}], "mastery_history": hist})
    res = P.priority_uplift(db, WEEK)
    assert res["detail"]["delta_in"] == 0.3 and res["detail"]["delta_out"] == 0.05 and res["value"] == 0.25
    assert res["detail"]["n_students"] == 1


def test_cost_per_student_excludes_lesson_purposes():
    db = JsonlDb({"spend_ledger": [
        {"day": "2026-10-02", "purpose": "chat", "provider": "gemini-paid", "cost_usd": 0.2},
        {"day": "2026-10-03", "purpose": "lesson_analysis", "provider": "gemini-paid", "cost_usd": 5.0},
        {"day": "2026-09-30", "purpose": "chat", "provider": "gemini-paid", "cost_usd": 9.0},  # önceki ay
    ], "runtime_flags": [{"key": "cap_excluded_purposes", "value": ["lesson_analysis", "transcribe", "diarize"]}],
        "students": [{"id": "a", "public_ref": "s_aaaaaaaaaaaa", "status": "active"},
                     {"id": "b", "public_ref": "s_bbbbbbbbbbbb", "status": "active"}]})
    res = P.cost_per_student(db, WEEK)
    assert res["value"] == 0.1 and res["detail"]["lesson_usd"] == 5.0 and res["detail"]["month_usd"] == 0.2


def test_distractor_report_counts_unused():
    q = {"id": "q1", "status": "approved", "options": [
        {"key": "A", "misconception_tag": None}, {"key": "B", "misconception_tag": "t.b"},
        {"key": "C", "misconception_tag": "t.c"}, {"key": "D", "misconception_tag": None}]}
    db = JsonlDb({"questions": [q], "attempts": [{"id": 1, "question_id": "q1", "chosen": {"key": "B"}},
                                                 {"id": 2, "question_id": "q1", "chosen": {"key": "A"}}]})
    rep = P.distractor_report(db)
    assert rep["n"] == 2 and rep["unused"] == 1 and rep["value"] == 0.5
    assert rep["by_tag"]["t.b"]["rate"] == 0.5 and rep["rewrite_candidates"][0]["tag"] == "t.c"


def test_metrics_upsert_is_idempotent(tmp_path):
    rt = make_rt(tmp_path)
    rows = P.compute(rt.db, WEEK)
    P.write(rt.db, rows, rt.clock())
    P.write(rt.db, rows, rt.clock())
    stored = [r for r in rt.db.select("pilot_metrics") if r["period"] == "2026-10-12"]
    assert len(stored) == 8
    assert json.dumps(stored, ensure_ascii=False)
    rt.close()


def test_unreadable_source_gives_null_not_crash(tmp_path):
    from ogrenmen_common.errors import DbPermissionError

    rt = make_rt(tmp_path)
    original = rt.db.select

    def select(table, **kwargs):
        if table == "citations":
            raise DbPermissionError("OGR-DB-001 permission denied for table citations")
        return original(table, **kwargs)

    rt.db.select = select
    rows = {r["metric"]: r for r in P.compute(rt.db, WEEK)}
    assert rows["citation_relevance"]["value"] is None and rows["citation_relevance"]["detail"]["unavailable"]
    assert rows["flagged_response_share"]["value"] == round(4 / 30, 4)
    rt.close()
