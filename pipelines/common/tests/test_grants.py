"""v2 yetki matrisi (``fakes/grants-v2.json``): migration'larla uyum, ``CostLedger`` gövdesi, JsonlDb denetimi.

v2'de uygulama rolü yoktur (``batch_worker`` kaldırıldı); pipeline'lar ``service_role`` ile yazar ve RLS'i aşar.
Matrisin değeri tablo ve SÜTUN listesidir: ``CostLedger`` yalnız v2 ``llm_calls`` sütunlarını ``return=minimal`` ile
gönderir, JsonlDb olmayan sütunu reddeder.

Canlı test (``OGRENMEN_DATABASE_URL`` yoksa atlanır): geçici veritabanına tüm migration'lar uygulanır,
``SET ROLE service_role`` ile ``CostLedger``'ın ürettiği gövde PostgREST'in kurduğu INSERT deyimiyle yazılır.
"""
from __future__ import annotations

import importlib.util
import json
import os
import shutil
import subprocess
import uuid
from pathlib import Path

import httpx
import pytest

from conftest import REPO
from ogrenmen_common import grants
from ogrenmen_common.adapters.postgrest import PostgrestDb
from ogrenmen_common.errors import DbError, DbPermissionError
from ogrenmen_common.fakes import FakeLLM, JsonlDb
from ogrenmen_common.ledger import LLM_CALLS_INSERT_COLUMNS, CostLedger, llm_calls_payload

MATRIX = grants.grants_matrix_path()


class Capture:
    """PostgREST ikamesi: istekleri kaydeder; ``provider_health`` okumasına tek satır döner."""

    def __init__(self):
        self.requests: list[httpx.Request] = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        if request.method == "GET" and request.url.path.endswith("/provider_health"):
            return httpx.Response(200, json=[{"provider": "groq", "consecutive_errors": 2}])
        if request.method == "GET":
            return httpx.Response(200, json=[])
        if request.headers.get("prefer", "").startswith("return=minimal"):
            return httpx.Response(201 if request.method == "POST" else 204)
        return httpx.Response(201, json=json.loads(request.content or b"[]"))

    def writes(self) -> list[httpx.Request]:
        return [r for r in self.requests if r.method in ("POST", "PATCH")]


def _ledger_over_postgrest(clock) -> tuple[CostLedger, Capture]:
    cap = Capture()
    db = PostgrestDb("https://proj.example.org", "jwt-batch", transport=httpx.MockTransport(cap))
    return CostLedger(db, FakeLLM(), clock=clock), cap


def _record_all_columns(ledger: CostLedger) -> dict:
    return ledger.record("nightly_facts", provider="gemini-paid", model="gemini-2.5-flash-lite", status="ok",
                         tokens_in=120, tokens_out=30, audio_sec=4, images=1, batch=True, error_code=None,
                         latency_ms=812, student_ref="s_qk7m2rx4tn5a", ref_table="messages", ref_id=42)


# --- matris ↔ kod ----------------------------------------------------------------------------------------


# --- matris ↔ kod ----------------------------------------------------------------------------------------


def _load_generator():
    spec = importlib.util.spec_from_file_location("gen_grants_v2", REPO / "pipelines" / "common" / "scripts"
                                                  / "gen_grants_v2.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_matrix_file_matches_migrations():
    """grants-v2.json elle düzenlenmez: migration'lardaki tablo + sütun listesinden üretilir
    (``python pipelines/common/scripts/gen_grants_v2.py``)."""
    gen = _load_generator()
    assert json.loads(MATRIX.read_text(encoding="utf-8")) == gen.build(), "grants-v2.json eski; betikle yeniden üretin"
    assert gen.main(["--check"]) == 0


def test_matrix_covers_v2_tables_and_no_v1_tables():
    tables = set(json.loads(MATRIX.read_text(encoding="utf-8"))["tables"])
    assert {"public.llm_calls", "public.questions", "secure.answer_keys", "audit.events", "public.profiles"} <= tables
    for gone in ("tg_chats", "chat_roles", "tg_updates", "sessions", "quota_tiers", "diagnostic_sessions", "messages",
                 "bot_responses", "retention_policies", "pilot_metrics", "provider_health"):
        assert f"public.{gone}" not in tables, gone
    assert "secure.telegram_identities" not in tables


def test_service_role_is_the_only_role_and_legacy_names_map_to_it():
    data = json.loads(MATRIX.read_text(encoding="utf-8"))
    assert data["roles"] == ["service_role"]
    assert grants.grant("service_role", "llm_calls", "insert") == "*"
    assert grants.grant("batch_worker", "llm_calls", "insert") == "*"  # eski ad
    assert grants.grant("authenticated", "llm_calls", "insert") is None
    assert grants.columns("llm_calls") >= {"route", "effort", "prompt_version", "cache_read_tokens"}
    assert grants.columns("tg_chats") is None


def test_audit_events_is_append_only():
    """0002: audit şemasında service_role yalnız select + insert alır; update/delete canlıda reddedilir."""
    assert grants.grant("service_role", "audit.events", "select") == "*"
    assert grants.grant("service_role", "audit.events", "insert") == "*"
    for op in ("update", "delete"):
        assert grants.grant("service_role", "audit.events", op) is None
        with pytest.raises(DbPermissionError, match="OGR-DB-001"):
            grants.require("service_role", "audit.events", op, ["actor_id"])


def test_ledger_columns_exist_in_v2_llm_calls():
    cols = grants.columns("llm_calls")
    assert set(LLM_CALLS_INSERT_COLUMNS) <= cols
    assert "created_at" not in LLM_CALLS_INSERT_COLUMNS and "id" not in LLM_CALLS_INSERT_COLUMNS


def test_cooldown_skip_is_written_as_rate_limited():
    body = llm_calls_payload({"purpose": "chat", "provider": "groq", "model": "m", "status": "cooldown_skip"})
    assert body["status"] == "rate_limited" and body["error_code"] == "cooldown_skip"


def test_ledger_insert_sends_only_granted_columns_with_return_minimal(clock):
    """Regresyon (M05): ``created_at`` gönderilirdi → canlıda her maliyet satırı ``permission denied``."""
    ledger, cap = _ledger_over_postgrest(clock)
    row = _record_all_columns(ledger)
    (req,) = cap.writes()
    assert req.method == "POST" and req.url.path == "/rest/v1/llm_calls"
    assert req.headers["prefer"] == "return=minimal"
    body = json.loads(req.content)
    assert isinstance(body, list) and len(body) == 1
    assert set(body[0]) <= grants.columns("llm_calls") and "created_at" not in body[0] and "id" not in body[0]
    assert body[0]["ref_id"] == "42" and body[0]["student_ref"] == "s_qk7m2rx4tn5a"
    assert ledger.calls[-1]["status"] == "ok" and row["created_at"] == "2026-10-20T09:00:00Z"  # yalnız oturum özeti


def test_provider_health_update_is_minimal(clock):
    ledger, cap = _ledger_over_postgrest(clock)
    ledger._note_provider_error("groq", "rate_limited", "429")
    (req,) = cap.writes()
    assert req.method == "PATCH" and req.headers["prefer"] == "return=minimal"
    assert req.url.params["provider"] == "eq.groq"


def test_postgrest_returning_option_and_defaults():
    cap = Capture()
    db = PostgrestDb("https://p.example.org", "j", transport=httpx.MockTransport(cap))
    assert db.insert("proactive_messages", [{"template_id": "t"}]) == []  # toplu yazım → minimal
    assert db.insert("llm_calls", {"purpose": "ocr"}, returning="minimal", on_conflict="ignore") == []
    assert db.insert("llm_calls", {"purpose": "ocr"}) == [{"purpose": "ocr"}]  # tek satır → representation
    assert db.update("lessons", {"status": "analyzed"}, where={"id": "l1"}) == []  # update → minimal
    prefers = [r.headers["prefer"] for r in cap.writes()]
    assert prefers == ["return=minimal", "return=minimal,resolution=ignore-duplicates", "return=representation",
                       "return=minimal"]
    with pytest.raises(DbError, match="OGR-DB-002"):
        db.insert("llm_calls", {"purpose": "ocr"}, returning="headers-only")


# --- JsonlDb ---------------------------------------------------------------------------------------------


def test_jsonl_db_rejects_unknown_insert_column(db):
    """Sahte dünya canlının reddini gizlemez: v2'de olmayan sütun yazımı reddedilir."""
    body = {**llm_calls_payload({"purpose": "chat", "provider": "groq", "model": "llama-3.3-70b", "status": "ok"}),
            "chat_id": 1}
    with pytest.raises(DbError, match="llm_calls.chat_id v2 şemasında yok"):
        db.insert("llm_calls", body)


def test_ledger_rows_land_in_jsonl_db_with_db_defaults(db, clock):
    ledger = CostLedger(db, FakeLLM(), clock=clock)
    before = max(r["id"] for r in db.tables["llm_calls"])
    _record_all_columns(ledger)
    (row,) = db.written("llm_calls")
    assert row["id"] == before + 1 and row["created_at"] == "2026-10-20T09:00:00Z"  # DB varsayılanları
    assert row["provider"] == "gemini-paid" and row["cache_read_tokens"] == 0
    assert db.write_log[0] == {"table": "llm_calls", "op": "insert", "key": [before + 1], "via": "direct"}


def test_jsonl_db_non_service_role_needs_matrix_grant(db):
    guest = JsonlDb(db.tables, role="authenticated")
    with pytest.raises(DbPermissionError, match="OGR-DB-001"):
        guest.insert("llm_calls", {"purpose": "chat", "model": "m", "status": "ok"})
    with pytest.raises(DbPermissionError, match="OGR-DB-001"):
        guest.select("students")


def test_jsonl_db_reads_matrix_at_runtime(db, tmp_path, monkeypatch):
    data = json.loads(MATRIX.read_text(encoding="utf-8"))
    data["tables"]["public.llm_calls"]["columns"].remove("latency_ms")
    path = tmp_path / "grants_matrix.json"
    path.write_text(json.dumps(data), encoding="utf-8")
    monkeypatch.setenv(grants.GRANTS_MATRIX_ENV, str(path))
    ledger = CostLedger(db, FakeLLM(), clock=db.clock)
    with pytest.raises(DbError, match="latency_ms"):
        _record_all_columns(ledger)
    monkeypatch.setenv(grants.GRANTS_MATRIX_ENV, str(tmp_path / "yok.json"))
    with pytest.raises(DbError, match="OGR-DB-004"):
        _record_all_columns(ledger)


class _LegacyDb(JsonlDb):
    """``returning`` almayan eski imzalı DB (ör. başka modüllerin yetki taklitleri)."""

    def insert(self, table, rows, *, on_conflict=None):
        return super().insert(table, rows, on_conflict=on_conflict)

    def update(self, table, values, *, where):
        return super().update(table, values, where=where)


def test_minimal_helpers_fall_back_for_legacy_signatures(clock):
    db = _LegacyDb.from_fixtures(clock=clock)
    ledger = CostLedger(db, FakeLLM(), clock=clock)
    _record_all_columns(ledger)
    ledger._note_provider_error("groq", "rate_limited", "429")
    assert len(db.written("llm_calls")) == 1


# --- canlı -----------------------------------------------------------------------------------------------

DB_URL = os.environ.get("OGRENMEN_DATABASE_URL")
live_db = pytest.mark.skipif(not DB_URL or shutil.which("psql") is None,
                             reason="OGRENMEN_DATABASE_URL tanımlı değil (ya da psql yok)")


def _with_db(url: str, name: str) -> str:
    from urllib.parse import urlsplit, urlunsplit

    p = urlsplit(url)
    if not p.scheme.startswith("postgres"):
        pytest.skip("yalnız postgresql:// URL'si destekleniyor")
    return urlunsplit((p.scheme, p.netloc, "/" + name, p.query, p.fragment))


def _psql(url: str, *args: str, role: str | None = None, check: bool = True) -> subprocess.CompletedProcess:
    env = {**os.environ, "PGOPTIONS": f"-c role={role}" if role else ""}
    proc = subprocess.run(["psql", "-X", "-q", "-At", "-v", "ON_ERROR_STOP=1", "-d", url, *args],
                          capture_output=True, text=True, env=env, timeout=300)
    if check and proc.returncode != 0:
        raise AssertionError(f"psql {' '.join(args[:2])} düştü:\n{proc.stdout}\n{proc.stderr}")
    return proc


def _postgrest_insert_sql(table: str, body: list[dict]) -> str:
    """PostgREST'in ``POST /<tablo>`` (``Prefer: return=minimal``) için kurduğu deyim (RETURNING yok)."""
    cols = sorted({c for r in body for c in r})
    q = ", ".join(f'"{c}"' for c in cols)
    return (f'insert into "public"."{table}"({q}) select {q} '
            f'from json_populate_recordset(null::"public"."{table}", :\'payload\'::json) _;')


def _postgrest_update_sql(table: str, values: dict, where_sql: str) -> str:
    sets = ", ".join(f'"{c}" = _."{c}"' for c in values)
    return (f'update "public"."{table}" set {sets} from (select * from json_populate_record('
            f'null::"public"."{table}", :\'payload\'::json)) _ where {where_sql};')


@pytest.fixture(scope="module")
def scratch_db():
    assert DB_URL
    name = f"ogrenmen_m05_grants_{uuid.uuid4().hex[:8]}"
    assert name != "ogrenmen"
    _psql(DB_URL, "-c", "set client_min_messages = warning", "-c", f'create database "{name}"')
    url = _with_db(DB_URL, name)
    try:
        _psql(url, "-f", str(REPO / "supabase" / "tests" / "00_local_stub.sql"))
        for mig in sorted((REPO / "supabase" / "migrations").glob("*.sql")):
            _psql(url, "--single-transaction", "-f", str(mig), role="ogrenmen_owner")  # db-test.sh ile aynı sahip
        yield url
    finally:
        _psql(DB_URL, "-c", "set client_min_messages = warning", "-c",
              f'drop database if exists "{name}" with (force)', check=False)


def _as_service_role(url: str, sql: str, payload: object, tmp_path: Path, *, check: bool = True):
    script = tmp_path / "stmt.sql"
    script.write_text(f"set role service_role;\n{sql}\nreset role;\n", encoding="utf-8")
    return _psql(url, "-v", f"payload={json.dumps(payload, ensure_ascii=False)}", "-f", str(script), check=check)


@live_db
def test_live_service_role_can_insert_exactly_what_ledger_sends(scratch_db, clock, tmp_path):
    ledger, cap = _ledger_over_postgrest(clock)
    _record_all_columns(ledger)
    ledger.record("chat", provider="groq", model="llama-3.3-70b", status="rate_limited", error_code="http_429")
    ledger.record("chat", provider="groq", model="llama-3.3-70b", status="cooldown_skip")
    for req in cap.writes():
        body = json.loads(req.content)
        assert req.headers["prefer"] == "return=minimal"
        _as_service_role(scratch_db, _postgrest_insert_sql("llm_calls", body), body, tmp_path)
    out = _psql(scratch_db, "-c", "select count(*), bool_and(created_at is not null), min(id) > 0 from "
                                  "public.llm_calls").stdout.strip()
    assert out == "3|t|t"
    assert _psql(scratch_db, "-c", "select sum(calls) from public.spend_ledger").stdout.strip() == "3"  # tetikleyici
