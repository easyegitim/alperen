"""run_retention ve bakım RPC'leri (tests/07_retention.sql vakalarının eşleniği)."""

from __future__ import annotations

import pytest

from conftest import as_admin, seed_json
from ogrenmen_common.errors import DbError
from ogrenmen_common.fakes.jsonl_rpc import compile_condition

SEED = seed_json("db/dev-seed.json")
ELIF = "c661b28c-81a8-5c11-9a5e-b919b5231034"
ELIF_ENR = "8bef16e2-1fb1-56d1-9530-3cd5b1ea7cf3"
LESSON = "00000000-0000-0000-0000-000000000001"


def _run(db):
    return {r["policy_id"]: r["affected_rows"] for r in db.rpc("run_retention", {})}


def test_every_enabled_policy_runs_once(db):
    result = _run(db)
    enabled = [p["id"] for p in SEED["retention_policies"] if p["enabled"]]
    assert sorted(result) == sorted(enabled)
    assert [r["policy_id"] for r in db.tables["retention_runs"]] == enabled
    assert result["memory_facts.expire"] >= 1  # tohumda valid_until 19 Ekim olan olgu var


def test_message_older_than_expiry_is_deleted(db):
    msg = db.tables["messages"][0]
    msg["expires_at"] = "2026-10-19T00:00:00Z"
    result = _run(db)
    assert result["messages.hard_delete"] == 1 and all(m["id"] != msg["id"] for m in db.tables["messages"])


def test_prompt_null_and_flag_conditions(db):
    old = [b for b in db.tables["bot_responses"]][:2]
    old[0].update(created_at="2026-09-01T00:00:00Z", flagged=False)
    old[1].update(created_at="2026-03-01T00:00:00Z", flagged=True)
    result = _run(db)
    assert result["bot_responses.prompt_null"] >= 1 and old[0]["prompt_text"] is None
    assert result["bot_responses.hard_delete"] == 0 and result["bot_responses.flagged_delete"] == 0
    assert any(b["id"] == old[1]["id"] for b in db.tables["bot_responses"])  # işaretli 365 gün kalır


def test_students_anonymize(db):
    with as_admin(db):
        db.update("students", {"status": "deleted", "deleted_at": "2026-09-15T00:00:00Z"}, where={"id": ELIF})
    mastery_before = [m for m in db.tables["mastery"] if m["enrollment_id"] == ELIF_ENR]
    result = _run(db)
    assert result["students.anonymize"] == 1
    for table in ("secure.student_pii", "secure.telegram_identities"):
        assert not [r for r in db.tables[table] if r.get("student_id") == ELIF]
    mine = [m for m in db.tables["messages"] if m["student_id"] == ELIF]
    assert mine and all(m["text_raw"] is None and m["text_llm"] is None for m in mine)
    assert not [f for f in db.tables["memory_facts"] if f["student_id"] == ELIF]
    assert all(b["prompt_text"] is None for b in db.tables["bot_responses"] if b["student_id"] == ELIF)
    assert [m for m in db.tables["mastery"] if m["enrollment_id"] == ELIF_ENR] == mastery_before
    assert db.rpc("anonymize_students", {}) == 1  # idempotent: satırlar zaten silinmiş, öğrenci yine sayılır


def test_lessons_video_raises_ops_alert(db):
    db.tables["lessons"][0]["held_at"] = "2026-09-01T00:00:00Z"
    result = _run(db)
    assert result["lessons.video"] == 1
    alerts = [a for a in db.tables["instructor_alerts"] if a["ref"].get("lesson_id") == LESSON
              and a["detail"].startswith("Ders videosu")]
    assert len(alerts) == 1 and alerts[0]["kind"] == "ops"
    assert alerts[0]["detail"] == "Ders videosu silinmeyi bekliyor: 1"
    _run(db)
    assert len([a for a in db.tables["instructor_alerts"] if a["ref"].get("lesson_id") == LESSON
                and a["detail"].startswith("Ders videosu")]) == 1


def test_closed_enrollment_handlers(db):
    enr = next(e for e in db.tables["enrollments"] if e["id"] == ELIF_ENR)
    enr.update(status="closed", ended_at="2024-09-01")
    db.tables["lessons"][0]["transcript_path"] = f"transcripts/{LESSON}.jsonl"
    mastery_before = [dict(m) for m in db.tables["mastery"] if m["enrollment_id"] == ELIF_ENR]
    result = _run(db)
    assert result["lessons.transcript"] == 1
    assert db.tables["storage_deletions"][-1]["bucket"] == "transcripts"
    assert db.tables["storage_deletions"][-1]["path"] == f"transcripts/{LESSON}.jsonl"
    assert db.tables["lessons"][0]["transcript_path"] is None
    assert result["enrollments.learning_data"] == 1
    assert all(o["quote"] is None for o in db.tables["observations"] if o["enrollment_id"] == ELIF_ENR)
    assert all(a["chosen"] == {} for a in db.tables["attempts"] if a["enrollment_id"] == ELIF_ENR)
    assert result["enrollments.closed_cleanup"] == 1
    assert not [f for f in db.tables["memory_facts"] if f["student_id"] == ELIF]
    assert [m for m in db.tables["mastery"] if m["enrollment_id"] == ELIF_ENR] == mastery_before


def test_storage_pressure_shortens_retention(db):
    db.size_overrides = {"messages": 460 * 1024 * 1024}
    total = db.rpc("compute_table_sizes", {})
    assert total > 450 * 1024 * 1024
    assert next(f for f in db.tables["runtime_flags"] if f["key"] == "storage_pressure")["value"] is True
    group = next(c for c in db.tables["tg_chats"] if c["chat_id"] == -1001000000001)
    assert group["retention_days"] == 60 and group["recording_notice_days"] == 90  # bildirim yenilemesi Worker'ın işi
    assert any(a["kind"] == "ops" and a["detail"].startswith("Veritabanı boyutu") for a in db.tables[
        "instructor_alerts"])
    assert {r["table_name"] for r in db.tables["table_sizes_daily"]} >= {"messages", "llm_calls"}
    assert not any(r["table_name"].startswith("secure.") for r in db.tables["table_sizes_daily"])


def test_recompute_is_minor_cap_facts_idle_sessions(db):
    zeynep = next(s for s in db.tables["students"] if s["public_ref"] == "s_mb5tj7ye4ql2")
    zeynep["is_minor"] = False
    assert db.rpc("recompute_is_minor", {}) == 1 and zeynep["is_minor"] is True
    base = {"student_id": ELIF, "kind": "other", "text": "Öğrenci soru sordu.", "source_message_ids": [1],
            "status": "active"}
    with as_admin(db):
        db.insert("memory_facts", [{**base, "created_at": f"2026-01-01T00:{i // 60:02d}:{i % 60:02d}Z"}
                                   for i in range(301)])
    active = len([f for f in db.tables["memory_facts"] if f["student_id"] == ELIF and f["status"] == "active"])
    assert db.rpc("cap_memory_facts", {}) == active - 300
    assert len([f for f in db.tables["memory_facts"] if f["student_id"] == ELIF and f["status"] == "active"]) == 300
    for s in db.tables["sessions"]:
        s.update(last_activity_at="2026-10-20T08:00:00Z")  # 1 saat önce: boşa düşmez
    db.tables["sessions"][0].update(last_activity_at="2026-10-19T00:00:00Z", state="awaiting_answer", hint_level=2)
    assert db.rpc("cron_idle_sessions", {}) == 1
    assert db.tables["sessions"][0]["state"] == "idle" and db.tables["sessions"][0]["hint_level"] == 0
    assert db.rpc("cron_idle_sessions", {}) == 0


def test_condition_parser():
    cond = compile_condition("valid_until is null and status = 'active'")
    assert cond({"valid_until": None, "status": "active"})
    assert not cond({"valid_until": "2026-10-01", "status": "active"})
    assert compile_condition("flagged = false")({"flagged": False})
    assert not compile_condition("flagged = false")({"flagged": None})
    assert compile_condition("x is not null")({"x": 1})
    with pytest.raises(DbError):
        compile_condition("created_at < now()")
