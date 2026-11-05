"""Kalem testlerinin ortak fikstürleri: ağ yok, sabit saat (2026-10-20T09:00Z), sahte Runtime, CLI çağrısı.

Canlı veritabanı testi (``test_live_db.py``) yalnız ``OGRENMEN_DATABASE_URL`` tanımlıysa koşar ve bağlanılan
veritabanına dokunmadan geçici bir veritabanı açıp kapatır.
"""

from __future__ import annotations

import contextlib
import json
import shutil
from pathlib import Path

import pytest
from ogrenmen_common import cli_base
from ogrenmen_common.paths import fixtures_root, repo_root
from ogrenmen_common.runtime import Runtime

from ogrenmen_kalem import cli

REPO = repo_root()
FIXTURES = fixtures_root()
KALEM = FIXTURES / "kalem"
SOURCE_2022 = "c97a5607-ead2-5620-b865-cf6bb93495e4"   # status='uploaded', instructor_alias='hoca-A'
SOURCE_2023 = "53ad77db-789c-5344-b86e-a2491d00af64"   # status='ocr_done' (maddesiz)
DEMO_COURSE = "a48b1144-f71e-5ff2-8c38-92f9d76c3805"
CURRICULUM = "7a988b84-8937-5242-8c35-ddbc4ea9216d"
APPROVED_PLAN = "d323913e-7e24-5ad9-8bc5-4a32cfa8485b"  # dev-seed: TYT-MAT, status='approved'
INSTRUCTOR = "de70e65e-1410-5026-a773-c5e55a3e6368"

ENV_KEYS = ("OGRENMEN_FAKES", "OGRENMEN_NOW", "OGRENMEN_ADAPTERS", "OGRENMEN_FIXTURES", "OGRENMEN_OUT",
            "SUPABASE_URL", "SUPABASE_BATCH_JWT", "SUPABASE_ANON_KEY", "GEMINI_PAID_KEY", "GEMINI_FREE_KEY",
            "GROQ_KEY", "OPENROUTER_KEY", "CF_AI_TOKEN", "CF_ACCOUNT_ID", "ANTHROPIC_KEY", "UNPAYWALL_EMAIL",
            "S2_API_KEY", "GITHUB_ACTIONS")


@pytest.fixture(autouse=True)
def _isolated_env(monkeypatch):
    """Gerçek anahtar/URL testlere sızmaz: her test sahte dünyada başlar."""
    for key in ENV_KEYS:
        monkeypatch.delenv(key, raising=False)


def make_rt(out: Path | None, fixtures: Path | None = KALEM) -> Runtime:
    return Runtime.from_env(dry_run=True, fixtures=fixtures, out=out)


def run_cli(*args: str) -> int:
    return cli.main(list(args))


def read_jsonl(path: Path) -> list[dict]:
    return [json.loads(line) for line in Path(path).read_text(encoding="utf-8").splitlines() if line.strip()]


def fixture_ocr_texts() -> list[str]:
    texts = []
    for name in ("ocr-2022.json", "ocr-2023.json"):
        texts.extend(i["ocr_text"] for i in json.loads((KALEM / name).read_text(encoding="utf-8")))
    return texts


def substrings_12(texts: list[str]) -> set[str]:
    out: set[str] = set()
    for t in texts:
        for i in range(len(t) - 11):
            out.add(t[i:i + 12])
    return out


def copy_fixtures(tmp_path: Path, name: str = "fx") -> Path:
    """``fixtures/kalem`` kopyası (testin değiştirebileceği)."""
    dest = tmp_path / name
    shutil.copytree(KALEM, dest)
    return dest


def edit_json(path: Path, fn) -> None:  # noqa: ANN001
    data = json.loads(path.read_text(encoding="utf-8"))
    data = fn(data) or data
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


class SharedRuntime:
    """Ardışık CLI çağrıları tek Runtime'ı (tek JsonlDb) paylaşır — gece zincirinin aynı veritabanında koşması."""

    def __init__(self) -> None:
        self.rt: Runtime | None = None

    @contextlib.contextmanager
    def open(self, ns, **kwargs):  # noqa: ANN001
        if self.rt is None:
            self.rt = cli_base.runtime_from_args(ns, **kwargs)
        yield self.rt

    def close(self) -> None:
        if self.rt is not None:
            self.rt.close()
            self.rt = None


@pytest.fixture
def shared_runtime(monkeypatch):
    shared = SharedRuntime()
    monkeypatch.setattr(cli_base, "open_runtime", shared.open)
    yield shared
    shared.close()
