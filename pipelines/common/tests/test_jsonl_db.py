"""JsonlDb: yükleme/katman kuralı, batch_worker yetki taklidi, tetikleyiciler, süzgeçler, out/*.jsonl."""

from __future__ import annotations

import json

import pytest

from conftest import FIXTURES, as_admin, read_jsonl, seed_json
from ogrenmen_common.adapters.base import contains, gte, in_, is_null, lt, neq, not_null
from ogrenmen_common.errors import DbError, DbPermissionError, RpcError
from ogrenmen_common.fakes import JsonlDb
from ogrenmen_common.fakes.jsonl_db import fixture_table_name, load_fixture_dir

SEED = seed_json("db/dev-seed.json")
CUR = "7a988b84-8937-5242-8c35-ddbc4ea9216d"


def test_loads_dev_seed(db):
    for table in ("students", "messages", "skills", "bot_responses", "llm_calls"):
        assert len(db.tables[table]) == len(SEED[table])
    assert db.select("curricula", where={"status": "active"})[0]["code"] == "TYT-MAT"
    assert db.get("settings", key="default_period")["value"] == "YKS 2027"


def test_fixture_dir_tables_replace_base(clock):
    kk = JsonlDb.from_fixtures(FIXTURES / "kulaklik", clock=clock)
    assert len(kk.tables["bot_responses"]) == 30
    assert sum(1 for r in kk.tables["bot_responses"] if r["flagged"]) == 4
    assert len(kk.tables["messages"]) == len(seed_json("kulaklik/messages-day.json"))
    facts = {f["id"] for f in seed_json("kulaklik/memory-facts.json")} | {
        f["id"] for f in seed_json("kulaklik/lesson-morale.json")["memory_facts"]}
    assert {f["id"] for f in kk.tables["memory_facts"]} == facts
    assert len(kk.tables["questions"]) == 12 and kk.tables["tg_chats"][0]["bot_is_admin"] is False
    assert len(kk.tables["skills"]) == len(SEED["skills"])  # dizinde olmayan tablo tabandan gelir
    assert "facts-day" not in kk.tables and "nightly_facts_output" not in kk.tables


def test_fixture_name_mapping():
    assert fixture_table_name("messages-day") == "messages"
    assert fixture_table_name("exam_sources") == "exam_sources"
    assert fixture_table_name("generation_requests") == "generation_requests"
    assert fixture_table_name("requests") == "research_requests"
    assert fixture_table_name("ocr-2022") is None and fixture_table_name("syllabus") is None
    tablet = load_fixture_dir(FIXTURES / "tablet")
    assert list(tablet) == ["generation_requests"] and len(tablet["generation_requests"]) == 3


def test_base_false_and_file_path(clock):
    only = JsonlDb.from_fixtures(FIXTURES / "kalem", base=False, clock=clock)
    assert set(only.tables) == {"courses", "exam_sources"}
    multi = JsonlDb.from_fixtures(FIXTURES / "kulaklik" / "lesson-morale.json", base=False, clock=clock)
    assert set(multi.tables) == {"lessons", "lesson_analyses", "lesson_claims", "memory_facts"}
    with pytest.raises(DbError):
        JsonlDb.from_fixtures(FIXTURES / "yok-boyle-dizin")


def test_secure_and_audit_not_readable(db):
    with pytest.raises(DbPermissionError, match="schema secure"):
        db.select("secure.answer_keys")
    with pytest.raises(DbPermissionError):
        db.select("secure.student_pii")
    with pytest.raises(DbPermissionError):
        db.select("audit.events")


def test_text_raw_never_returned(db):
    rows = db.select("messages")
    assert rows and all("text_raw" not in r for r in rows)
    assert all("text_llm" in r for r in rows)
    with pytest.raises(DbPermissionError, match="text_raw"):
        db.select("messages", columns=["id", "text_raw"])


@pytest.mark.parametrize("table,row", [
    ("observations", {"enrollment_id": "x", "skill_id": "y", "kind": "lesson"}),
    ("messages", {"chat_id": 1, "telegram_message_id": 1, "sender_role": "student", "sent_at": "2026-10-20"}),
    ("mastery", {"enrollment_id": "x", "skill_id": "y", "p": 0.5}),
    ("bot_responses", {"chat_id": 1, "purpose": "chat", "response_text": "x"}),
    ("secure.answer_keys", {"question_id": "x", "solution": "çözüm metni", "sympy_status": "verified"}),
    ("runtime_flags", {"key": "daily_cap_usd", "value": 5}),
])
def test_batch_worker_cannot_insert(db, table, row):
    with pytest.raises(DbPermissionError):
        db.insert(table, row)


def test_column_level_write_rules(db):
    msg = db.select("messages", limit=1)[0]
    assert db.update("messages", {"is_question": True}, where={"id": msg["id"]}) == []  # update varsayılanı minimal
    assert db.get("messages", id=msg["id"])["is_question"] is True
    with pytest.raises(DbPermissionError, match="RETURNING"):  # messages'ta tablo düzeyi SELECT yok (text_raw)
        db.update("messages", {"is_question": True}, where={"id": msg["id"]}, returning="representation")
    with pytest.raises(DbPermissionError):
        db.update("messages", {"text_llm": "x"}, where={"id": msg["id"]})
    fig = db.select("figures", limit=1)[0]
    with pytest.raises(DbPermissionError, match="review_status"):
        db.update("figures", {"review_status": "verified"}, where={"id": fig["id"]})
    q = db.select("questions", where={"source": "llm", "status": "pending_review"}, limit=1)[0]
    with pytest.raises(RpcError, match="OGR-Q-004"):
        db.update("questions", {"status": "approved"}, where={"id": q["id"]})
    with pytest.raises(RpcError, match="OGR-Q-004"):
        db.update("questions", {"review_note": "elle"}, where={"id": q["id"]})
    plan = db.select("exam_priority_plans", limit=1)[0]
    with pytest.raises(DbPermissionError, match="status"):
        db.update("exam_priority_plans", {"status": "approved"}, where={"id": plan["id"]})


@pytest.mark.parametrize("table", ["exam_items", "exam_clusters"])
def test_exam_tables_are_not_deletable_by_batch_worker(db, table):
    """§3.8 W sütunu ``r w u`` — ``d`` yok (yalnız koordinatör siler)."""
    row = db.select(table, limit=1)[0]
    with pytest.raises(DbPermissionError, match="delete"):
        db.delete(table, where={"id": row["id"]})
    assert db.get(table, id=row["id"]) is not None
    assert db.update(table, {"updated_at": "2026-10-20T09:00:00Z"}, where={"id": row["id"]},
                     returning="representation")  # u serbest


def test_generation_requests_update_only_served_columns(db):
    """W ``u (served_question_id, served_at)`` — ``needs_generation`` ya da başka sütun yazılamaz."""
    gr = db.select("generation_requests", limit=1)[0]
    done = db.update("generation_requests", {"served_question_id": None, "served_at": "2026-10-20T09:00:00Z"},
                     where={"id": gr["id"]}, returning="representation")
    assert done[0]["served_at"] == "2026-10-20T09:00:00Z"
    for bad in ({"needs_generation": False}, {"skill_id": "tyt.mat.temel.sayilar"}, {"kind": "exam_variant"}):
        with pytest.raises(DbPermissionError, match=next(iter(bad))):
            db.update("generation_requests", bad, where={"id": gr["id"]})


def test_generation_requests_insert_only_exam_variant(db):
    """W ``w (exam_variant, kalem)`` — RLS ``with check (kind = 'exam_variant')``."""
    base = {"curriculum_id": CUR, "skill_id": "tyt.mat.temel.rasyonel-sayilar", "topic": "Kesirlerde toplama",
            "points": 10}
    row = db.insert("generation_requests", {**base, "kind": "exam_variant"})[0]
    assert row["kind"] == "exam_variant" and row["difficulty_band"] == "mid"
    for kind in ("pool_miss", "regenerate"):
        with pytest.raises(DbPermissionError, match="row-level security"):
            db.insert("generation_requests", {**base, "kind": kind})
    with pytest.raises(DbPermissionError, match="row-level security"):
        db.insert("generation_requests", base)  # varsayılan kind = 'pool_miss'


def test_upsert_merge_keeps_unsent_columns(db):
    """PostgREST ``merge-duplicates`` yalnız gönderilen sütunları günceller; varsayılanlar mevcut satırı ezmez."""
    cl = db.select("exam_clusters", limit=1)[0]
    assert cl["item_count"] == 3
    merged = db.insert("exam_clusters", {"id": cl["id"], "course_id": cl["course_id"], "label": "Yeni etiket"},
                       on_conflict="merge")[0]
    assert merged["label"] == "Yeni etiket"
    assert {k: v for k, v in merged.items() if k != "label"} == {k: v for k, v in cl.items() if k != "label"}
    alert = db.insert("instructor_alerts", {"kind": "ops", "severity": "warning", "detail": "deneme"})[0]
    db.update("instructor_alerts", {"status": "done"}, where={"id": alert["id"]})
    with pytest.raises(DbPermissionError, match="column id of relation instructor_alerts"):
        db.insert("instructor_alerts", {"id": alert["id"], "detail": "güncel"}, on_conflict="merge")  # id yetkisiz
    with as_admin(db):
        again = db.insert("instructor_alerts", {"id": alert["id"], "detail": "güncel"}, on_conflict="merge")[0]
    assert again["status"] == "done" and again["detail"] == "güncel" and again["created_at"] == alert["created_at"]
    with pytest.raises(DbError, match="çakışması"):
        db.insert("exam_clusters", {"id": cl["id"], "course_id": cl["course_id"]})
    assert db.insert("exam_clusters", {"id": cl["id"]}, on_conflict="ignore") == []
    fresh = db.insert("exam_clusters", {"course_id": cl["course_id"], "label": "Yeni küme"}, on_conflict="merge")[0]
    assert fresh["id"] != cl["id"] and fresh["item_count"] == 0  # gerçek ekleme: varsayılanlar uygulanır


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


def test_panel_fixture_tables_keep_every_row():
    """fixtures/panel: anahtarsız satırlı tablolar (ör. consents, students) birbirini ezmez."""
    panel = FIXTURES / "panel"
    loaded = load_fixture_dir(panel)
    for name in ("consents", "students"):
        raw = seed_json(f"panel/{name}.json")
        assert isinstance(raw, list) and len(raw) > 1 and all(r.get("id") is None for r in raw)
        assert len(loaded[name]) == len(raw), name


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
    with pytest.raises(DbPermissionError, match="reviewed_by"):
        db.insert("questions", _llm_question(reviewed_by="de70e65e-1410-5026-a773-c5e55a3e6368"))
    with pytest.raises(DbPermissionError, match="review_note"):  # INSERT yetkisinde yok (yalnız inceleme RPC'leri)
        db.insert("questions", _llm_question(status="pending_review", review_note="2 deneme başarısız"))
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


def test_llm_calls_trigger_rolls_up_istanbul_day(db):
    with as_admin(db):  # created_at batch_worker'ın INSERT yetkisinde yok; geçmiş saat yalnız kurulumda verilir
        db.insert("llm_calls", {"purpose": "nightly_facts", "provider": "gemini-paid",
                                "model": "gemini-2.5-flash-lite", "status": "ok", "tokens_in": 100, "tokens_out": 10,
                                "cost_usd": 0.01, "created_at": "2026-10-19T22:30:00Z"})
    led = [r for r in db.tables["spend_ledger"] if r["purpose"] == "nightly_facts"]
    by_day = {r["day"]: r for r in led}
    assert by_day["2026-10-20"]["calls"] == 1 and by_day["2026-10-20"]["cost_usd"] == 0.01  # 01:30 TRT
    assert by_day["2026-10-19"]["calls"] == 1  # tohum satırı dokunulmadı
    with pytest.raises(DbError):
        db.insert("llm_calls", {"purpose": "chitchat", "provider": "x", "model": "y", "status": "ok"})


def test_messages_expires_at_trigger(db):
    with as_admin(db):
        row = db.insert("messages", {"chat_id": -1001000000001, "telegram_message_id": 99999, "sender_role": "student",
                                     "sent_at": "2026-10-20T08:00:00Z"})[0]
    assert row["expires_at"] == "2027-01-18T08:00:00Z"  # 90 gün


def test_filters_and_order(db):
    assert {r["status"] for r in db.select("questions", where={"status": in_(["approved", "draft"])})} <= {
        "approved", "draft"}
    late = db.select("messages", where={"sent_at": gte("2026-10-19T00:00:00Z")})
    assert late and all(r["sent_at"] >= "2026-10-19" for r in late)
    early = db.select("messages", where={"sent_at": lt("2026-10-15")})
    assert all(r["sent_at"] < "2026-10-15" for r in early)
    assert all(r["answered_at"] is None for r in db.select("messages", where={"answered_at": is_null()}))
    assert all(r["figure_id"] for r in db.select("questions", where={"figure_id": not_null()}))
    assert all(r["source"] != "diagnostic" for r in db.select("questions", where={"source": neq("diagnostic")}))
    tagged = db.select("questions", where={"skill_ids": contains(["tyt.mat.temel.sayilar"])})
    assert tagged and all("tyt.mat.temel.sayilar" in r["skill_ids"] for r in tagged)
    desc = db.select("messages", order="-sent_at", limit=3)
    assert [r["sent_at"] for r in desc] == sorted([r["sent_at"] for r in desc], reverse=True)
    nulls = db.select("messages", order="answered_at.desc")
    assert nulls[0]["answered_at"] is None  # Postgres: DESC'de null başta
    asc = db.select("messages", order="answered_at")
    assert asc[-1]["answered_at"] is None


def test_flush_writes_only_written_rows_and_redacts(db, out):
    db.update("messages", {"is_question": True}, where={"id": 1})
    q = db.select("questions", where={"source": "llm", "status": "pending_review"}, limit=1)[0]
    db.rpc("register_answer_key", {"p_question": q["id"], "p_key": {
        "correct_option": "A", "solution": "Adım adım çözüm metni.", "sympy_status": "not_applicable"}})
    with as_admin(db):  # batch_worker exam_items silemez (W "r w u"); silme kaydı yönetici rolüyle sınanır
        db.delete("exam_items", where={"id": db.select("exam_items", limit=1)[0]["id"]})
    paths = {p.name for p in db.flush()}
    assert {"messages.jsonl", "questions.jsonl", "rpc_calls.jsonl", "deletions.jsonl"} <= paths
    assert not any(p.startswith("secure.") for p in paths)
    assert [r["id"] for r in read_jsonl(out / "messages.jsonl")] == [1]
    assert all("text_raw" not in r for r in read_jsonl(out / "messages.jsonl"))
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
        db.update("messages", {"is_question": True}, where={})
