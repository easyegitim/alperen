"""Canlı Postgres: Kitap'ın yazdığı her satır gerçek şemada ``batch_worker`` rolüyle kabul ediliyor mu (§3.6, §3.8).

Yalnız ``OGRENMEN_DATABASE_URL`` tanımlıysa koşar (yoksa SKIP). Geçici veritabanına ``00_local_stub.sql`` +
migration'lar + ``seed/*.sql`` + ``seed/dev/*.sql`` uygulanır, ``fixtures/kitap/requests.json``'daki kuyruk satırları
eklenir. Ardından ``run --queued`` ve ``verify`` akışı ``JsonlDb`` üzerinde koşar; ``JsonlDb``'ye giden her
``insert``/``update`` PostgREST'in kuracağı deyimle (yalnız gönderilen sütunlar, ``jsonb_populate_record`` tür
dönüşümü) ``set role batch_worker`` altında gerçek veritabanında yeniden oynatılır. ``research_outputs`` eklemesi
``RETURNING id`` ile yapılır (PostgREST ``return=representation``); ``JsonlDb``'nin verdiği kimlik sonraki
deyimlerde gerçek kimlikle değiştirilir.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit, urlunsplit

import pytest
from ogrenmen_common.fakes import JsonlDb

from conftest import KITAP, QUEUED_1, QUEUED_2, REPO, make_rt, only_fixture
from ogrenmen_kitap import pipeline as P

pytestmark = pytest.mark.live

SUPABASE = REPO / "supabase"
MIGRATION_ROLE = "ogrenmen_owner"
KITAP_TABLES = ("research_requests", "research_outputs", "citations", "llm_calls", "instructor_alerts")
TAG = "$kitap$"


def _db_url(url: str, name: str) -> str:
    p = urlsplit(url)
    return urlunsplit((p.scheme, p.netloc, "/" + name, p.query, p.fragment))


def psql(url: str, *, sql: str | None = None, file: Path | None = None, role: str | None = None,
         check: bool = True) -> subprocess.CompletedProcess:
    cmd = ["psql", "-X", "-q", "-At", "-v", "ON_ERROR_STOP=1", "-d", url]
    cmd += ["-f", str(file)] if file is not None else ["-c", sql or ""]
    env = {**os.environ, "PGOPTIONS": f"-c role={role}" if role else ""}
    proc = subprocess.run(cmd, capture_output=True, text=True, env=env, timeout=300)
    if check and proc.returncode != 0:
        raise AssertionError(f"psql düştü ({proc.returncode}): {proc.stderr.strip()[:3000]}")
    return proc


def _lit(value: Any) -> str:
    text = json.dumps(value, ensure_ascii=False)
    assert TAG not in text
    return f"{TAG}{text}{TAG}::jsonb"


@pytest.fixture(scope="module")
def live_db():
    base = os.environ.get("OGRENMEN_DATABASE_URL")
    if not base:
        pytest.skip("OGRENMEN_DATABASE_URL tanımlı değil (canlı veritabanı testi)")
    if shutil.which("psql") is None:
        pytest.skip("psql istemcisi yok")
    name = f"ogrenmen_kitap_live_{os.getpid()}"
    url = _db_url(base, name)
    psql(base, sql=f'drop database if exists "{name}" with (force)')
    psql(base, sql=f'create database "{name}"')
    try:
        psql(url, file=SUPABASE / "tests" / "00_local_stub.sql")
        for folder in ("migrations", "seed", "seed/dev"):
            for f in sorted((SUPABASE / folder).glob("*.sql")):
                psql(url, file=f, role=MIGRATION_ROLE)
        rows = [r for r in json.loads((KITAP / "requests.json").read_text(encoding="utf-8")) if r["status"] == "queued"]
        psql(url, role=MIGRATION_ROLE, sql=(
            "insert into public.research_requests select * from "
            f"jsonb_populate_recordset(null::public.research_requests, {_lit(rows)}) on conflict (id) do nothing;"))
        yield url
    finally:
        psql(base, sql=f'drop database if exists "{name}" with (force)', check=False)


class RecordingDb(JsonlDb):
    """``JsonlDb`` + PostgREST'e gidecek yazımların kaydı (yalnız gönderilen sütunlar)."""

    def __init__(self, *args: Any, **kwargs: Any):
        super().__init__(*args, **kwargs)
        self.ops: list[tuple[str, str, dict, Any]] = []

    def insert(self, table, rows, *, on_conflict=None, returning=None):  # noqa: ANN001
        got = super().insert(table, rows, on_conflict=on_conflict, returning=returning)
        if self._via == "direct":
            items = [rows] if isinstance(rows, dict) else list(rows)
            fake_ids = [g.get("id") for g in got] if got and len(got) == len(items) else [None] * len(items)
            for row, fid in zip(items, fake_ids, strict=True):
                self.ops.append(("insert", table, dict(row), fid))
        return got

    def update(self, table, values, *, where, returning=None):  # noqa: ANN001
        got = super().update(table, values, where=where, returning=returning)
        if self._via == "direct":
            self.ops.append(("update", table, dict(values), dict(where)))
        return got


def _wrap(body: str) -> str:
    return ("begin; set local role batch_worker; "
            "select set_config('request.jwt.claims', '{\"role\":\"batch_worker\"}', true);\n" + body + "\ncommit;\n")


def _statement(op: str, table: str, values: dict, extra: Any) -> str:
    cols = sorted(values)
    collist = ", ".join(cols)
    src = f"jsonb_populate_record(null::public.{table}, {_lit(values)})"
    if op == "insert":
        returning = " returning id" if table == "research_outputs" else ""
        return _wrap(f"insert into public.{table} ({collist}) select {collist} from {src}{returning};")
    assert set(extra) == {"id"}, extra
    return _wrap(f"update public.{table} set ({collist}) = (select {collist} from {src}) "
                 f"where id = {TAG}{extra['id']}{TAG}::uuid;")


def _replay(url: str, ops: list[tuple[str, str, dict, Any]]) -> dict[str, str]:
    ids: dict[str, str] = {}

    def remap(value: Any) -> Any:
        if isinstance(value, str):
            return ids.get(value, value)
        if isinstance(value, dict):
            return {k: remap(v) for k, v in value.items()}
        if isinstance(value, list):
            return [remap(v) for v in value]
        return value

    for op, table, values, extra in ops:
        values = remap(values)
        extra = remap(extra) if op == "update" else extra
        proc = psql(url, sql=_statement(op, table, values, extra))
        if op == "insert" and table == "research_outputs":
            real = [line for line in proc.stdout.splitlines() if len(line) == 36]
            assert len(real) == 1, proc.stdout
            ids[str(extra)] = real[0]
    return ids


def test_kitap_writes_are_accepted_by_real_schema(live_db, tmp_path):
    llm = only_fixture(tmp_path, {"research": "01-spaced-repetition.json"})
    rt = make_rt(tmp_path / "out", llm_options={"root": llm})
    db = RecordingDb(rt.db.tables, out_dir=tmp_path / "out", clock=rt.db.clock)
    rt.db = db
    rt.ledger.db = db
    results = P.run_queued(rt, limit=5)
    assert [r.status for r in results] == ["done", "done"]
    first = next(r for r in results if r.request_id == QUEUED_1)
    third = next(c for c in first.output["citations"] if c["ordinal"] == 3)
    rt.doi._missing[third["doi"]] = {"status": 404}
    v = P.verify_output(rt, first.output_id)
    assert v.paragraphs_dropped == 1
    ops = [o for o in db.ops if o[1] in KITAP_TABLES]
    assert {o[1] for o in ops} >= {"research_requests", "research_outputs", "citations", "llm_calls"}
    ids = _replay(live_db, ops)
    assert len(ids) == 2

    def one(sql: str) -> str:
        return psql(live_db, sql=sql).stdout.strip()

    assert one(f"select string_agg(status, ',' order by id) from public.research_requests "
               f"where id in ('{QUEUED_1}', '{QUEUED_2}')") == "done,done"
    assert one(f"select array_length(expanded_queries, 1) between 3 and 5 from public.research_requests "
               f"where id = '{QUEUED_1}'") == "t"
    assert one("select count(*) from public.research_outputs where status = 'pending_review'") == "3"  # +1 dev seed
    real_first = ids[first.output_id]
    assert one(f"select count(*) from public.citations where output_id = '{real_first}' and status = 'removed' "
               "and crossref_status = 'unresolved'") == "2"   # uydurma DOI + verify'da düşen
    assert one(f"select jsonb_array_length(output->'synthesis') from public.research_outputs "
               f"where id = '{real_first}'") == "1"
    assert one(f"select count(*) from public.citations where output_id = '{real_first}' "
               "and doi = '10.9999/fake' and removed_reason = 'crossref_unresolved'") == "1"
    assert one("select count(*) from public.llm_calls where purpose in ('query_expand', 'research') "
               "and ref_table = 'research_requests'") == str(sum(1 for o in ops if o[1] == "llm_calls"))


def test_replay_harness_rejects_what_batch_worker_may_not_write(live_db, tmp_path):
    """Kanıt: aynı yeniden oynatma yolu yetkisiz yazımı gerçekten reddeder."""
    script = tmp_path / "bad.sql"
    script.write_text(_statement("insert", "research_requests", {"query": "x"}, None), encoding="utf-8")
    proc = psql(live_db, file=script, check=False)
    assert proc.returncode != 0 and "permission denied" in proc.stderr
    script.write_text(_statement("update", "research_outputs", {"status": "released"},
                                 {"id": "00000000-0000-4000-8000-000000000000"}), encoding="utf-8")
    proc = psql(live_db, file=script, check=False)
    assert proc.returncode != 0 and "permission denied" in proc.stderr


def test_two_ops_alerts_pass_real_alerts_dedup(live_db, tmp_path):
    """İki farklı çıktı ``verify``'da her şeyini kaybeder: iki ``instructor_alerts(ops)`` satırı gerçek
    ``alerts_dedup`` dizininden (tür + öğrenci + ref anahtarı + ``left(detail, 24)``) çakışmadan geçmeli."""
    llm = only_fixture(tmp_path, {"research": "01-spaced-repetition.json"})
    rt = make_rt(tmp_path / "out", llm_options={"root": llm})
    db = RecordingDb(rt.db.tables, out_dir=tmp_path / "out", clock=rt.db.clock)
    rt.db = db
    rt.ledger.db = db
    results = P.run_queued(rt, limit=5)
    assert [r.status for r in results] == ["done", "done"]
    for r in results:
        for c in r.output["citations"]:
            if c.get("doi"):
                rt.doi._missing[c["doi"]] = {"status": 404}
    assert all(P.verify_output(rt, r.output_id).alert for r in results)
    ops = [o for o in db.ops if o[1] in KITAP_TABLES]
    assert sum(1 for o in ops if o[1] == "instructor_alerts") == 2
    _replay(live_db, ops)
    got = psql(live_db, sql="select count(*), count(distinct left(detail, 24)) from public.instructor_alerts "
                            "where kind = 'ops' and status = 'open' and detail like 'Araştırma %' "
                            "and ref = '{}'::jsonb").stdout.strip()
    assert got == "2|2"
