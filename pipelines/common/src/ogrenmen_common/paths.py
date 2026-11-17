"""Depo kökü ve paylaşılan fixture yolları.

Kök sırasıyla ``OGRENMEN_REPO_ROOT`` ortam değişkeninden ya da bu dosyanın üst dizinlerinde
``fixtures/db/dev-seed.json`` arayarak bulunur (düzenlenebilir kurulumda paket depo içinde kalır).
``fixtures/`` M01'in malıdır; bu modül oraya hiçbir şey yazmaz.
"""

from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path

from .errors import FixtureNotFoundError

_MARKER = Path("fixtures") / "db" / "dev-seed.json"


@lru_cache(maxsize=4)
def _find_root(start: str, env_root: str | None) -> Path:
    if env_root:
        root = Path(env_root).resolve()
        if not (root / _MARKER).is_file():
            raise FixtureNotFoundError(f"OGR-ADP-002 OGRENMEN_REPO_ROOT altında {_MARKER} yok: {root}")
        return root
    here = Path(start).resolve()
    for parent in [here, *here.parents]:
        if (parent / _MARKER).is_file():
            return parent
    raise FixtureNotFoundError(f"OGR-ADP-002 depo kökü bulunamadı ({_MARKER} aranırken): {here}")


def repo_root() -> Path:
    """Monorepo kökü (``fixtures/db/dev-seed.json`` içeren dizin)."""
    return _find_root(str(Path(__file__).parent), os.environ.get("OGRENMEN_REPO_ROOT"))


def fixtures_root() -> Path:
    """Paylaşılan ``fixtures/`` dizini."""
    return repo_root() / "fixtures"


def llm_fixtures_root() -> Path:
    """``fixtures/llm`` — amaç klasörleri (chat, nightly_facts, …)."""
    return fixtures_root() / "llm"


def dev_seed_path() -> Path:
    """``fixtures/db/dev-seed.json`` — JsonlDb'nin taban dünyası."""
    return fixtures_root() / "db" / "dev-seed.json"
