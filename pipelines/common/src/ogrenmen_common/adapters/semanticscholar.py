"""Semantic Scholar adaptörü (``Scholar``; ``S2_API_KEY`` varsa ``x-api-key``)."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

import httpx

from ..errors import AdapterError
from .base import ScholarRecord
from .http import make_client

BASE = "https://api.semanticscholar.org/graph/v1"
FIELDS = "title,year,venue,citationCount,externalIds,authors,abstract,openAccessPdf,tldr"


def normalize_s2(paper: Mapping[str, Any]) -> ScholarRecord:
    pdf = paper.get("openAccessPdf") or {}
    tldr = paper.get("tldr") or {}
    return ScholarRecord(
        title=paper.get("title") or "",
        authors=tuple(a.get("name", "") for a in paper.get("authors") or [] if a.get("name")),
        year=paper.get("year"),
        doi=(paper.get("externalIds") or {}).get("DOI"),
        venue=paper.get("venue") or None,
        cited_by=int(paper.get("citationCount") or 0),
        source="semantic_scholar",
        abstract=paper.get("abstract"),
        oa_pdf_url=pdf.get("url"),
        tldr=tldr.get("text"),
        external_id=paper.get("paperId"),
    )


class SemanticScholar:
    source = "semantic_scholar"

    def __init__(self, *, api_key: str | None = None, base: str = BASE, transport: httpx.BaseTransport | None = None):
        headers = {"x-api-key": api_key} if api_key else None
        self.base = base.rstrip("/")
        self.client = make_client(transport, headers=headers)

    def search(self, query: str, *, limit: int = 30) -> list[ScholarRecord]:
        try:
            r = self.client.get(f"{self.base}/paper/search",
                                params={"query": query, "limit": max(1, min(limit, 100)), "fields": FIELDS})
        except httpx.HTTPError as exc:
            raise AdapterError(f"OGR-ADP-001 Semantic Scholar isteği başarısız: {exc}") from exc
        if r.status_code != 200:
            raise AdapterError(f"OGR-ADP-001 Semantic Scholar HTTP {r.status_code}")
        return [normalize_s2(p) for p in r.json().get("data", [])][:limit]
