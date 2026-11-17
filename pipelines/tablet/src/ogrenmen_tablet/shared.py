"""LLM yolunun (``generate``, ``vision --queue``, ``notes ingest``) ortak sabitleri ve müfredat seçimi.

Tek kaynak: içerik adresli kimlik ad alanı, deneme sınırı (§6.1 (8): en çok 2 deneme), "2 başarısız deneme"
notunun öneki ve etkin müfredat seçimi (en yeni ``year``/``version``).
"""

from __future__ import annotations

import uuid
from typing import Any

from ogrenmen_common.errors import OgrError

NAMESPACE_OGRENMEN = uuid.uuid5(uuid.NAMESPACE_DNS, "ogrenmen.easy")
"""``questions.id``/``figures.id``/``library_documents.id`` için ``uuid5`` ad alanı (içerik adresli kimlik)."""

MAX_ATTEMPTS = 2
"""§6.1 (8): soru üretiminde ve şekil düzeltmede en çok iki deneme."""

TWO_ATTEMPT_PREFIX = f"{MAX_ATTEMPTS} başarısız deneme"
"""2 deneme kuralıyla eğitmen kuyruğuna düşen sorunun ``verification.review_note`` öneki."""

CURRICULUM_COLUMNS = ["id", "code", "version", "year", "status"]


class CurriculumError(OgrError):
    """Etkin müfredat bulunamadı."""


def _newest(rows: list[dict[str, Any]]) -> dict[str, Any]:
    return sorted(rows, key=lambda r: (int(r.get("year") or 0), str(r.get("version"))), reverse=True)[0]


def active_curriculum(db: Any, code: str | None = None) -> dict[str, Any]:
    """Etkin müfredat satırı.

    * ``code`` yok: ``status='active'`` satırların en yenisi (``OGR-GEN-002``).
    * ``TYT-MAT``: o kodun etkin sürümü; ``TYT-MAT@2026.1``: o sürüm (durumundan bağımsız) (``OGR-LIB-002``).
    """
    if code is None:
        rows = [dict(r) for r in db.select("curricula", where={"status": "active"}, columns=CURRICULUM_COLUMNS)]
        if not rows:
            raise CurriculumError("OGR-GEN-002 aktif müfredat yok")
        return _newest(rows)
    base, _, version = code.partition("@")
    rows = [dict(r) for r in db.select("curricula", where={"code": base}, columns=CURRICULUM_COLUMNS)]
    rows = [r for r in rows if r.get("version") == version] if version else [r for r in rows
                                                                             if r.get("status") == "active"]
    if not rows:
        raise CurriculumError(f"OGR-LIB-002 müfredat bulunamadı: {code}")
    return _newest(rows)


def curriculum_label(row: dict[str, Any]) -> str:
    """``TYT-MAT@2026.1``."""
    return f"{row['code']}@{row['version']}"
