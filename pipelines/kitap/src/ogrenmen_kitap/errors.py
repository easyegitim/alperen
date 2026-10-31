"""Kitap hata türleri ve kodları (``OGR-KITAP-NNN``; desen BLUEPRINT §3.9).

* ``OGR-KITAP-001`` — araştırma isteği bulunamadı
* ``OGR-KITAP-002`` — istek bu komutla çalıştırılamaz (durumu ``done``/``running``)
* ``OGR-KITAP-003`` — hiçbir akademik kaynaktan aday gelmedi
* ``OGR-KITAP-004`` — doğrulanmış (``verified``/``no_doi``) kaynak kalmadı
* ``OGR-KITAP-005`` — sentez boş kaldı (her paragraf doğrulanmamış kaynağa dayanıyordu)
* ``OGR-KITAP-006`` — çıktı ``research-output`` sözleşmesine aykırı
* ``OGR-KITAP-007`` — üretilen BibTeX geçersiz ya da anahtarlar benzersiz değil
* ``OGR-KITAP-008`` — araştırma çıktısı bulunamadı (``verify``)
* ``OGR-KITAP-009`` — ``--name-hashes`` biçimi (64 karakterlik sha256 hex dizisi olmalı)
* ``OGR-KITAP-010`` — Crossref kesintisi (gerçek atıflar "çözülemedi" diye düşürülmez; iş başarısız sayılır)
* ``OGR-KITAP-011`` — kapı: araştırma kapalı, harcama tavanı ya da aylık araştırma tavanı (``GateBlocked``)
"""

from __future__ import annotations

from ogrenmen_common.errors import OgrError


class KitapError(OgrError):
    """Kitap boru hattının Türkçe, kodlu hatası."""


class GateBlocked(KitapError):
    """Ağ ve model çağrısından ÖNCE kapı engeli.

    ``kind``: ``disabled`` (``research_enabled=false``), ``degraded`` (``degraded_mode``), ``spend``
    (``check_spend`` ücretli çağrıya izin vermiyor) ya da ``monthly_cap`` (``research_monthly_cap`` doldu)."""

    def __init__(self, kind: str, message: str):
        super().__init__(f"OGR-KITAP-011 {message}")
        self.kind = kind
