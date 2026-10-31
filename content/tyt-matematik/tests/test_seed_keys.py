"""seed-keys.py: anahtar doğrulama, SQL kurgusu, CLI davranışı; OGRENMEN_DATABASE_URL varsa canlı Postgres
(tests/stubs/schema.sql taslağı + export-sql.py çıktısı + seed-keys.py)."""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import uuid
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit

import pytest
from conftest import CONTENT_DIR

from templates import _common as C

SEED_KEYS = CONTENT_DIR / "scripts" / "seed-keys.py"
EXPORT = CONTENT_DIR / "scripts" / "export-sql.py"


def test_build_sql_writes_twenty_verified_seed_keys(lib, seed_keys):
    content = lib.load_content()
    sql = seed_keys.build_sql(content)
    assert sql.count("insert into secure.answer_keys") == 20
    assert sql.startswith("begin;") and sql.rstrip().endswith("commit;")
    assert "'verified'" in sql and "'seed', now()" in sql
    assert "where secure.answer_keys.written_by = 'seed'" in sql
    assert "select set_config('ogrenmen.reviewer', 'on', true);" in sql
    assert "OGR-SEED-001" in sql and "OGR-SEED-002" in sql
    for item in content.items:
        assert C.uid("question", item["code"]) in sql
    import pglast

    pglast.parse_sql(sql)


def test_verified_keys_reject_wrong_key(lib, seed_keys, content_copy):
    path = content_copy / "diagnostic" / "answer-keys.json"
    keys = json.loads(path.read_text(encoding="utf-8"))
    keys["DIAG-2026.1-12"]["correct_option"] = "B"
    path.write_text(json.dumps(keys, ensure_ascii=False), encoding="utf-8")
    with pytest.raises(lib.ContentError, match="DIAG-2026.1-12"):
        seed_keys.build_sql(lib.load_content(content_copy))


def _run(*args, env=None):
    return subprocess.run([sys.executable, str(SEED_KEYS), *args], capture_output=True, text=True, timeout=300,
                          env=env)


def test_dry_run_prints_no_key_material(lib):
    proc = _run("--dry-run")
    assert proc.returncode == 0, proc.stderr
    assert "20 anahtar" in proc.stdout
    content = lib.load_content()
    for key in content.keys.values():
        assert key["solution"] not in proc.stdout + proc.stderr


def test_missing_keys_file_skips(content_copy):
    (content_copy / "diagnostic" / "answer-keys.json").unlink()
    proc = _run("--content", str(content_copy))
    assert proc.returncode == 0 and proc.stdout.strip() == "SKIP: no keys"


def test_requires_database_url():
    env = {k: v for k, v in os.environ.items() if k != "OGRENMEN_DATABASE_URL"}
    proc = _run(env=env)
    assert proc.returncode == 2 and "OGRENMEN_DATABASE_URL" in proc.stderr


def test_unreachable_database_fails_cleanly():
    if shutil.which("psql") is None:
        pytest.skip("psql yok")
    proc = _run("--database-url", "postgresql://nobody:x@127.0.0.1:1/none?connect_timeout=2")
    assert proc.returncode == 1 and "anahtarlar yazılamadı" in proc.stderr


# --- canlı Postgres ----------------------------------------------------------------------------

LIVE_URL = os.environ.get("OGRENMEN_DATABASE_URL")
live = pytest.mark.skipif(not LIVE_URL or shutil.which("psql") is None,
                          reason="SKIP: no database (OGRENMEN_DATABASE_URL tanımsız ya da psql yok)")


def _with_db(url: str, dbname: str) -> str:
    parts = urlsplit(url)
    return urlunsplit((parts.scheme, parts.netloc, "/" + dbname, parts.query, parts.fragment))


def psql(url: str, sql: str | None = None, file: Path | None = None) -> subprocess.CompletedProcess:
    cmd = ["psql", url, "-X", "-q", "-At", "-v", "ON_ERROR_STOP=1"]
    cmd += ["-f", str(file)] if file else ["-c", sql]
    return subprocess.run(cmd, capture_output=True, text=True, timeout=120)


def scalar(url: str, sql: str) -> str:
    proc = psql(url, sql)
    assert proc.returncode == 0, proc.stderr
    return proc.stdout.strip()


@pytest.fixture()
def scratch_db():
    name = f"ogrenmen_m03_{uuid.uuid4().hex[:10]}"
    admin = LIVE_URL
    created = psql(admin, f"create database {name}")
    assert created.returncode == 0, created.stderr
    url = _with_db(admin, name)
    try:
        proc = psql(url, file=Path(__file__).parent / "stubs" / "schema.sql")
        assert proc.returncode == 0, proc.stderr
        psql(url, "insert into public.staff (id, full_name, role) values "
                  "('11111111-1111-1111-1111-111111111111', 'Seed Koordinatör', 'coordinator')")
        yield url
    finally:
        psql(admin, f"drop database if exists {name} with (force)")


def _export(tmp_path: Path, *extra: str) -> Path:
    out = tmp_path / f"seed{'-'.join(extra) or ''}.sql"
    proc = subprocess.run([sys.executable, str(EXPORT), "--out", str(out), *extra], capture_output=True, text=True,
                          timeout=300)
    assert proc.returncode == 0, proc.stderr
    return out


@live
@pytest.mark.live
def test_live_seed_then_keys_then_second_version(scratch_db, tmp_path):
    url = scratch_db
    seed = _export(tmp_path)
    proc = psql(url, file=seed)
    assert proc.returncode == 0, proc.stderr
    assert scalar(url, "select status from public.curricula") == "active"
    assert scalar(url, "select count(*) from public.skills") == "21"
    assert scalar(url, "select count(*) from public.questions where status = 'draft' and source = 'diagnostic'") == "20"
    assert scalar(url, "select count(*) from public.figures where review_status = 'verified'") == "3"
    assert scalar(url, "select count(*) from public.questions where figure_id is not null") == "3"
    assert scalar(url, "select cardinality(item_ids) from public.diagnostic_tests") == "20"
    assert scalar(url, "select count(*) from public.legal_texts where body_md like '%{{%'") == "0"
    assert scalar(url, "select count(*) from public.legal_texts where body_md like '%ogrenmen:cocuk-dili:start%'") == "1"
    # anahtarsız onay imkânsız (questions_approve_guard / protect_review)
    denied = psql(url, "update public.questions set status = 'approved'")
    assert denied.returncode != 0 and "OGR-Q-004" in denied.stderr

    proc = _run("--database-url", url)
    assert proc.returncode == 0, proc.stderr
    assert scalar(url, "select count(*) from public.questions where status = 'approved' and reviewed_by is not null") == "20"
    assert scalar(url, "select count(*) from secure.answer_keys where written_by = 'seed' and sympy_status = 'verified'") == "20"
    first = "11111111-1111-1111-1111-111111111111"
    assert scalar(url, "select distinct reviewed_by from public.questions") == first
    key07 = scalar(url, "select k.correct_option from secure.answer_keys k where k.question_id = "
                        f"'{C.uid('question', 'DIAG-2026.1-07')}'")
    assert key07 == "B"

    # tekrar çalıştırma: seed ve anahtarlar idempotent; onaylı soru taslağa dönmez
    assert psql(url, file=seed).returncode == 0
    proc = _run("--database-url", url)
    assert proc.returncode == 0, proc.stderr
    assert scalar(url, "select count(*) from public.questions where status = 'approved'") == "20"
    assert scalar(url, "select count(*) from secure.answer_keys") == "20"

    # eğitmen anahtarı seed tarafından ezilmez
    qid = C.uid("question", "DIAG-2026.1-01")
    psql(url, f"update secure.answer_keys set written_by = 'staff:x', solution = 'eğitmen çözümü burada' "
              f"where question_id = '{qid}'")
    assert _run("--database-url", url).returncode == 0
    assert scalar(url, f"select solution from secure.answer_keys where question_id = '{qid}'") == "eğitmen çözümü burada"

    # ikinci sürüm aynı kazanım kimlikleriyle
    seed2 = _export(tmp_path, "--as-version", "2027.1")
    proc = psql(url, file=seed2)
    assert proc.returncode == 0, proc.stderr
    assert scalar(url, "select count(*) from public.curricula") == "2"
    assert scalar(url, "select count(distinct id) from public.skills") == "21"
    assert scalar(url, "select count(*) from public.skills") == "42"
    assert scalar(url, "select status from public.curricula where version = '2027.1'") == "draft"
    assert scalar(url, "select count(*) from public.misconception_tags") == "27"


@live
@pytest.mark.live
def test_live_keys_before_seed_fail(scratch_db):
    proc = _run("--database-url", scratch_db)
    assert proc.returncode == 1
    assert "OGR-SEED-001" in proc.stderr
    assert scalar(scratch_db, "select count(*) from secure.answer_keys") == "0"


DEV_TABLES = ("staff", "curricula", "skills", "skill_prerequisites", "misconception_tags", "question_templates",
              "figures", "questions", "secure.answer_keys", "diagnostic_tests", "legal_texts")
_ARRAYS = {"skill_ids": "text[]", "item_ids": "uuid[]"}
_JSONB = {"options", "stem_values", "verification", "template_params", "params_schema", "sympy_report", "vision_report"}


def _dev_seed_sql(lib) -> str:
    """fixtures/db/dev-seed.json'un seed'in dokunduğu tablolarını (M02 seed/dev/*.sql eşleniği) SQL'e çevirir."""
    from conftest import REPO_ROOT

    seed = json.loads((REPO_ROOT / "fixtures" / "db" / "dev-seed.json").read_text(encoding="utf-8"))
    out = ["begin;", "select set_config('ogrenmen.reviewer', 'on', true);"]
    for table in DEV_TABLES:
        full = table if "." in table else f"public.{table}"
        rows = seed[table]
        if table == "skills":
            rows = sorted(rows, key=lambda r: r["is_leaf"])
        if table == "questions":  # önce anahtarsız taslak, anahtar sonra, en son durum
            for r in rows:
                r["_status"], r["status"] = r["status"], "draft"
        for r in rows:
            cols = [c for c in r if not c.startswith("_")]
            vals = []
            for c in cols:
                v = r[c]
                if v is None:
                    vals.append("null")
                elif c in _ARRAYS:
                    vals.append("array[" + ", ".join(lib.q(x) for x in v) + f"]::{_ARRAYS[c]}")
                elif c in _JSONB:
                    vals.append(lib.jsonb(v))
                elif isinstance(v, bool | int | float):
                    vals.append(lib.num(v))
                else:
                    vals.append(lib.q(v))
            out.append(f"insert into {full} ({', '.join(cols)}) values ({', '.join(vals)});")
    for r in seed["questions"]:
        out.append(f"update public.questions set status = {lib.q(r['_status'])} where id = {lib.q(r['id'])};")
    out.append("commit;")
    return "\n".join(out)


@live
@pytest.mark.live
def test_live_export_on_top_of_dev_seed(lib, tmp_path):
    """db-test.sh --dev sırası: seed/dev (dev-seed.json) → export-sql.py → seed-keys.py; çakışmalar hata vermez."""
    name = f"ogrenmen_m03_{uuid.uuid4().hex[:10]}"
    assert psql(LIVE_URL, f"create database {name}").returncode == 0
    url = _with_db(LIVE_URL, name)
    try:
        assert psql(url, file=Path(__file__).parent / "stubs" / "schema.sql").returncode == 0
        dev = tmp_path / "dev.sql"
        dev.write_text(_dev_seed_sql(lib), encoding="utf-8")
        proc = psql(url, file=dev)
        assert proc.returncode == 0, proc.stderr
        assert scalar(url, "select count(*) from public.questions where source = 'diagnostic' and status = 'approved'") == "20"
        proc = psql(url, file=_export(tmp_path))
        assert proc.returncode == 0, proc.stderr
        proc = _run("--database-url", url)
        assert proc.returncode == 0, proc.stderr
        content = lib.load_content()
        ids = ", ".join(lib.q(C.uid("question", i["code"])) for i in content.items)
        assert scalar(url, f"select count(*) from public.questions where id in ({ids}) and status = 'approved'") == "20"
        assert scalar(url, f"select count(*) from secure.answer_keys where question_id in ({ids}) "
                           "and written_by = 'seed'") == "20"
        # dev'in teşhis testi satırı bizim sıramızla güncellendi; içerik bizim maddelerimiz
        assert scalar(url, "select count(*) from public.diagnostic_tests") == "1"
        assert scalar(url, "select (item_ids[1])::text from public.diagnostic_tests") == C.uid("question", "DIAG-2026.1-01")
        assert scalar(url, f"select stem from public.questions where id = {lib.q(C.uid('question', 'DIAG-2026.1-05'))}") \
            == content.items[4]["stem"]
        key = content.keys["DIAG-2026.1-05"]["correct_option"]
        assert scalar(url, "select correct_option from secure.answer_keys where question_id = "
                           f"{lib.q(C.uid('question', 'DIAG-2026.1-05'))}") == key
        assert scalar(url, "select count(*) from public.legal_texts where kind = 'grup_kayit'") == "1"
        assert scalar(url, "select count(*) from public.legal_texts where body_md like '%{days}%'") == "0"
    finally:
        psql(LIVE_URL, f"drop database if exists {name} with (force)")
