"""Yazımlar ``batch_worker`` sütun yetkisine uyar (§3.8, §12 #57): ``CostLedger`` yalnız yetkili ``llm_calls``
sütunlarını ``return=minimal`` ile gönderir; ``JsonlDb`` ``supabase/tests/grants_matrix.json``'ı çalışma anında okur.

Canlı test (``OGRENMEN_DATABASE_URL`` yoksa atlanır): geçici veritabanına tüm migration'lar uygulanır,
``SET ROLE batch_worker`` ile ``CostLedger``'ın ürettiği gövde PostgREST'in kurduğu INSERT/UPDATE deyimiyle yazılır.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import uuid
from pathlib import Path

import httpx
import pytest

from conftest import REPO, as_admin
from ogrenmen_common import grants
from ogrenmen_common.adapters.base import insert_minimal, update_minimal
from ogrenmen_common.adapters.postgrest import PostgrestDb
from ogrenmen_common.errors import DbError, DbPermissionError
from ogrenmen_common.fakes import FakeLLM, JsonlDb
from ogrenmen_common.ledger import LLM_CALLS_INSERT_COLUMNS, CostLedger, llm_calls_payload

MATRIX = REPO / "supabase" / "tests" / "grants_matrix.json"


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


def test_ledger_columns_equal_batch_worker_insert_grant():
    granted = grants.grant("batch_worker", "llm_calls", "insert")
    assert granted != "*" and set(LLM_CALLS_INSERT_COLUMNS) == set(granted)
    assert "created_at" not in LLM_CALLS_INSERT_COLUMNS and "id" not in LLM_CALLS_INSERT_COLUMNS


def test_ledger_insert_sends_only_granted_columns_with_return_minimal(clock):
    """Regresyon (M05): ``created_at`` gönderilirdi → canlıda her maliyet satırı ``permission denied``."""
    ledger, cap = _ledger_over_postgrest(clock)
    row = _record_all_columns(ledger)
    (req,) = cap.writes()
    assert req.method == "POST" and req.url.path == "/rest/v1/llm_calls"
    assert req.headers["prefer"] == "return=minimal"
    body = json.loads(req.content)
    assert isinstance(body, list) and len(body) == 1
    granted = grants.grant("batch_worker", "llm_calls", "insert")
    assert set(body[0]) <= set(granted) and "created_at" not in body[0] and "id" not in body[0]
    assert body[0]["ref_id"] == "42" and body[0]["student_ref"] == "s_qk7m2rx4tn5a"
    assert ledger.calls[-1]["status"] == "ok" and row["created_at"] == "2026-10-20T09:00:00Z"  # yalnız oturum özeti


def test_provider_health_update_is_minimal_and_granted(clock):
    ledger, cap = _ledger_over_postgrest(clock)
    ledger._note_provider_error("groq", "rate_limited", "429")
    (req,) = cap.writes()
    assert req.method == "PATCH" and req.headers["prefer"] == "return=minimal"
    assert req.url.params["provider"] == "eq.groq"
    grants.require("batch_worker", "provider_health", "update", json.loads(req.content))


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


# --- JsonlDb sütun yetkisi -------------------------------------------------------------------------------


def test_jsonl_db_rejects_ungranted_insert_column(db):
    """Sahte dünya artık canlının reddini gizlemez: eski ledger gövdesi (``created_at``'li) reddedilir."""
    old_body = {**llm_calls_payload({"purpose": "chat", "provider": "groq", "model": "llama-3.3-70b",
                                     "status": "ok"}), "created_at": "2026-10-20T09:00:00Z"}
    with pytest.raises(DbPermissionError, match="OGR-DB-001 permission denied for column created_at of relation "
                                                "llm_calls"):
        db.insert("llm_calls", old_body)
    with as_admin(db):  # kurulum rolü kısıtsız
        db.insert("llm_calls", old_body)


def test_ledger_rows_land_in_jsonl_db_with_db_defaults(db, clock):
    ledger = CostLedger(db, FakeLLM(), clock=clock)
    before = max(r["id"] for r in db.tables["llm_calls"])
    _record_all_columns(ledger)
    (row,) = db.written("llm_calls")
    assert row["id"] == before + 1 and row["created_at"] == "2026-10-20T09:00:00Z"  # DB varsayılanları
    assert db.write_log[0] == {"table": "llm_calls", "op": "insert", "key": [before + 1], "via": "direct"}


def test_jsonl_db_update_and_merge_grants(db):
    msg = db.select("messages", limit=1)[0]
    with pytest.raises(DbPermissionError, match="text_llm"):
        db.update("messages", {"text_llm": "x"}, where={"id": msg["id"]})
    with pytest.raises(DbPermissionError, match="column expires_at"):  # where sütunu SELECT ister
        db.update("messages", {"is_question": True}, where={"expires_at": "2027-01-01"})
    update_minimal(db, "messages", {"answered_at": "2026-10-20T09:00:00Z"}, where={"id": msg["id"]})
    assert db.get("messages", id=msg["id"])["answered_at"] == "2026-10-20T09:00:00Z"
    # merge = ON CONFLICT DO UPDATE SET <gönderilen sütunlar>: UPDATE yetkisi de gerekir
    with pytest.raises(DbPermissionError, match="update"):
        db.insert("lesson_analyses", [{"lesson_id": "x", "analysis": {}, "model": "m", "cost_usd": 0, "version": 1}],
                  on_conflict="merge")


def test_jsonl_db_representation_needs_table_select(db):
    row = {"student_id": db.tables["students"][0]["id"], "template_id": "hatirlatma", "params": {},
           "scheduled_for": "2026-10-21T09:00:00Z"}
    with pytest.raises(DbPermissionError, match="RETURNING"):  # proactive_messages: batch_worker'da SELECT yok
        db.insert("proactive_messages", row, returning="representation")
    assert db.insert("proactive_messages", row, returning="minimal") == []
    insert_minimal(db, "proactive_messages", {**row, "template_id": "ikinci"})
    assert [r["template_id"] for r in db.written("proactive_messages")] == ["hatirlatma", "ikinci"]


def test_jsonl_db_reads_matrix_at_runtime(db, tmp_path, monkeypatch):
    data = json.loads(MATRIX.read_text(encoding="utf-8"))
    data["tables"]["public.llm_calls"]["batch_worker"]["insert"].remove("latency_ms")
    path = tmp_path / "grants_matrix.json"
    path.write_text(json.dumps(data), encoding="utf-8")
    monkeypatch.setenv(grants.GRANTS_MATRIX_ENV, str(path))
    ledger = CostLedger(db, FakeLLM(), clock=db.clock)
    with pytest.raises(DbPermissionError, match="latency_ms"):
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


def _as_batch_worker(url: str, sql: str, payload: object, tmp_path: Path, *, check: bool = True):
    script = tmp_path / "stmt.sql"
    script.write_text(f"set role batch_worker;\n{sql}\nreset role;\n", encoding="utf-8")
    return _psql(url, "-v", f"payload={json.dumps(payload, ensure_ascii=False)}", "-f", str(script), check=check)


@live_db
def test_live_batch_worker_can_insert_exactly_what_ledger_sends(scratch_db, clock, tmp_path):
    ledger, cap = _ledger_over_postgrest(clock)
    _record_all_columns(ledger)
    ledger.record("chat", provider="groq", model="llama-3.3-70b", status="rate_limited", error_code="http_429")
    for req in cap.writes():
        body = json.loads(req.content)
        assert req.headers["prefer"] == "return=minimal"
        _as_batch_worker(scratch_db, _postgrest_insert_sql("llm_calls", body), body, tmp_path)
    out = _psql(scratch_db, "-c", "select count(*), bool_and(created_at is not null), min(id) > 0 from "
                                  "public.llm_calls").stdout.strip()
    assert out == "2|t|t"
    assert _psql(scratch_db, "-c", "select sum(calls) from public.spend_ledger").stdout.strip() == "2"  # tetikleyici

    # Negatif kontrol: düzeltmeden önceki gövde (created_at'li) canlıda reddedilir — test hatayı yakalardı.
    old = [{**json.loads(cap.writes()[0].content)[0], "created_at": "2026-10-20T09:00:00Z"}]
    proc = _as_batch_worker(scratch_db, _postgrest_insert_sql("llm_calls", old), old, tmp_path, check=False)
    assert proc.returncode != 0 and "permission denied" in proc.stderr


@live_db
def test_live_batch_worker_can_update_provider_health_like_ledger(scratch_db, clock, tmp_path):
    _psql(scratch_db, "-c", "insert into public.provider_health (provider) values ('groq') on conflict do nothing")
    ledger, cap = _ledger_over_postgrest(clock)
    ledger._note_provider_error("groq", "rate_limited", "429")
    (req,) = cap.writes()
    values = json.loads(req.content)
    _as_batch_worker(scratch_db, _postgrest_update_sql("provider_health", values,
                                                       "\"public\".\"provider_health\".\"provider\" = 'groq'"),
                     values, tmp_path)
    assert _psql(scratch_db, "-c", "select consecutive_errors from public.provider_health where provider = 'groq'"
                 ).stdout.strip() == "3"
