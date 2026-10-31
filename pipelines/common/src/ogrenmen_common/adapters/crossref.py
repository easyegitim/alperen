"""Crossref adaptörü (``DOIResolver``): ``GET /works/{doi}`` → ``message`` ya da ``None``.

404 ve iki denemede zaman aşımı "çözülemedi" sayılır (``None``; Kitap ``crossref_unresolved``
yazar, §6.5); diğer HTTP hataları ``AdapterError``.
"""

from __future__ import annotations

from urllib.parse import quote

import httpx

from ..errors import AdapterError
from .http import make_client

BASE = "https://api.crossref.org"


class CrossrefResolver:
    def __init__(self, *, mailto: str | None = None, base: str = BASE, attempts: int = 2,
                 transport: httpx.BaseTransport | None = None):
        ua = f"ogrenmen-pipelines/0.1 (mailto:{mailto})" if mailto else None
        self.base = base.rstrip("/")
        self.attempts = max(1, attempts)
        self.client = make_client(transport, headers={"User-Agent": ua} if ua else None)

    def resolve(self, doi: str) -> dict | None:
        url = f"{self.base}/works/{quote(doi, safe='/')}"
        for _ in range(self.attempts):
            try:
                r = self.client.get(url)
            except httpx.TimeoutException:
                continue
            except httpx.HTTPError as exc:
                raise AdapterError(f"OGR-ADP-001 Crossref isteği başarısız: {exc}") from exc
            if r.status_code == 404:
                return None
            if r.status_code >= 500:
                continue
            if r.status_code != 200:
                raise AdapterError(f"OGR-ADP-001 Crossref HTTP {r.status_code}")
            return r.json().get("message")
        return None
