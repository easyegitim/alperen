"""Açık erişim PDF'leri (§6.5 adım 5): Unpaywall ``best_oa_location.url_for_pdf`` → en fazla 6 PDF, her birinden
en çok 40 sayfa, ``pypdf`` ile metin; toplam ≤ 150k belirteç (≈ 4 karakter/belirteç). Metin modele gitmeden önce
``scrub_for_llm``'den geçer (çağıran temizler).

``PdfFetcher`` Protocol'ü bu modüldedir (``ogrenmen_common``'da PDF indirici yoktur):

* ``HttpPdfFetcher`` — ``httpx`` (yönlendirmeleri izler, 25 MB üst sınır, ``%PDF`` imzası denetlenir); ağ hatası,
  HTTP hatası ya da PDF olmayan yanıt ``None`` (o kaynak atlanır, iş düşmez).
* ``FakePdfFetcher`` — ağ yok: her ``http(s)`` bağlantısı için ``fixtures/kitap/sample.pdf``; ``calls`` kaydı.
"""

from __future__ import annotations

import io
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol, runtime_checkable

import httpx
from ogrenmen_common.adapters.http import make_client
from ogrenmen_common.paths import fixtures_root
from pypdf import PdfReader
from pypdf.errors import PdfReadError

from .text import estimate_tokens

MAX_PDFS = 6
MAX_PAGES = 40
MAX_TOTAL_TOKENS = 150_000
MAX_BYTES = 25 * 1024 * 1024


@runtime_checkable
class PdfFetcher(Protocol):
    def fetch(self, url: str) -> bytes | None: ...


class HttpPdfFetcher:
    def __init__(self, *, transport: httpx.BaseTransport | None = None, max_bytes: int = MAX_BYTES,
                 timeout_s: float = 30.0):
        self.client = make_client(transport, timeout_s=timeout_s)
        self.max_bytes = max_bytes
        self.calls: list[str] = []

    def fetch(self, url: str) -> bytes | None:
        self.calls.append(url)
        try:
            with self.client.stream("GET", url, follow_redirects=True) as r:
                if r.status_code != 200:
                    return None
                chunks: list[bytes] = []
                size = 0
                for chunk in r.iter_bytes():
                    size += len(chunk)
                    if size > self.max_bytes:
                        return None
                    chunks.append(chunk)
        except httpx.HTTPError:
            return None
        data = b"".join(chunks)
        return data if data.startswith(b"%PDF") else None


class FakePdfFetcher:
    def __init__(self, root: Path | None = None):
        root = Path(root) if root is not None else fixtures_root() / "kitap"
        path = root / "sample.pdf"
        if not path.is_file():
            path = fixtures_root() / "kitap" / "sample.pdf"
        self.path = path
        self.calls: list[str] = []

    def fetch(self, url: str) -> bytes | None:
        self.calls.append(url)
        if not url.startswith(("http://", "https://")):
            return None
        return self.path.read_bytes()


@dataclass(frozen=True)
class PdfText:
    ordinal: int
    url: str
    pages_read: int
    pages_total: int
    text: str

    @property
    def tokens(self) -> int:
        return estimate_tokens(self.text)


def extract_text(data: bytes, *, max_pages: int = MAX_PAGES) -> tuple[str, int, int] | None:
    """PDF baytları → (metin, okunan sayfa, toplam sayfa); okunamazsa ``None``."""
    try:
        reader = PdfReader(io.BytesIO(data))
        total = len(reader.pages)
        parts = []
        for page in reader.pages[:max_pages]:
            parts.append(page.extract_text() or "")
    except (PdfReadError, ValueError, KeyError, TypeError, OSError):
        return None
    text = "\n".join(" ".join(p.split()) for p in parts if p.strip())
    return text, min(total, max_pages), total


def collect(fetcher: PdfFetcher, items: Sequence[tuple[int, str]], *, max_pdfs: int = MAX_PDFS,
            max_pages: int = MAX_PAGES, max_total_tokens: int = MAX_TOTAL_TOKENS) -> list[PdfText]:
    """``items``: (ordinal, pdf_url) — sıra korunur; bütçe dolunca son metin kırpılır ve durulur."""
    out: list[PdfText] = []
    budget = max_total_tokens
    for ordinal, url in items:
        if len(out) >= max_pdfs or budget <= 0:
            break
        data = fetcher.fetch(url)
        if not data:
            continue
        got = extract_text(data, max_pages=max_pages)
        if got is None or not got[0].strip():
            continue
        text, read, total = got
        if estimate_tokens(text) > budget:
            text = text[: budget * 4]
        budget -= estimate_tokens(text)
        out.append(PdfText(ordinal=ordinal, url=url, pages_read=read, pages_total=total, text=text))
    return out
