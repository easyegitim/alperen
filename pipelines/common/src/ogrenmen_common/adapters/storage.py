"""Supabase Storage adaptörü (``Storage``; ``batch_worker`` JWT ile — rol üyeliği ADR-0014).

Uçlar: ``POST /storage/v1/object/<bucket>/<path>`` (yükleme, ``x-upsert``), ``GET`` aynı yol (indirme),
``DELETE /storage/v1/object/<bucket>`` gövde ``{"prefixes": [path]}`` (silme), ``HEAD`` (varlık);
herkese açık adres ``/storage/v1/object/public/<bucket>/<path>`` (yalnız ``figures`` kovası açıktır).
"""

from __future__ import annotations

from urllib.parse import quote

import httpx

from ..errors import StorageError
from .http import make_client


class SupabaseStorage:
    def __init__(self, url: str, jwt: str, *, anon_key: str | None = None, transport: httpx.BaseTransport | None = None,
                 timeout_s: float = 60.0):
        if not url or not jwt:
            raise StorageError("OGR-STO-001 SUPABASE_URL ve SUPABASE_BATCH_JWT gerekli")
        self.base = url.rstrip("/") + "/storage/v1"
        headers = {"Authorization": f"Bearer {jwt}"}
        if anon_key:
            headers["apikey"] = anon_key
        self.client = make_client(transport, headers=headers, timeout_s=timeout_s)

    @staticmethod
    def _path(path: str) -> str:
        return quote(path.lstrip("/"), safe="/")

    def upload(self, bucket: str, path: str, data: bytes, *, content_type: str = "application/octet-stream") -> str:
        r = self.client.post(f"{self.base}/object/{bucket}/{self._path(path)}", content=data,
                             headers={"Content-Type": content_type, "x-upsert": "true"})
        if r.status_code >= 400:
            raise StorageError(f"OGR-STO-001 yükleme başarısız ({r.status_code}): {bucket}/{path}")
        return f"{bucket}/{path.lstrip('/')}"

    def download(self, bucket: str, path: str) -> bytes:
        r = self.client.get(f"{self.base}/object/{bucket}/{self._path(path)}")
        if r.status_code >= 400:
            raise StorageError(f"OGR-STO-001 nesne okunamadı ({r.status_code}): {bucket}/{path}")
        return r.content

    def exists(self, bucket: str, path: str) -> bool:
        r = self.client.head(f"{self.base}/object/{bucket}/{self._path(path)}")
        return r.status_code == 200

    def remove(self, bucket: str, path: str) -> None:
        r = self.client.request("DELETE", f"{self.base}/object/{bucket}", json={"prefixes": [path.lstrip("/")]})
        if r.status_code >= 400:
            raise StorageError(f"OGR-STO-001 silme başarısız ({r.status_code}): {bucket}/{path}")

    def public_url(self, bucket: str, path: str) -> str:
        return f"{self.base}/object/public/{bucket}/{self._path(path)}"
