"""Kitap sahteleri: FakeScholar (OpenAlex + Semantic Scholar), FakeArxiv, FakeCrossref, FakeUnpaywall.

Hepsi ``fixtures/kitap/*.json``'u okur ve gerçek adaptörlerin normalize fonksiyonlarından geçirir;
yani gerçek ve sahte yol aynı ``ScholarRecord`` biçimini üretir. Sorgu metni sonucu değiştirmez
(fixture tek sorgunun kaydıdır); ``calls`` her sorguyu kaydeder.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from ..adapters.arxiv import normalize_arxiv
from ..adapters.base import ScholarRecord
from ..adapters.openalex import normalize_openalex
from ..adapters.semanticscholar import normalize_s2
from ..adapters.unpaywall import normalize_unpaywall
from ..errors import FixtureNotFoundError
from ..paths import fixtures_root


def _kitap(root: Path | None) -> Path:
    return Path(root) if root is not None else fixtures_root() / "kitap"


def _read(path: Path) -> Any:
    if not path.is_file():
        raise FixtureNotFoundError(f"OGR-ADP-002 kitap fixture'ı yok: {path}")
    return json.loads(path.read_text(encoding="utf-8"))


class FakeScholar:
    """``Scholar`` Protocol'ü; ``source='openalex'`` (varsayılan) ya da ``'semantic_scholar'``."""

    def __init__(self, root: Path | None = None, *, source: str = "openalex"):
        if source not in ("openalex", "semantic_scholar"):
            raise ValueError("FakeScholar kaynağı openalex | semantic_scholar")
        self.root = _kitap(root)
        self.source = source
        self.calls: list[str] = []

    def search(self, query: str, *, limit: int = 30) -> list[ScholarRecord]:
        self.calls.append(query)
        if self.source == "openalex":
            data = _read(self.root / "openalex-search.json")
            return [normalize_openalex(w) for w in data.get("results", [])][:limit]
        data = _read(self.root / "s2-search.json")
        return [normalize_s2(p) for p in data.get("data", [])][:limit]


class FakeArxiv:
    """``Scholar`` Protocol'ü (``source='arxiv'``); ``arxiv-search.json`` normalize Atom kayıtları."""

    source = "arxiv"

    def __init__(self, root: Path | None = None):
        self.root = _kitap(root)
        self.calls: list[str] = []

    def search(self, query: str, *, limit: int = 30) -> list[ScholarRecord]:
        self.calls.append(query)
        data = _read(self.root / "arxiv-search.json")
        return [normalize_arxiv(e) for e in data.get("entries", [])][:limit]


class FakeCrossref:
    """``DOIResolver`` Protocol'ü: ``crossref-ok.json`` → ``message``; 404 kaydı ve bilinmeyen DOI → ``None``."""

    def __init__(self, root: Path | None = None):
        self.root = _kitap(root)
        self._ok = _read(self.root / "crossref-ok.json")
        self._missing = _read(self.root / "crossref-404.json")
        self.calls: list[str] = []

    def resolve(self, doi: str) -> dict | None:
        self.calls.append(doi)
        key = doi.strip()
        if key in self._missing:
            return None
        hit = self._ok.get(key) or next((v for k, v in self._ok.items() if k.lower() == key.lower()), None)
        return json.loads(json.dumps(hit["message"])) if hit else None


class FakeUnpaywall:
    """``OAResolver`` Protocol'ü: ``unpaywall.json`` (DOI → kayıt)."""

    def __init__(self, root: Path | None = None):
        self.root = _kitap(root)
        self._data = _read(self.root / "unpaywall.json")
        self.calls: list[str] = []

    def lookup(self, doi: str) -> dict | None:
        self.calls.append(doi)
        rec = self._data.get(doi.strip())
        return normalize_unpaywall(rec) if rec else None
