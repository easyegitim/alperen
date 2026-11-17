"""Ortak hata türleri.

Hata kodları BLUEPRINT §3.9 deseninde ``OGR-<ALAN>-<NNN>``'dir; RPC hataları veritabanının
``raise exception`` mesajını aynen taşır, çağıran kod mesajın ilk 12 karakterini eşler
(``error.code``). ``ogrenmen_common``'a özgü kodlar:

* ``OGR-RPC-001`` — bilinmeyen RPC (JsonlDb eşleniği yok / PostgREST 404)
* ``OGR-RPC-002`` — RPC JsonlDb'de bilerek çalıştırılmaz (``cron_open_alerts``: dry-run Python eşleniğini kullanır)
* ``OGR-DB-001`` — yetki yok (``secure`` şeması, ``messages.text_raw`` sütunu; batch_worker taklidi)
* ``OGR-DB-002`` — bilinmeyen tablo ya da sütun, birincil anahtar çakışması
* ``OGR-DB-003`` — PostgREST/ağ hatası
* ``OGR-DB-004`` — yetki matrisi (``supabase/tests/grants_matrix.json``) okunamadı ya da bozuk
* ``OGR-LLM-001`` — zincirde hiçbir sağlayıcı başarılı olmadı
* ``OGR-LLM-002`` — tavan (check_spend) ücretli çağrıyı engelledi ve ücretsiz seçenek yok
* ``OGR-LLM-003`` — bilinmeyen amaç ya da zincir
* ``OGR-ADP-001`` — adaptör yapılandırma hatası (anahtar yok, sağlayıcı kapalı)
* ``OGR-ADP-002`` — sahte veri (fixture) bulunamadı
* ``OGR-STO-001`` — depolama nesnesi bulunamadı
"""

from __future__ import annotations

import re

_CODE = re.compile(r"^OGR-[A-Z]+-[0-9A-Z]+")


class OgrError(Exception):
    """Tüm ``ogrenmen_common`` hatalarının tabanı; ``code`` mesajdaki ``OGR-…`` önekidir."""

    def __init__(self, message: str):
        super().__init__(message)
        self.message = message

    @property
    def code(self) -> str | None:
        m = _CODE.match(self.message)
        return m.group(0) if m else None


class RpcError(OgrError):
    """Bir RPC gövdesinin fırlattığı hata (ör. ``OGR-KEY-003 anahtar kilitli``)."""

    def __init__(self, message: str, *, rpc: str | None = None):
        super().__init__(message)
        self.rpc = rpc


class DbError(OgrError):
    """Tablo/sütun hatası ya da PostgREST hatası."""


class DbPermissionError(DbError):
    """batch_worker rolünün yetkisi olmayan erişim (``permission denied``)."""


class AdapterError(OgrError):
    """Dış servis adaptörü yapılandırma/çağrı hatası."""


class FixtureNotFoundError(AdapterError):
    """Sahte adaptörün okuyacağı fixture bulunamadı."""


class LedgerError(OgrError):
    """CostLedger: zincir başarısız ya da tavan engeli; ``attempts`` tüm denemeleri taşır."""

    def __init__(self, message: str, attempts: list | None = None):
        super().__init__(message)
        self.attempts = list(attempts or [])


class StorageError(OgrError):
    """Depolama nesnesi okunamadı/yazılamadı."""
