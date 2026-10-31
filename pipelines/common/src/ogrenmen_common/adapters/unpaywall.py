"""Unpaywall adaptörü (``OAResolver``): ``GET /v2/{doi}?email=`` → ``{"doi", "is_oa", "pdf_url"}``."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any
from urllib.parse import quote

import httpx

from ..errors import AdapterError
from .http import make_client

BASE = "https://api.unpaywall.org/v2"


def normalize_unpaywall(record: Mapping[str, Any]) -> dict:
    best = record.get("best_oa_location") or {}
    return {"doi": record.get("doi"), "is_oa": bool(record.get("is_oa")),
            "pdf_url": best.get("url_for_pdf") or None}


class UnpaywallResolver:
    def __init__(self, *, email: str, base: str = BASE, transport: httpx.BaseTransport | None = None):
        if not email:
            raise AdapterError("OGR-ADP-001 Unpaywall için UNPAYWALL_EMAIL gerekli")
        self.email = email
        self.base = base.rstrip("/")
        self.client = make_client(transport)

    def lookup(self, doi: str) -> dict | None:
        try:
            r = self.client.get(f"{self.base}/{quote(doi, safe='/')}", params={"email": self.email})
        except httpx.HTTPError as exc:
            raise AdapterError(f"OGR-ADP-001 Unpaywall isteği başarısız: {exc}") from exc
        if r.status_code == 404:
            return None
        if r.status_code != 200:
            raise AdapterError(f"OGR-ADP-001 Unpaywall HTTP {r.status_code}")
        return normalize_unpaywall(r.json())
