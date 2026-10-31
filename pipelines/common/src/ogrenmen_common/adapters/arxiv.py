"""arXiv adaptörü (``Scholar``, ``source='arxiv'``): Atom API ``export.arxiv.org/api/query``.

Atom kaydı önce ``fixtures/kitap/arxiv-search.json`` ile aynı normalize JSON'a (``arxiv_id, doi, title,
authors, published, pdf_url, summary, primary_category``), sonra ortak ``ScholarRecord``'a çevrilir.
DOI yoksa arXiv kimliği ve PDF bağlantısı taşınır (Kitap bunu ``no_doi`` + ``oa_pdf_url`` yapar).
"""

from __future__ import annotations

import xml.etree.ElementTree as ET
from collections.abc import Mapping
from typing import Any

import httpx

from ..errors import AdapterError
from .base import ScholarRecord
from .http import make_client

BASE = "http://export.arxiv.org/api/query"
NS = {"a": "http://www.w3.org/2005/Atom", "arxiv": "http://arxiv.org/schemas/atom"}


def parse_atom(xml_text: str) -> list[dict[str, Any]]:
    """Atom beslemesi → normalize kayıt listesi."""
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError as exc:
        raise AdapterError(f"OGR-ADP-001 arXiv yanıtı bozuk XML: {exc}") from exc
    out = []
    for entry in root.findall("a:entry", NS):
        raw_id = (entry.findtext("a:id", default="", namespaces=NS) or "").strip()
        arxiv_id = raw_id.rsplit("/abs/", 1)[-1] if "/abs/" in raw_id else raw_id
        pdf = None
        for link in entry.findall("a:link", NS):
            if link.get("title") == "pdf" or link.get("type") == "application/pdf":
                pdf = link.get("href")
        cat = entry.find("arxiv:primary_category", NS)
        out.append({
            "arxiv_id": arxiv_id,
            "doi": (entry.findtext("arxiv:doi", default="", namespaces=NS) or "").strip() or None,
            "title": " ".join((entry.findtext("a:title", default="", namespaces=NS) or "").split()),
            "authors": [(a.findtext("a:name", default="", namespaces=NS) or "").strip()
                        for a in entry.findall("a:author", NS)],
            "published": (entry.findtext("a:published", default="", namespaces=NS) or "")[:10] or None,
            "pdf_url": pdf or (f"https://arxiv.org/pdf/{arxiv_id}" if arxiv_id else None),
            "summary": " ".join((entry.findtext("a:summary", default="", namespaces=NS) or "").split()) or None,
            "primary_category": cat.get("term") if cat is not None else None,
        })
    return out


def normalize_arxiv(entry: Mapping[str, Any]) -> ScholarRecord:
    published = entry.get("published") or ""
    year = int(published[:4]) if published[:4].isdigit() else None
    return ScholarRecord(
        title=entry.get("title") or "",
        authors=tuple(a for a in entry.get("authors") or [] if a),
        year=year,
        doi=entry.get("doi") or None,
        venue="arXiv",
        cited_by=0,
        source="arxiv",
        abstract=entry.get("summary"),
        oa_pdf_url=entry.get("pdf_url"),
        external_id=f"arXiv:{entry['arxiv_id']}" if entry.get("arxiv_id") else None,
    )


class ArxivScholar:
    source = "arxiv"

    def __init__(self, *, base: str = BASE, transport: httpx.BaseTransport | None = None):
        self.base = base
        self.client = make_client(transport)

    def search(self, query: str, *, limit: int = 30) -> list[ScholarRecord]:
        try:
            r = self.client.get(self.base, params={"search_query": f"all:{query}", "start": 0,
                                                   "max_results": max(1, min(limit, 100))})
        except httpx.HTTPError as exc:
            raise AdapterError(f"OGR-ADP-001 arXiv isteği başarısız: {exc}") from exc
        if r.status_code != 200:
            raise AdapterError(f"OGR-ADP-001 arXiv HTTP {r.status_code}")
        return [normalize_arxiv(e) for e in parse_atom(r.text)][:limit]
