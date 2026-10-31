"""İsteğe bağlı Zotero aktarımı (§6.5 adım 7): ``ZOTERO_API_KEY`` + ``ZOTERO_LIBRARY_ID`` varsa ve iş gerçek kipte
çalışıyorsa tutulan atıflar kurucunun Zotero kitaplığına eklenir. ``pyzotero`` yerine doğrudan Zotero Web API v3
(``POST /{users|groups}/{id}/items``, en çok 50 öğe/istek) ``httpx`` ile çağrılır — bağımlılık az, sahte taşıyıcıyla
(``httpx.MockTransport``) sınanır. Dry-run'da ve anahtar yokken hiç çağrılmaz; aktarım hatası araştırmayı düşürmez.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any

import httpx
from ogrenmen_common.adapters.http import make_client
from ogrenmen_common.errors import AdapterError

from .verify import Checked

BASE = "https://api.zotero.org"
BATCH = 50
TAG = "ogrenmen-kitap"


def item_for(c: Checked) -> dict[str, Any]:
    kind = "preprint" if "arxiv" in c.cand.sources and c.crossref_status == "no_doi" else (
        "journalArticle" if c.crossref_status == "verified" else "document")
    creators = []
    for p in c.authors:
        if p.get("family") or p.get("given"):
            creators.append({"creatorType": "author", "firstName": p.get("given", ""), "lastName": p.get("family", "")})
        elif p.get("name"):
            creators.append({"creatorType": "author", "name": p["name"]})
    item: dict[str, Any] = {"itemType": kind, "title": c.title, "creators": creators,
                            "date": str(c.year) if c.year else "", "tags": [{"tag": TAG}]}
    if kind == "journalArticle":
        item["publicationTitle"] = c.venue or ""
        item["DOI"] = c.cand.doi or ""
    elif kind == "preprint":
        item["repository"] = "arXiv"
    if c.oa_pdf_url:
        item["url"] = c.oa_pdf_url
    return item


class ZoteroExporter:
    def __init__(self, api_key: str, library_id: str, *, library_type: str = "user", base: str = BASE,
                 transport: httpx.BaseTransport | None = None):
        if not api_key or not library_id:
            raise AdapterError("OGR-ADP-001 Zotero için ZOTERO_API_KEY ve ZOTERO_LIBRARY_ID gerekli")
        if library_type not in ("user", "group"):
            raise AdapterError("OGR-ADP-001 ZOTERO_LIBRARY_TYPE user | group olmalı")
        self.url = f"{base.rstrip('/')}/{library_type}s/{library_id}/items"
        self.client = make_client(transport, headers={"Zotero-API-Key": api_key, "Zotero-API-Version": "3"})

    def export(self, cits: Sequence[Checked]) -> dict[str, int]:
        items = [item_for(c) for c in cits]
        ok = failed = 0
        for i in range(0, len(items), BATCH):
            chunk = items[i:i + BATCH]
            try:
                r = self.client.post(self.url, json=chunk)
            except httpx.HTTPError as exc:
                raise AdapterError(f"OGR-ADP-001 Zotero isteği başarısız: {exc}") from exc
            if r.status_code != 200:
                raise AdapterError(f"OGR-ADP-001 Zotero HTTP {r.status_code}")
            try:
                body = r.json()
            except ValueError as exc:
                raise AdapterError("OGR-ADP-001 Zotero yanıtı JSON değil") from exc
            if not isinstance(body, dict):
                raise AdapterError("OGR-ADP-001 Zotero yanıtı beklenen nesne değil")
            ok += len(body.get("successful") or {})
            failed += len(body.get("failed") or {})
        return {"successful": ok, "failed": failed}


def exporter_from_env(env: Mapping[str, str]) -> ZoteroExporter | None:
    key, lib = env.get("ZOTERO_API_KEY"), env.get("ZOTERO_LIBRARY_ID")
    if not key or not lib:
        return None
    return ZoteroExporter(key, lib, library_type=env.get("ZOTERO_LIBRARY_TYPE", "user"))
