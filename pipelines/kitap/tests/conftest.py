"""Kitap testlerinin ortak fikstürleri: ağ yok, sabit saat (2026-10-20T09:00Z), sahte Runtime, CLI çağrısı.

Canlı veritabanı testi (``test_live_db.py``) yalnız ``OGRENMEN_DATABASE_URL`` tanımlıysa koşar ve bağlanılan
veritabanına dokunmadan geçici bir veritabanı açıp kapatır.
"""

from __future__ import annotations

import json
import shutil
from pathlib import Path

import pytest
from ogrenmen_common.paths import fixtures_root, llm_fixtures_root, repo_root
from ogrenmen_common.runtime import Runtime

from ogrenmen_kitap import cli

REPO = repo_root()
FIXTURES = fixtures_root()
KITAP = FIXTURES / "kitap"
QUEUED_1 = "9480be99-349a-5e9e-8b49-cc81722b83f6"   # öğrenci isteği, queued
QUEUED_2 = "b33430e9-7422-5d88-b762-eb5d8984c506"   # personel isteği, queued
DONE = "88aef3ff-53e8-5bfa-843b-acc2d9456277"       # done (dokunulmamalı)
FAKE_DOI = "10.9999/fake"
MISMATCH_DOI = "10.5555/ogrenmen.mismatch"

ENV_KEYS = ("OGRENMEN_FAKES", "OGRENMEN_NOW", "OGRENMEN_ADAPTERS", "OGRENMEN_FIXTURES", "OGRENMEN_OUT",
            "SUPABASE_URL", "SUPABASE_BATCH_JWT", "SUPABASE_ANON_KEY", "GEMINI_PAID_KEY", "GEMINI_FREE_KEY",
            "GROQ_KEY", "OPENROUTER_KEY", "CF_AI_TOKEN", "CF_ACCOUNT_ID", "ANTHROPIC_KEY", "UNPAYWALL_EMAIL",
            "S2_API_KEY", "TELEGRAM_OPS_BOT_TOKEN", "ADMIN_CHAT_ID", "GITHUB_ACTIONS", "ZOTERO_API_KEY",
            "ZOTERO_LIBRARY_ID", "ZOTERO_LIBRARY_TYPE")


@pytest.fixture(autouse=True)
def _isolated_env(monkeypatch):
    """Gerçek anahtar/URL testlere sızmaz: her test sahte dünyada başlar."""
    for key in ENV_KEYS:
        monkeypatch.delenv(key, raising=False)


def set_flag(rt: Runtime, key: str, value) -> None:  # noqa: ANN001
    for row in rt.db.tables["runtime_flags"]:
        if row["key"] == key:
            row["value"] = value
            return
    rt.db.tables["runtime_flags"].append({"key": key, "value": value, "updated_at": "2026-10-01T00:00:00Z",
                                          "updated_by": "test"})


def make_rt(out: Path | None, *, fixtures: Path | None = KITAP, enabled: bool = True, llm_options=None) -> Runtime:  # noqa: ANN001
    rt = Runtime.from_env(dry_run=True, fixtures=fixtures, out=out, llm_options=llm_options)
    set_flag(rt, "research_enabled", enabled)
    return rt


def only_fixture(tmp: Path, picks: dict[str, str]) -> Path:
    """``fixtures/llm`` kopyası; ``picks`` amaç → tek dosya (sahte seçim deterministik olsun)."""
    root = tmp / "llm"
    for purpose in ("query_expand", "research"):
        src = llm_fixtures_root() / purpose
        dst = root / purpose
        dst.mkdir(parents=True, exist_ok=True)
        names = [picks[purpose]] if purpose in picks else [p.name for p in src.glob("*.json")]
        for name in names + ["bad-schema.json"]:
            shutil.copy(src / name, dst / name)
    return root


def enabled_fixtures(tmp: Path) -> Path:
    """``fixtures/kitap`` + ``research_enabled=true`` bayrak tablosu (CLI testleri için)."""
    dst = tmp / "kitap-fixtures"
    shutil.copytree(KITAP, dst)
    seed = json.loads((FIXTURES / "db" / "dev-seed.json").read_text(encoding="utf-8"))
    flags = [dict(f, value=True) if f["key"] == "research_enabled" else f for f in seed["runtime_flags"]]
    (dst / "runtime_flags.json").write_text(json.dumps(flags, ensure_ascii=False), encoding="utf-8")
    return dst


def run_cli(*args: str) -> int:
    return cli.main(list(args))


def read_jsonl(path: Path) -> list[dict]:
    return [json.loads(line) for line in Path(path).read_text(encoding="utf-8").splitlines() if line.strip()]
