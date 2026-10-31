"""Crossref adaptörü (``DOIResolver``): ``GET /works/{doi}`` → ``message`` ya da ``None``.

Yalnız 404 ve tüm denemelerde zaman aşımı "çözülemedi" sayılır (``None``; Kitap ``crossref_unresolved``
yazar, §6.5). 5xx yeniden denenir; son denemeye kadar düzelmezse ``AdapterError`` (Crossref kesintisinde gerçek
atıflar "çözülemedi" diye düşürülmez). Diğer HTTP hataları da ``AdapterError``.
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
        server_error: int | None = None
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
                server_error = r.status_code
                continue
            if r.status_code != 200:
                raise AdapterError(f"OGR-ADP-001 Crossref HTTP {r.status_code}")
            return r.json().get("message")
        if server_error is not None:
            raise AdapterError(f"OGR-ADP-001 Crossref HTTP {server_error} ({self.attempts} deneme; kesinti)")
        return None
