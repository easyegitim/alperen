"""Ortak test fikstürleri. Hiçbir test ağa çıkmaz; ``@pytest.mark.live`` testleri ``LIVE=1`` yoksa atlanır."""

from __future__ import annotations

import json
import os
from pathlib import Path

import pytest

from ogrenmen_common.clock import FixedClock
from ogrenmen_common.fakes import FakeLLM, JsonlDb
from ogrenmen_common.ledger import CostLedger
from ogrenmen_common.paths import fixtures_root, repo_root

REPO = repo_root()
FIXTURES = fixtures_root()


def pytest_configure(config):
    config.addinivalue_line("markers", "live: gerçek ağ ister; LIVE=1 olmadan atlanır")


def pytest_collection_modifyitems(config, items):
    if os.environ.get("LIVE"):
        return
    skip = pytest.mark.skip(reason="LIVE=1 değil (ağ isteyen test)")
    for item in items:
        if "live" in item.keywords:
            item.add_marker(skip)


@pytest.fixture(autouse=True)
def _isolated_env(monkeypatch):
    for key in ("OGRENMEN_FAKES", "OGRENMEN_NOW", "OGRENMEN_ADAPTERS", "OGRENMEN_FIXTURES", "OGRENMEN_OUT",
                "SUPABASE_URL", "SUPABASE_BATCH_JWT", "SUPABASE_ANON_KEY", "GEMINI_PAID_KEY", "GEMINI_FREE_KEY",
                "GROQ_KEY", "OPENROUTER_KEY", "CF_AI_TOKEN", "CF_ACCOUNT_ID", "ANTHROPIC_KEY", "UNPAYWALL_EMAIL",
                "S2_API_KEY", "GITHUB_ACTIONS"):
        monkeypatch.delenv(key, raising=False)


@pytest.fixture
def clock() -> FixedClock:
    return FixedClock("2026-10-20T09:00:00Z")


@pytest.fixture
def out(tmp_path) -> Path:
    return tmp_path / "out"


@pytest.fixture
def db(clock, out) -> JsonlDb:
    return JsonlDb.from_fixtures(out_dir=out, clock=clock)


def as_admin(db: JsonlDb):
    """Test kurulumu: aynı dünyaya ``postgres`` rolüyle (yetki taklidi olmadan) yazmak için ``with as_admin(db):``."""
    class _Ctx:
        def __enter__(self):
            self.prev = db.role
            db.role = "postgres"
            return db

        def __exit__(self, *exc):
            db.role = self.prev
            return False

    return _Ctx()


@pytest.fixture
def ledger(db, clock) -> CostLedger:
    return CostLedger(db, FakeLLM(), clock=clock, dry_run=True)


def read_jsonl(path: Path) -> list[dict]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def seed_json(name: str):
    return json.loads((FIXTURES / name).read_text(encoding="utf-8"))
