"""Tablo/sütun yetkileri — ``fakes/grants-v2.json``'ın çalışma anı okuyucusu (v2 tabanı).

v2'de özel uygulama rolü yoktur (``batch_worker``/``bot_runtime`` kaldırıldı); ``JsonlDb`` sahtesi
``service_role`` görünümünü taklit eder (gerçek pipeline DB'ye yazmaz).
Matris ``supabase/migrations``'tan ``scripts/gen_grants_v2.py`` ile üretilir ve testte migration'larla
karşılaştırılır (tablo + sütun listesi; ``audit.*`` yalnız ``select, insert``).
``JsonlDb`` yazımlarda yetkiyi buradan denetler; olmayan tabloya/sütuna
yazım canlıda reddedileceği için sahte dünya onu **sessizce kabul etmez**. Eski ``batch_worker`` adı yalnız
sahte (fake) için ``service_role``'a eşlenir.

* Yetki değeri ``"*"`` tablo düzeyi, liste sütun düzeyidir; anahtar yoksa yetki yoktur.
* Dosya her çağrıda değiştirilme zamanına göre yeniden okunur (migration ile birlikte güncellenir).
* Dosya yoksa ya da bozuksa ``OGR-DB-004`` — sessiz düşüş yok.
"""

from __future__ import annotations

import json
import os
from collections.abc import Iterable
from pathlib import Path
from typing import Any

from .errors import DbError, DbPermissionError

LEGACY_ROLES = {"batch_worker": "service_role", "bot_runtime": "service_role"}
"""v1 rol adları → v2 karşılığı (v1 çağıranlar kırılmasın)."""

GRANTS_MATRIX_ENV = "OGRENMEN_GRANTS_MATRIX"
"""Matris yolunu geçersiz kılar (yalnız sınama için)."""

_cache: dict[str, tuple[float, dict]] = {}


def grants_matrix_path() -> Path:
    override = os.environ.get(GRANTS_MATRIX_ENV)
    if override:
        return Path(override)
    return Path(__file__).resolve().parent / "fakes" / "grants-v2.json"


def load_matrix(path: Path | str | None = None) -> dict:
    """Matrisi okur (mtime önbellekli). Yoksa/bozuksa ``DbError('OGR-DB-004 …')``."""
    target = Path(path) if path is not None else grants_matrix_path()
    try:
        mtime = target.stat().st_mtime
    except OSError as exc:
        raise DbError(f"OGR-DB-004 yetki matrisi okunamadı: {target} ({exc.strerror or exc})") from exc
    key = str(target.resolve())
    cached = _cache.get(key)
    if cached is not None and cached[0] == mtime:
        return cached[1]
    try:
        data = json.loads(target.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise DbError(f"OGR-DB-004 yetki matrisi bozuk: {target} ({exc})") from exc
    if not isinstance(data, dict) or not isinstance(data.get("tables"), dict):
        raise DbError(f"OGR-DB-004 yetki matrisi beklenen biçimde değil ('tables' yok): {target}")
    _cache[key] = (mtime, data)
    return data


def qualified(table: str) -> str:
    """``llm_calls`` → ``public.llm_calls``; şemalı ad olduğu gibi."""
    return table if "." in table else f"public.{table}"


def grant(role: str, table: str, op: str, *, matrix: dict | None = None) -> str | frozenset[str] | None:
    """``"*"`` (tablo düzeyi), sütun kümesi ya da ``None`` (yetki yok)."""
    data = matrix if matrix is not None else load_matrix()
    role = LEGACY_ROLES.get(role, role)
    entry = (data["tables"].get(qualified(table)) or {}).get(role) or {}
    value: Any = entry.get(op)
    if value is None:
        return None
    if value == "*":
        return "*"
    return frozenset(value)


def columns(table: str, *, matrix: dict | None = None) -> frozenset[str] | None:
    """Tablonun migration'lardaki sütunları; tablo matriste yoksa ``None``."""
    data = matrix if matrix is not None else load_matrix()
    cols = (data["tables"].get(qualified(table)) or {}).get("columns")
    return frozenset(cols) if cols is not None else None


def has_full(role: str, table: str, op: str) -> bool:
    """Tablo düzeyi yetki var mı (ör. ``RETURNING *`` için tablo düzeyi SELECT)."""
    return grant(role, table, op) == "*"


def require(role: str, table: str, op: str, columns: Iterable[str], *, why: str | None = None) -> None:
    """``columns``'un hepsi ``op`` yetkisinde değilse Postgres'in reddini taklit eder (``OGR-DB-001``)."""
    granted = grant(role, table, op)
    cols = sorted(set(columns))
    suffix = f" — {why}" if why else ""
    if granted is None:
        raise DbPermissionError(f"OGR-DB-001 permission denied for table {table} ({op}; {role}){suffix}")
    if granted == "*":
        return
    missing = [c for c in cols if c not in granted]
    if missing:
        raise DbPermissionError(
            f"OGR-DB-001 permission denied for column {missing[0]} of relation {table} "
            f"({role} {op} yetkisi: {', '.join(sorted(granted))}; yetkisiz: {', '.join(missing)}){suffix}")

