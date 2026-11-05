"""JsonlDb (v2): yükleme/katman kuralı, v2 şema denetimi, tetikleyiciler, süzgeçler, out/*.jsonl."""

from __future__ import annotations

import json

import pytest

from conftest import FIXTURES, read_jsonl, seed_json
from ogrenmen_common.adapters.base import contains, gte, in_, is_null, lt, neq, not_null
from ogrenmen_common.errors import DbError, DbPermissionError, RpcError
from ogrenmen_common.fakes import JsonlDb
from ogrenmen_common.fakes.jsonl_db import (
    KNOWN_TABLES,
    LEGACY_PIPELINE_TABLES,
    LEGACY_V1_TABLES,
    fixture_table_name,
    load_fixture_dir,
)

SEED = seed_json("db/dev-seed.json")
CUR = "7a988b84-8937-5242-8c35-ddbc4ea9216d"


def test_loads_dev_seed(db):
    for table in ("students", "skills", "questions", "llm_calls", "memory_facts"):
        assert len(db.tables[table]) == len(SEED[table])
    assert db.select("curricula", where={"status": "active"})[0]["code"] == "TYT-MAT"
    assert db.get("settings", key="default_period")["value"] == "YKS 2027"


def test_legacy_v1_tables_are_dropped(db):
    """Telegram/kota/oturum/saklama tabloları v2'de yok: taban dünyadan atlanır, yazılamaz, okunamaz."""
    assert not (LEGACY_V1_TABLES & set(db.tables))
    assert not (LEGACY_V1_TABLES & KNOWN_TABLES)
    for table in ("tg_chats", "chat_roles", "tg_updates", "sessions", "messages", "quota_tiers", "diagnostic_sessions",
                  "secure.telegram_identities"):
        assert table in LEGACY_V1_TABLES
        with pytest.raises(DbError, match="bilinmeyen tablo"):
            db.select(table)
        with pytest.raises(DbError, match="v2 şemasında yok"):
            db.insert(table, {"id": 1})


def test_legacy_pipeline_tables_are_a_small_explicit_set():
    assert LEGACY_PIPELINE_TABLES == {"generation_requests", "exam_clusters", "instructor_alerts", "proactive_messages",
                                      "provider_health", "diagnostic_tests", "staff", "staff_students",
                                      "secure.student_pii"}
    assert not (LEGACY_PIPELINE_TABLES & LEGACY_V1_TABLES)


def test_fixture_name_mapping():
    assert fixture_table_name("exam_sources") == "exam_sources"
    assert fixture_table_name("generation_requests") == "generation_requests"
    assert fixture_table_name("llm-calls-month") == "llm_calls"
    assert fixture_table_name("messages-day") is None and fixture_table_name("requests") is None
    assert fixture_table_name("ocr-2022") is None and fixture_table_name("syllabus") is None
    tablet = load_fixture_dir(FIXTURES / "tablet")
    assert list(tablet) == ["generation_requests"] and len(tablet["generation_requests"]) == 3


def test_base_false_and_file_path(clock):
    only = JsonlDb.from_fixtures(FIXTURES / "kalem", base=False, clock=clock)
    assert set(only.tables) == {"courses", "exam_sources"}
    with pytest.raises(DbError):
        JsonlDb.from_fixtures(FIXTURES / "yok-boyle-dizin")


def test_service_role_reads_secure_tables(db):
    assert db.role == "service_role"
    assert db.select("secure.answer_keys")
    assert db.select("audit.events") == []


def test_unprivileged_roles_have_no_matrix_entry(db):
    """grants-v2.json yalnız service_role'u tanır; başka bir rol (ör. authenticated) hiçbir tabloya erişemez."""
    anon = JsonlDb({"students": []}, role="authenticated")
    with pytest.raises(DbPermissionError):
        anon.select("students")
    with pytest.raises(DbPermissionError):
        anon.insert("students", {"public_ref": "s_x"})


def test_legacy_role_name_maps_to_service_role(clock):
    legacy = JsonlDb.from_fixtures(role="batch_worker", clock=clock)
    assert legacy.select("secure.answer_keys")  # v1 adı service_role'a eşlenir
    assert legacy.insert("llm_calls", {"purpose": "chat", "model": "m", "status": "ok"}, returning="representation")


def test_writes_reject_columns_missing_in_v2(db):
    with pytest.raises(DbError, match="llm_calls.olmayan v2"):
        db.insert("llm_calls", {"purpose": "chat", "model": "m", "status": "ok", "olmayan": 1})
    with pytest.raises(DbError, match="questions.tg_chat_id"):
        db.update("questions", {"tg_chat_id": 1}, where={"status": "draft"})
    with pytest.raises(DbError, match="runtime_flags.olmayan"):
        db.select("runtime_flags", columns=["key", "olmayan"])
    # pipeline mirası sütunlar ve tablolar serbest
    db.insert("exam_items", {"source_id": SEED["exam_sources"][0]["id"], "item_no": 99, "cluster_id": None})
    db.insert("instructor_alerts", {"kind": "ops", "severity": "warning", "detail": "deneme"})


def test_question_status_guards(db):
    q = db.select("questions", where={"source": "llm", "status": "pending_review"}, limit=1)[0]
    with pytest.raises(RpcError, match="OGR-Q-004"):
        db.update("questions", {"status": "approved"}, where={"id": q["id"]})
    with pytest.raises(RpcError, match="OGR-Q-004"):
        db.update("questions", {"review_note": "elle"}, where={"id": q["id"]})


@pytest.mark.parametrize("table", ["exam_items", "exam_clusters"])
def test_exam_tables_are_deletable_and_updatable(db, table):
    """v2'de worker service_role'dur: silme/güncelleme serbest (RLS aşılır)."""
    row = db.select(table, limit=1)[0]
    assert db.update(table, {"topic" if table == "exam_items" else "label": "x"}, where={"id": row["id"]},
                     returning="representation")
    assert db.delete(table, where={"id": row["id"]}) == 1
    assert db.get(table, id=row["id"]) is None


def test_generation_requests_roundtrip(db):
    base = {"curriculum_id": CUR, "skill_id": "tyt.mat.temel.rasyonel-sayilar", "topic": "Kesirlerde toplama",
            "points": 10}
    row = db.insert("generation_requests", {**base, "kind": "exam_variant"})[0]
    assert row["kind"] == "exam_variant" and row["difficulty_band"] == "mid"
    done = db.update("generation_requests", {"served_question_id": None, "served_at": "2026-10-20T09:00:00Z"},
                     where={"id": row["id"]}, returning="representation")
    assert done[0]["served_at"] == "2026-10-20T09:00:00Z"


def test_upsert_merge_keeps_unsent_columns(db):
    """PostgREST ``merge-duplicates`` yalnız gönderilen sütunları günceller; varsayılanlar mevcut satırı ezmez."""
    cl = db.select("exam_clusters", limit=1)[0]
    assert cl["item_count"] == 3
    merged = db.insert("exam_clusters", {"id": cl["id"], "course_id": cl["course_id"], "label": "Yeni etiket"},
                       on_conflict="merge")[0]
    assert merged["label"] == "Yeni etiket"
    assert {k: v for k, v in merged.items() if k != "label"} == {k: v for k, v in cl.items() if k != "label"}
    with pytest.raises(DbError, match="çakışması"):
        db.insert("exam_clusters", {"id": cl["id"], "course_id": cl["course_id"]})
    assert db.insert("exam_clusters", {"id": cl["id"]}, on_conflict="ignore") == []
    fresh = db.insert("exam_clusters", {"course_id": cl["course_id"], "label": "Yeni küme"}, on_conflict="merge")[0]
    assert fresh["id"] != cl["id"] and fresh["item_count"] == 0  # gerçek ekleme: varsayılanlar uygulanır
    alert = db.insert("instructor_alerts", {"kind": "ops", "severity": "warning", "detail": "deneme"})[0]
    db.update("instructor_alerts", {"status": "done"}, where={"id": alert["id"]})
    again = db.insert("instructor_alerts", {"id": alert["id"], "detail": "güncel"}, on_conflict="merge")[0]
    assert again["status"] == "done" and again["detail"] == "güncel" and again["created_at"] == alert["created_at"]


def test_fixture_rows_without_primary_key_are_all_kept(tmp_path, clock):
    rows = [{"purpose": "chat", "provider": "gemini-paid", "model": "gemini-2.5-flash-lite", "status": "ok",
             "cost_usd": 0.01, "created_at": "2026-10-19T10:00:00Z"},
            {"purpose": "chat", "provider": "gemini-paid", "model": "gemini-2.5-flash-lite", "status": "ok",
             "cost_usd": 0.02, "created_at": "2026-10-19T11:00:00Z"},
            {"purpose": "nightly_facts", "provider": "gemini-paid", "model": "gemini-2.5-flash-lite",
             "status": "ok", "cost_usd": 0.03, "created_at": "2026-10-19T12:00:00Z"}]
    (tmp_path / "llm-calls-month.json").write_text(json.dumps(rows), encoding="utf-8")
    loaded = load_fixture_dir(tmp_path)
    assert len(loaded["llm_calls"]) == 3
    assert [r["cost_usd"] for r in loaded["llm_calls"]] == [0.01, 0.02, 0.03]
    world = JsonlDb.from_fixtures(tmp_path, base=False, clock=clock)
    assert len(world.tables["llm_calls"]) == 3


def _llm_question(**over):
    row = {"curriculum_id": CUR, "skill_ids": ["tyt.mat.temel.rasyonel-sayilar"], "kind": "mcq",
           "stem": "3/4 + 1/8 toplamı kaçtır?", "source": "llm", "content_hash": "h-test-1",
           "options": [{"key": "A", "text": "7/8", "misconception_tag": None},
                       {"key": "B", "text": "4/12", "misconception_tag": "rasyonel.pay-payda-ayri-toplama"},
                       {"key": "C", "text": "1", "misconception_tag": None},
                       {"key": "D", "text": "5/8", "misconception_tag": None}]}
    row.update(over)
    return row


def test_question_insert_guards(db):
    with pytest.raises(RpcError, match="OGR-Q-001"):
        db.insert("questions", _llm_question(status="approved"))
    with pytest.raises(RpcError, match="OGR-CURR-001"):
        db.insert("questions", _llm_question(skill_ids=["tyt.mat.yok"]))
    q = db.insert("questions", _llm_question(status="pending_review"))[0]
    assert q["status"] == "pending_review" and q["verification"]["sympy"] == "pending"
    with pytest.raises(DbError, match="content_hash"):
        db.insert("questions", _llm_question())


def test_identity_uuid_and_defaults(db, clock):
    before = max(r["id"] for r in db.tables["memory_facts"])
    fact = db.insert("memory_facts", {"student_id": SEED["students"][0]["id"], "kind": "other",
                                      "text": "Öğrenci yeni bir konu sordu.", "source_message_ids": [1]})[0]
    assert fact["id"] == before + 1 and fact["status"] == "active" and fact["valid_from"] == "2026-10-20"
    assert fact["created_at"] == "2026-10-20T09:00:00Z"
    alert = db.insert("instructor_alerts", {"kind": "ops", "severity": "warning", "detail": "deneme"})[0]
    other = JsonlDb.from_fixtures(clock=clock).insert("instructor_alerts", {"kind": "ops", "severity": "warning",
                                                                            "detail": "deneme"})[0]
    assert alert["id"] == other["id"]  # deterministik uuid5
    assert alert["status"] == "open" and alert["ref"] == {}
    call = db.insert("llm_calls", {"purpose": "coach", "model": "claude-haiku-4-5", "status": "ok"})[0]
    assert call["provider"] == "anthropic" and call["cache_read_tokens"] == 0 and call["cache_write_tokens"] == 0


def test_llm_calls_trigger_rolls_up_istanbul_day(db):
    db.insert("llm_calls", {"purpose": "nightly_facts", "provider": "gemini-paid", "model": "gemini-2.5-flash-lite",
                            "status": "ok", "tokens_in": 100, "tokens_out": 10, "cache_read_tokens": 40,
                            "cost_usd": 0.01, "created_at": "2026-10-19T22:30:00Z"})
    led = [r for r in db.tables["spend_ledger"] if r["purpose"] == "nightly_facts"]
    by_day = {r["day"]: r for r in led}
    assert by_day["2026-10-20"]["calls"] == 1 and by_day["2026-10-20"]["cost_usd"] == 0.01  # 01:30 TRT
    assert by_day["2026-10-20"]["cache_read_tokens"] == 40
    assert by_day["2026-10-19"]["calls"] == 1  # tohum satırı dokunulmadı
    with pytest.raises(DbError, match="status"):
        db.insert("llm_calls", {"purpose": "chat", "provider": "x", "model": "y", "status": "cooldown_skip"})
    with pytest.raises(DbError, match="purpose"):
        db.insert("llm_calls", {"purpose": "", "provider": "x", "model": "y", "status": "ok"})


def test_filters_and_order(db):
    assert {r["status"] for r in db.select("questions", where={"status": in_(["approved", "draft"])})} <= {
        "approved", "draft"}
    late = db.select("llm_calls", where={"created_at": gte("2026-10-19T00:00:00Z")})
    assert late and all(r["created_at"] >= "2026-10-19" for r in late)
    early = db.select("llm_calls", where={"created_at": lt("2026-10-15")})
    assert all(r["created_at"] < "2026-10-15" for r in early)
    assert all(r["error_code"] is None for r in db.select("llm_calls", where={"error_code": is_null()}))
    assert all(r["figure_id"] for r in db.select("questions", where={"figure_id": not_null()}))
    assert all(r["source"] != "diagnostic" for r in db.select("questions", where={"source": neq("diagnostic")}))
    tagged = db.select("questions", where={"skill_ids": contains(["tyt.mat.temel.sayilar"])})
    assert tagged and all("tyt.mat.temel.sayilar" in r["skill_ids"] for r in tagged)
    desc = db.select("llm_calls", order="-created_at", limit=3)
    assert [r["created_at"] for r in desc] == sorted([r["created_at"] for r in desc], reverse=True)
    nulls = db.select("llm_calls", order="error_code.desc")
    assert nulls[0]["error_code"] is None  # Postgres: DESC'de null başta
    asc = db.select("llm_calls", order="error_code")
    assert asc[-1]["error_code"] is None


def test_flush_writes_only_written_rows_and_redacts(db, out):
    db.update("llm_calls", {"error_code": "x"}, where={"id": 1})
    q = db.select("questions", where={"source": "llm", "status": "pending_review"}, limit=1)[0]
    db.rpc("register_answer_key", {"p_question": q["id"], "p_key": {
        "correct_option": "A", "solution": "Adım adım çözüm metni.", "sympy_status": "not_applicable"}})
    if True:
        db.delete("exam_items", where={"id": db.select("exam_items", limit=1)[0]["id"]})
    paths = {p.name for p in db.flush()}
    assert {"llm_calls.jsonl", "questions.jsonl", "rpc_calls.jsonl", "deletions.jsonl"} <= paths
    assert not any(p.startswith("secure.") for p in paths)
    assert [r["id"] for r in read_jsonl(out / "llm_calls.jsonl")] == [1]
    call = read_jsonl(out / "rpc_calls.jsonl")[0]
    assert call["rpc"] == "register_answer_key" and call["params"]["p_key"] == {"redacted": True,
                                                                                "sympy_status": "not_applicable"}
    text = "\n".join((out / n).read_text(encoding="utf-8") for n in paths)
    assert "correct_option" not in text and "Adım adım çözüm" not in text
    assert read_jsonl(out / "deletions.jsonl")[0]["table"] == "exam_items"
    assert json.loads((out / "questions.jsonl").read_text(encoding="utf-8").splitlines()[0])["id"] == q["id"]


def test_write_log_marks_rpc_provenance(db):
    q = db.select("questions", where={"source": "llm", "status": "pending_review"}, limit=1)[0]
    db.rpc("register_answer_key", {"p_question": q["id"], "p_key": {
        "correct_option": "A", "solution": "Adım adım çözüm metni.", "sympy_status": "not_applicable"}})
    vias = {(w["table"], w["via"]) for w in db.write_log}
    assert ("questions", "rpc:register_answer_key") in vias
    assert all(w["via"] != "direct" for w in db.write_log if w["table"] == "questions")


def test_unknown_rpc_and_bad_params(db):
    with pytest.raises(RpcError, match="OGR-RPC-001"):
        db.rpc("grade_attempt", {})
    with pytest.raises(RpcError, match="OGR-RPC-001"):
        db.rpc("check_spend", {"purpose": "chat"})
    assert db.rpc_log[-1]["error"].startswith("OGR-RPC-001")


def test_unknown_table(db):
    with pytest.raises(DbError, match="bilinmeyen tablo"):
        db.select("nope")
    with pytest.raises(DbError):
        db.update("llm_calls", {"error_code": "x"}, where={})
