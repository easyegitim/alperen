"""OpenAlex adaptörü (``Scholar``; polite pool için ``mailto``)."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

import httpx

from ..errors import AdapterError
from .base import ScholarRecord
from .http import make_client

BASE = "https://api.openalex.org"


def strip_doi(value: str | None) -> str | None:
    """``https://doi.org/10.x/y`` → ``10.x/y``; boşsa ``None``."""
    if not value:
        return None
    v = value.strip()
    for prefix in ("https://doi.org/", "http://doi.org/", "doi:", "DOI:"):
        if v.startswith(prefix):
            v = v[len(prefix):]
    return v or None


def abstract_from_index(index: Mapping[str, list[int]] | None) -> str | None:
    """OpenAlex ``abstract_inverted_index`` → düz metin."""
    if not index:
        return None
    positions: list[tuple[int, str]] = []
    for word, places in index.items():
        positions.extend((p, word) for p in places)
    return " ".join(w for _, w in sorted(positions)) or None


def normalize_openalex(work: Mapping[str, Any]) -> ScholarRecord:
    authors = tuple(a.get("author", {}).get("display_name", "") for a in work.get("authorships") or []
                    if a.get("author", {}).get("display_name"))
    loc = work.get("primary_location") or {}
    best = work.get("best_oa_location") or {}
    oa = work.get("open_access") or {}
    return ScholarRecord(
        title=work.get("display_name") or work.get("title") or "",
        authors=authors,
        year=work.get("publication_year"),
        doi=strip_doi(work.get("doi")),
        venue=(loc.get("source") or {}).get("display_name"),
        cited_by=int(work.get("cited_by_count") or 0),
        source="openalex",
        abstract=abstract_from_index(work.get("abstract_inverted_index")),
        oa_pdf_url=best.get("pdf_url") or oa.get("oa_url"),
        external_id=work.get("id"),
    )


class OpenAlexScholar:
    source = "openalex"

    def __init__(self, *, mailto: str | None = None, base: str = BASE, transport: httpx.BaseTransport | None = None):
        self.mailto = mailto
        self.base = base.rstrip("/")
        self.client = make_client(transport)

    def search(self, query: str, *, limit: int = 30) -> list[ScholarRecord]:
        params: dict[str, Any] = {"search": query, "per-page": max(1, min(limit, 200))}
        if self.mailto:
            params["mailto"] = self.mailto
        try:
            r = self.client.get(f"{self.base}/works", params=params)
        except httpx.HTTPError as exc:
            raise AdapterError(f"OGR-ADP-001 OpenAlex isteği başarısız: {exc}") from exc
        if r.status_code != 200:
            raise AdapterError(f"OGR-ADP-001 OpenAlex HTTP {r.status_code}")
        return [normalize_openalex(w) for w in r.json().get("results", [])][:limit]
