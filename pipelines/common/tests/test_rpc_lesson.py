"""Ders RPC eşlenikleri: register_lesson, resolve_lesson_labels, profile_for_prompt, write_lesson_analysis,
confirm_video_deleted (§3.9 "Pipelines")."""

from __future__ import annotations

import copy

import pytest

from conftest import seed_json
from ogrenmen_common.errors import RpcError

LESSON = "00000000-0000-0000-0000-000000000001"
AYSE = "de70e65e-1410-5026-a773-c5e55a3e6368"
MERT_ENR = "1899cde6-c497-5b14-8051-882f44649013"
ANALYSIS = seed_json("ders/analysis-01.json")


def test_register_lesson(db):
    lid = db.rpc("register_lesson", {"p_student_ref": "s_qk7m2rx4tn5a", "p_staff_id": AYSE,
                                     "p_held_at": "2026-10-20T18:00:00Z", "p_duration": 90,
                                     "p_video_ref": "local:ders-02.mp4"})
    row = db.get("lessons", id=lid)
    assert row["status"] == "uploaded" and row["enrollment_id"] == "8bef16e2-1fb1-56d1-9530-3cd5b1ea7cf3"
    assert row["held_at"] == "2026-10-20T18:00:00Z" and row["video_ref"] == "local:ders-02.mp4"
    assert [w["table"] for w in db.write_log if w["via"] == "rpc:register_lesson"][0] == "lessons"


@pytest.mark.parametrize("params", [
    {"p_student_ref": "c661b28c-81a8-5c11-9a5e-b919b5231034", "p_staff_id": AYSE, "p_held_at": "2026-10-20"},
    {"p_student_ref": "s_aaaaaaaaaaaa", "p_staff_id": AYSE, "p_held_at": "2026-10-20"},
    {"p_student_ref": "s_qk7m2rx4tn5a", "p_staff_id": "00000000-0000-0000-0000-000000000000",
     "p_held_at": "2026-10-20"},
])
def test_register_lesson_rejects(db, params):
    with pytest.raises(RpcError, match="OGR-LESSON-002"):
        db.rpc("register_lesson", params)


def test_resolve_lesson_labels_match_fixture_and_hide_names(db):
    labels = db.rpc("resolve_lesson_labels", {"p_lesson": LESSON})
    expected = seed_json("ders/labels.json")
    assert sorted((r["hash"], r["label"]) for r in labels) == sorted((r["hash"], r["label"]) for r in expected)
    assert "Elif" not in str(labels) and "Ayşe" not in str(labels)
    assert any(e["action"] == "RPC:resolve_lesson_labels" for e in db.tables["audit.events"])


def test_profile_for_prompt_has_bands_not_percentages(db):
    prof = db.rpc("profile_for_prompt", {"p_enrollment": MERT_ENR})
    assert set(prof) == {"weak", "misconceptions", "prereq_hint", "explanation_notes", "weekly_line"}
    assert all(set(w) == {"skill_id", "name", "band"} for w in prof["weak"])
    assert all(w["band"] in ("düşük", "orta", "yüksek") for w in prof["weak"])
    min_ev = 5
    reliable = [m for m in db.tables["mastery"] if m["enrollment_id"] == MERT_ENR and m["evidence_count"] >= min_ev]
    assert len(prof["weak"]) == min(3, len(reliable))
    assert "Paylar ve paydalar ayrı ayrı toplanmaz; önce paydaları eşitleyelim." in prof["misconceptions"]
    assert prof["weekly_line"].startswith("Öğrenci bu hafta")
    assert "%" not in str(prof) and all("p" not in w for w in prof["weak"])
    assert db.rpc("profile_for_prompt", {"p_enrollment": "yok"}) is None


def test_prereq_hint_rule(db):
    from ogrenmen_common.fakes.jsonl_rpc import infer_prereq_gap

    sp = next(s for s in db.tables["skill_prerequisites"])
    db.tables["mastery"] = [m for m in db.tables["mastery"] if m["enrollment_id"] != MERT_ENR]
    base = {"enrollment_id": MERT_ENR, "curriculum_id": sp["curriculum_id"], "last_observation_id": None,
            "last_evidence_at": None, "updated_at": None}
    db.tables["mastery"] += [{**base, "skill_id": sp["skill_id"], "p": 0.3, "evidence_count": 6},
                             {**base, "skill_id": sp["prereq_id"], "p": 0.3, "evidence_count": 6}]
    name = next(s["name"] for s in db.tables["skills"] if s["id"] == sp["prereq_id"])
    assert infer_prereq_gap(db, MERT_ENR, sp["skill_id"]) == f"Asıl sorun alt konuda olabilir: {name}"
    db.tables["mastery"][-1]["evidence_count"] = 4  # ön koşul güvenilir değil → ipucu yok
    assert infer_prereq_gap(db, MERT_ENR, sp["skill_id"]) is None


def test_write_lesson_analysis_claims_not_observations(db, out):
    obs_before = len(db.tables["observations"])
    aid = db.rpc("write_lesson_analysis", {"p_lesson": LESSON, "p_seed_profile": {"weak": []},
                                           "p_analysis": ANALYSIS, "p_model": "gemini-2.5-pro", "p_cost": 0.31})
    analysis = db.get("lesson_analyses", id=aid)
    assert analysis["status"] == "draft" and analysis["version"] == 2  # tohumda sürüm 1 var
    claims = [c for c in db.tables["lesson_claims"] if c["analysis_id"] == aid]
    kinds = [c["kind"] for c in claims]
    assert kinds.count("talk") == 1 and kinds.count("skill_mastery") == len(ANALYSIS["skills"])
    talk = next(c for c in claims if c["kind"] == "talk")
    assert talk["value"] == {k: ANALYSIS["talk"][k] for k in ("student_ratio", "student_questions", "attention",
                                                               "morale")}
    assert talk["speaker"] == "EĞİTMEN" and talk["t_start_sec"] == 0
    assert all(c["status"] == "pending" and c["quote"] for c in claims)
    assert len(db.tables["observations"]) == obs_before
    assert db.get("lessons", id=LESSON)["status"] == "analyzed"
    alerts = [a for a in db.tables["instructor_alerts"] if a["ref"].get("lesson_id") == LESSON and a["kind"] == "ops"]
    assert len(alerts) == 1 and alerts[0]["detail"] == "Ders raporu onay bekliyor" and alerts[0]["student_id"] is None
    db.rpc("write_lesson_analysis", {"p_lesson": LESSON, "p_seed_profile": {}, "p_analysis": ANALYSIS,
                                     "p_model": "gemini-2.5-pro"})
    assert len([a for a in db.tables["instructor_alerts"] if a["ref"].get("lesson_id") == LESSON]) == 1
    names = {p.name for p in db.flush()}
    assert "observations.jsonl" not in names and {"lesson_claims.jsonl", "lesson_analyses.jsonl"} <= names


def test_write_lesson_analysis_rejects_unknown_skill(db):
    bad = copy.deepcopy(ANALYSIS)
    bad["skills"][0]["skill_id"] = "tyt.mat.yok-boyle"
    with pytest.raises(RpcError, match="OGR-CURR-001"):
        db.rpc("write_lesson_analysis", {"p_lesson": LESSON, "p_seed_profile": {}, "p_analysis": bad,
                                         "p_model": "m"})
    assert not any(a["lesson_id"] == LESSON and a["version"] > 1 for a in db.tables["lesson_analyses"])


def test_confirm_video_deleted_queues_two_notices_once(db):
    db.rpc("confirm_video_deleted", {"p_lesson": LESSON})
    assert db.get("lessons", id=LESSON)["video_deleted_at"] == "2026-10-20T09:00:00Z"
    rows = [p for p in db.tables["proactive_messages"] if p["template_id"] == "video_deleted"]
    assert sorted((r["recipient"], r["chat_id"]) for r in rows) == [("guardian", None), ("student", 700000001)]
    db.rpc("confirm_video_deleted", {"p_lesson": LESSON})
    assert len([p for p in db.tables["proactive_messages"] if p["template_id"] == "video_deleted"]) == 2
