"""Ortak test yardımcıları: sahte Runtime (ağ yok, sabit saat 2026-10-20T09:00Z) ve CLI çağrısı."""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from ogrenmen_common.paths import fixtures_root
from ogrenmen_common.runtime import Runtime

from ogrenmen_kulaklik import cli

FIXTURES = fixtures_root()
KULAKLIK = FIXTURES / "kulaklik"
STUDENT_A = "c661b28c-81a8-5c11-9a5e-b919b5231034"  # s_qk7m2rx4tn5a (reşit, onaylı)
STUDENT_B = "1da926ea-a047-5403-9644-bb047719707b"  # s_vd3hp6wz2kc7 (reşit değil, veli onaylı)
STUDENT_C = "9d4d557b-6191-5018-b679-baf9dbacc67e"  # s_mb5tj7ye4ql2 (onay bekliyor; text_llm null)
REF_A, REF_B, REF_C = "s_qk7m2rx4tn5a", "s_vd3hp6wz2kc7", "s_mb5tj7ye4ql2"


@pytest.fixture(autouse=True)
def _fixed_env(monkeypatch):
    for key in ("OGRENMEN_NOW", "SUPABASE_URL", "SUPABASE_BATCH_JWT", "GEMINI_PAID_KEY", "OGRENMEN_ADAPTERS"):
        monkeypatch.delenv(key, raising=False)


def make_rt(out: Path, fixtures: Path | None = KULAKLIK) -> Runtime:
    return Runtime.from_env(dry_run=True, fixtures=fixtures, out=out)


def run_cli(*args: str) -> int:
    return cli.main(list(args))


def read_jsonl(path: Path) -> list[dict]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def all_uuids_of_people() -> set[str]:
    """Öğrenci, kayıt ve personel uuid'leri (pilot ölçüt ayrıntısında geçmemeli)."""
    seed = json.loads((FIXTURES / "db" / "dev-seed.json").read_text(encoding="utf-8"))
    ids = {r["id"] for t in ("students", "enrollments", "staff") for r in seed[t]}
    return ids
