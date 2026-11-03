"""Tablet testlerinin ortak fikstürleri. Testler ağa çıkmaz; canlı veritabanı testleri yalnız
``OGRENMEN_DATABASE_URL`` tanımlıysa koşar (yoksa SKIP) ve bağlanılan veritabanına dokunmadan geçici bir
veritabanı açıp kapatır."""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit

import pytest
from ogrenmen_common.clock import FixedClock
from ogrenmen_common.fakes import JsonlDb, LocalDirStorage
from ogrenmen_common.paths import fixtures_root, repo_root

REPO = repo_root()
FIXTURES = fixtures_root()
TABLET_FIXTURES = FIXTURES / "tablet"
SUPABASE = REPO / "supabase"
CONTENT_SCRIPTS = REPO / "content" / "tyt-matematik" / "scripts"
MIGRATION_ROLE = "ogrenmen_owner"  # supabase/tests/00_local_stub.sql yaratır (db-test.sh ile aynı)

ENV_KEYS = ("OGRENMEN_FAKES", "OGRENMEN_NOW", "OGRENMEN_ADAPTERS", "OGRENMEN_FIXTURES", "OGRENMEN_OUT",
            "SUPABASE_URL", "SUPABASE_BATCH_JWT", "SUPABASE_ANON_KEY", "GEMINI_PAID_KEY", "GEMINI_FREE_KEY",
            "GROQ_KEY", "OPENROUTER_KEY", "CF_AI_TOKEN", "CF_ACCOUNT_ID", "ANTHROPIC_KEY", "UNPAYWALL_EMAIL",
            "S2_API_KEY", "GITHUB_ACTIONS")


@pytest.fixture(autouse=True)
def _isolated_env(monkeypatch):
    """Gerçek anahtar/URL testlere sızmaz: her test sahte dünyada başlar."""
    for key in ENV_KEYS:
        monkeypatch.delenv(key, raising=False)


@pytest.fixture
def db() -> JsonlDb:
    """``fixtures/tablet`` + taban ``dev-seed.json`` (batch_worker görünümü)."""
    return JsonlDb.from_fixtures(TABLET_FIXTURES, clock=FixedClock())


@pytest.fixture
def storage(tmp_path) -> LocalDirStorage:
    return LocalDirStorage(tmp_path / "storage")


def read_jsonl(path: Path) -> list[dict]:
    return [json.loads(line) for line in Path(path).read_text(encoding="utf-8").splitlines() if line.strip()]


# --- canlı veritabanı ----------------------------------------------------------------------------


def _db_url(url: str, name: str) -> str:
    p = urlsplit(url)
    return urlunsplit((p.scheme, p.netloc, "/" + name, p.query, p.fragment))


def psql(url: str, *, sql: str | None = None, file: Path | None = None, role: str | None = None,
         variables: dict[str, str] | None = None, check: bool = True) -> subprocess.CompletedProcess:
    """``psql -X -v ON_ERROR_STOP=1``; ``role`` verilirse ``PGOPTIONS='-c role=…'`` (db-test.sh ile aynı)."""
    cmd = ["psql", "-X", "-q", "-At", "-v", "ON_ERROR_STOP=1", "-d", url]
    for k, v in (variables or {}).items():
        cmd += ["-v", f"{k}={v}"]
    if file is not None:
        cmd += ["-f", str(file)]
    elif sql is not None:
        cmd += ["-c", sql]
    env = {**os.environ, "PGOPTIONS": f"-c role={role}" if role else ""}
    proc = subprocess.run(cmd, capture_output=True, text=True, env=env, timeout=300)
    if check and proc.returncode != 0:
        raise AssertionError(f"psql düştü ({proc.returncode}): {proc.stderr.strip()[:2000]}")
    return proc


@pytest.fixture(scope="session")
def live_db(tmp_path_factory):
    """Geçici veritabanı: 00_local_stub.sql → migrations/*.sql → seed/*.sql → müfredat seed'i (export-sql.py).

    supabase/scripts/db-test.sh'in ``prepare_db`` adımlarının aynısıdır (stub süper kullanıcıyla, gerisi süper
    kullanıcı olmayan migration sahibiyle). Bitince veritabanı silinir.
    """
    base = os.environ.get("OGRENMEN_DATABASE_URL")
    if not base:
        pytest.skip("OGRENMEN_DATABASE_URL tanımlı değil (canlı veritabanı testi)")
    if shutil.which("psql") is None:
        pytest.skip("psql istemcisi yok")
    name = f"ogrenmen_tablet_live_{os.getpid()}"
    url = _db_url(base, name)
    psql(base, sql=f'drop database if exists "{name}" with (force)')
    psql(base, sql=f'create database "{name}"')
    work = tmp_path_factory.mktemp("live-db")
    try:
        psql(url, file=SUPABASE / "tests" / "00_local_stub.sql")
        for f in sorted((SUPABASE / "migrations").glob("*.sql")):
            psql(url, file=f, role=MIGRATION_ROLE)
        for f in sorted((SUPABASE / "seed").glob("*.sql")):
            psql(url, file=f, role=MIGRATION_ROLE)
        seed_sql = work / "curriculum.sql"
        subprocess.run([sys.executable, str(CONTENT_SCRIPTS / "export-sql.py"), "--out", str(seed_sql)], check=True,
                       capture_output=True, text=True, timeout=300)
        psql(url, file=seed_sql, role=MIGRATION_ROLE)
        yield url
    finally:
        psql(base, sql=f'drop database if exists "{name}" with (force)', check=False)
