"""PDF → sayfa PNG'leri (``pypdfium2``; §6.4). Ağ yok; yalnız bayt girdisi.

Sayfa üst sınırı ``MAX_PAGES`` (bir sınav kâğıdı; ``exams`` kovası 20 MB): fazlası OCR'a gönderilmez
(maliyet tavanı, sayfa başına ~0,0006 $). Çözünürlük ``DPI`` (OCR için yeterli, görüntü başına ≤ ~1 MB).

**Boyut kemeri.** Render'dan önce her sayfanın ölçüsü (``page.get_size()``, punto) okunur: ``DPI`` ile bir kenarı
``MAX_SIDE_PX``'i ya da tüm sayfaların toplam pikseli ``MAX_TOTAL_PX``'i aşan PDF ``OGR-KALEM-003`` ile reddedilir
(553 baytlık, 14400 × 14400 puntoluk tek sayfa 150 dpi'da 30000 × 30000 piksel = ~2,7 GB bitmap olurdu). Render
sırasında pdfium/bellek/görüntü hataları da ``OGR-KALEM-003`` olur; hiçbir PDF kuyruğu düşüremez.
``inspect_pdf`` yalnız açar, sayar ve ölçer (render yok) — ``ingest --pdf`` satır açmadan önce bunu kullanır.
"""

from __future__ import annotations

import io
from dataclasses import dataclass

from .common import KalemError

MAX_PAGES = 40
DPI = 150
PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
MAX_SIDE_PX = 5000
"""Bir kenarın en çok piksel boyu (A3 150 dpi'da ~2480 px; 5000 px pay bırakır)."""
MAX_TOTAL_PX = 40 * 2480 * 3508
"""Tüm sayfaların toplam piksel bütçesi: 40 sayfa A3 (150 dpi) ≈ 348 milyon piksel."""


@dataclass(frozen=True)
class PdfInfo:
    page_count: int
    sizes_px: list[tuple[int, int]]
    """Sayfa başına (genişlik, yükseklik) piksel (``dpi`` ile)."""


@dataclass(frozen=True)
class RenderedPdf:
    pages: list[bytes]
    """Sayfa başına PNG baytları (sıra korunur)."""
    page_count: int


def _render_errors() -> tuple[type[BaseException], ...]:
    import pypdfium2 as pdfium
    from PIL import Image

    return (pdfium.PdfiumError, MemoryError, OSError, ValueError, Image.DecompressionBombError)


def _open(data: bytes):  # noqa: ANN202 - pypdfium2.PdfDocument
    import pypdfium2 as pdfium

    if not data or not data.lstrip()[:5].startswith(b"%PDF"):
        raise KalemError("OGR-KALEM-003 PDF okunamadı: dosya PDF değil ya da boş")
    try:
        return pdfium.PdfDocument(data)
    except _render_errors() as exc:
        raise KalemError(f"OGR-KALEM-003 PDF okunamadı: {type(exc).__name__}: {exc}") from exc


def _measure(doc, *, dpi: int, max_pages: int, max_side_px: int, max_total_px: int) -> PdfInfo:  # noqa: ANN001
    count = len(doc)
    if count == 0:
        raise KalemError("OGR-KALEM-003 PDF'te sayfa yok")
    if count > max_pages:
        raise KalemError(f"OGR-KALEM-003 PDF {count} sayfa; en çok {max_pages} sayfa işlenir")
    scale = dpi / 72
    sizes: list[tuple[int, int]] = []
    total = 0
    for i in range(count):
        try:
            page = doc[i]
        except _render_errors() as exc:
            raise KalemError(f"OGR-KALEM-003 PDF {i + 1}. sayfa okunamadı: {type(exc).__name__}") from exc
        try:
            width_pt, height_pt = page.get_size()
        finally:
            page.close()
        w, h = int(round(width_pt * scale)), int(round(height_pt * scale))
        if w <= 0 or h <= 0:
            raise KalemError(f"OGR-KALEM-003 PDF {i + 1}. sayfanın ölçüsü geçersiz")
        if max(w, h) > max_side_px:
            raise KalemError(f"OGR-KALEM-003 PDF {i + 1}. sayfa çok büyük ({w} × {h} piksel; bir kenar en çok "
                             f"{max_side_px} piksel)")
        total += w * h
        if total > max_total_px:
            raise KalemError(f"OGR-KALEM-003 PDF sayfaları toplam piksel bütçesini aşıyor (en çok {max_total_px})")
        sizes.append((w, h))
    return PdfInfo(page_count=count, sizes_px=sizes)


def inspect_pdf(data: bytes, *, dpi: int = DPI, max_pages: int = MAX_PAGES, max_side_px: int = MAX_SIDE_PX,
                max_total_px: int = MAX_TOTAL_PX) -> PdfInfo:
    """Ucuz doğrulama: aç, say, ölç (render yok); bozuk/boş/çok uzun/çok büyük PDF ``OGR-KALEM-003``."""
    doc = _open(data)
    try:
        return _measure(doc, dpi=dpi, max_pages=max_pages, max_side_px=max_side_px, max_total_px=max_total_px)
    finally:
        doc.close()


def render_pages(data: bytes, *, dpi: int = DPI, max_pages: int = MAX_PAGES, max_side_px: int = MAX_SIDE_PX,
                 max_total_px: int = MAX_TOTAL_PX) -> RenderedPdf:
    """PDF baytlarını sayfa PNG'lerine çevirir; bozuk/boş/çok uzun/çok büyük PDF ``OGR-KALEM-003``."""
    doc = _open(data)
    try:
        info = _measure(doc, dpi=dpi, max_pages=max_pages, max_side_px=max_side_px, max_total_px=max_total_px)
        pages: list[bytes] = []
        for i in range(info.page_count):
            try:
                page = doc[i]
                try:
                    image = page.render(scale=dpi / 72).to_pil()
                    buf = io.BytesIO()
                    image.save(buf, format="PNG", optimize=False)
                    pages.append(buf.getvalue())
                finally:
                    page.close()
            except _render_errors() as exc:
                raise KalemError(f"OGR-KALEM-003 PDF {i + 1}. sayfa görüntüye çevrilemedi: "
                                 f"{type(exc).__name__}") from exc
        return RenderedPdf(pages=pages, page_count=info.page_count)
    finally:
        doc.close()
