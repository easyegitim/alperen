"""Canlı Postgres: Kalem'in yazdığı her satır gerçek şemada ``batch_worker`` rolüyle kabul ediliyor mu (§3.6, §3.8).

Yalnız ``OGRENMEN_DATABASE_URL`` tanımlıysa koşar (yoksa SKIP). Geçici veritabanına ``00_local_stub.sql`` +
migration'lar + ``seed/*.sql`` + ``seed/dev/*.sql`` uygulanır, ``fixtures/kalem`` dersi ve kaynakları eklenir.
Ardından uçtan uca akış (ingest --source, ingest --pdf, ingest --queue hata yolu, plan, variants) ``JsonlDb``
üzerinde koşar; ``JsonlDb``'ye giden her ``insert``/``update`` aynen kaydedilir ve PostgREST'in kuracağı deyimle
(yalnız gönderilen sütunlar, ``jsonb_populate_record`` tür dönüşümü) ``set role batch_worker`` altında gerçek
veritabanında yeniden oynatılır: sütun adları, türler (``halfvec(768)``, ``smallint[]``, ``jsonb``), check/FK
kısıtları, tetikleyiciler (``app.questions_check_skills``), RLS politikaları ve sütun yetkileri birlikte sınanır.
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
from ogrenmen_common.runtime import Runtime

from conftest import APPROVED_PLAN, KALEM, REPO, SOURCE_2022
from ogrenmen_kalem import ingest as IN
from ogrenmen_kalem import plan as PL
from ogrenmen_kalem import variants as VA
from ogrenmen_kalem.common import course_by_code

pytestmark = pytest.mark.live

SUPABASE = REPO / "supabase"
MIGRATION_ROLE = "ogrenmen_owner"
KALEM_TABLES = ("exam_sources", "exam_items", "exam_clusters", "syllabus_topics", "exam_priority_plans",
                "generation_requests", "instructor_alerts")
FAILING_SOURCE = "7f3c2e1a-9b8d-4c6e-a5f4-3e2d1c0b9a87"
TAG = "$kalem$"


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


def _failing_source() -> dict:
    base = json.loads((KALEM / "exam_sources.json").read_text(encoding="utf-8"))[0]
    return {**base, "id": FAILING_SOURCE, "year": 2019, "storage_path": f"exams/{FAILING_SOURCE}.pdf",
            "created_at": "2026-10-19T14:00:00Z"}


@pytest.fixture(scope="module")
def live_db():
    base = os.environ.get("OGRENMEN_DATABASE_URL")
    if not base:
        pytest.skip("OGRENMEN_DATABASE_URL tanımlı değil (canlı veritabanı testi)")
    if shutil.which("psql") is None:
        pytest.skip("psql istemcisi yok")
    name = f"ogrenmen_kalem_live_{os.getpid()}"
    url = _db_url(base, name)
    psql(base, sql=f'drop database if exists "{name}" with (force)')
    psql(base, sql=f'create database "{name}"')
    try:
        psql(url, file=SUPABASE / "tests" / "00_local_stub.sql")
        for folder in ("migrations", "seed", "seed/dev"):
            for f in sorted((SUPABASE / folder).glob("*.sql")):
                psql(url, file=f, role=MIGRATION_ROLE)
        courses = json.loads((KALEM / "courses.json").read_text(encoding="utf-8"))
        sources = json.loads((KALEM / "exam_sources.json").read_text(encoding="utf-8")) + [_failing_source()]
        psql(url, role=MIGRATION_ROLE, sql=(
            f"insert into public.courses select * from jsonb_populate_recordset(null::public.courses, {_lit(courses)});"
            f"insert into public.exam_sources select * from jsonb_populate_recordset(null::public.exam_sources, "
            f"{_lit(sources)});"))
        yield url
    finally:
        psql(base, sql=f'drop database if exists "{name}" with (force)', check=False)


class RecordingDb(JsonlDb):
    """``JsonlDb`` + PostgREST'e gidecek yazımların kaydı (yalnız gönderilen sütunlar)."""

    def __init__(self, *args: Any, **kwargs: Any):
        super().__init__(*args, **kwargs)
        self.ops: list[tuple[str, str, Any, Any]] = []

    def insert(self, table, rows, *, on_conflict=None, returning=None):  # noqa: ANN001
        got = super().insert(table, rows, on_conflict=on_conflict, returning=returning)
        if self._via == "direct":
            for row in ([rows] if isinstance(rows, dict) else list(rows)):
                self.ops.append(("insert", table, dict(row), None))
        return got

    def update(self, table, values, *, where, returning=None):  # noqa: ANN001
        got = super().update(table, values, where=where, returning=returning)
        if self._via == "direct":
            self.ops.append(("update", table, dict(values), dict(where)))
        return got


def _statement(op: str, table: str, values: dict, where: dict | None) -> str:
    cols = sorted(values)
    collist = ", ".join(cols)
    src = f"jsonb_populate_record(null::public.{table}, {_lit(values)})"
    if op == "insert":
        body = f"insert into public.{table} ({collist}) select {collist} from {src};"
    else:
        assert set(where) == {"id"}, where
        body = (f"update public.{table} set ({collist}) = (select {collist} from {src}) "
                f"where id = {TAG}{where['id']}{TAG}::uuid;")
    return ("begin; set local role batch_worker; "
            "select set_config('request.jwt.claims', '{\"role\":\"batch_worker\"}', true);\n" + body + "\ncommit;\n")


def test_kalem_writes_are_accepted_by_real_schema(live_db, tmp_path):
    db = RecordingDb.from_fixtures(KALEM, out_dir=tmp_path / "out")
    db.seed("exam_sources", _failing_source())
    seed = json.loads((REPO / "fixtures" / "db" / "dev-seed.json").read_text(encoding="utf-8"))
    db.seed("courses", seed["courses"])  # fixtures/kalem dersi tabandaki TYT-MAT'ın yerine geçer; ikisi de canlıda var
    rt = Runtime.from_env(dry_run=True, fixtures=KALEM, out=tmp_path / "out")
    rt.db = db
    rt.ledger.db = db
    assert IN.ingest_source(rt, SOURCE_2022).status == "ocr_done"
    pdf = IN.ingest_pdf(rt, KALEM / "exam-2022.pdf", course_code="DEMO", year=2021, term="vize",
                        legal_basis="öğrenci kendi kopyası", instructor_alias="hoca-B")
    assert pdf.status == "ocr_done"
    failed = IN.ingest_queue(rt)
    assert [(r.source_id, r.status) for r in failed] == [(FAILING_SOURCE, "failed")]
    plan = PL.plan_course(rt, course_by_code(rt.db, "DEMO"), "2026")["plan"]
    rep = VA.variants_for_plan(rt, APPROVED_PLAN, top=5)
    rt.close()
    assert rep["written"] == 5
    ops = [o for o in db.ops if o[1] in KALEM_TABLES]
    assert {o[1] for o in ops} == set(KALEM_TABLES)
    script = tmp_path / "replay.sql"
    script.write_text("".join(_statement(*o) for o in ops), encoding="utf-8")
    psql(live_db, file=script)

    def one(sql: str) -> str:
        return psql(live_db, sql=sql).stdout.strip()

    demo = "a48b1144-f71e-5ff2-8c38-92f9d76c3805"
    assert one(f"select count(*) from public.exam_items e join public.exam_sources s on s.id = e.source_id "
               f"where s.course_id = '{demo}'") == "15"
    assert one(f"select count(*) from public.exam_items e join public.exam_sources s on s.id = e.source_id "
               f"where s.course_id = '{demo}' and e.embedding is not null and e.cluster_id is not null") == "15"
    assert one(f"select string_agg(status, ',' order by year) from public.exam_sources where course_id = '{demo}'") \
        == "failed,clustered,clustered,clustered"
    got = json.loads(one(f"select plan from public.exam_priority_plans where course_id = '{demo}' "
                         "and status = 'pending_review'"))
    assert got["title"] == "Sıklık analizine göre öncelikler" and got["rows"] == plan["rows"]
    assert one(f"select count(*) from public.generation_requests where kind = 'exam_variant' "
               f"and plan_id = '{APPROVED_PLAN}' and needs_generation") == "5"
    assert one(f"select count(*) from public.instructor_alerts where kind = 'ops' and status = 'open' "
               f"and ref->>'source_id' = '{FAILING_SOURCE}'") == "1"
    assert one(f"select count(*) from public.syllabus_topics where course_id = '{demo}' "
               f"and curriculum_id = '7a988b84-8937-5242-8c35-ddbc4ea9216d'") == "9"
    assert one(f"select min(array_length(years_hit, 1)) <= min(years_total) from public.exam_clusters "
               f"where course_id = '{demo}'") == "t"


def test_replay_harness_rejects_what_batch_worker_may_not_write(live_db, tmp_path):
    """Kanıt: aynı yeniden oynatma yolu yetkisiz sütunu gerçekten reddeder (plan durumu yalnız onay RPC'siyle)."""
    demo = "a48b1144-f71e-5ff2-8c38-92f9d76c3805"
    plan = json.loads((REPO / "packages" / "contracts" / "fixtures" / "exam-priority-plan" / "valid" /
                       "two-years.json").read_text(encoding="utf-8"))
    script = tmp_path / "bad.sql"
    script.write_text(_statement("insert", "exam_priority_plans", {"course_id": demo, "period": "2026", "plan": plan,
                                                                   "evidence_count": 1, "status": "approved"}, None),
                      encoding="utf-8")
    proc = psql(live_db, file=script, check=False)
    assert proc.returncode != 0 and "permission denied" in proc.stderr
    script.write_text(_statement("insert", "generation_requests", {
        "kind": "pool_miss", "curriculum_id": "7a988b84-8937-5242-8c35-ddbc4ea9216d",
        "skill_id": "tyt.mat.temel.uslu", "difficulty_band": "mid"}, None), encoding="utf-8")
    proc = psql(live_db, file=script, check=False)
    assert proc.returncode != 0 and ("row-level security" in proc.stderr or "permission denied" in proc.stderr)
