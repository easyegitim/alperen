"""Uygulama rollerinin tablo/sütun yetkileri — ``supabase/tests/grants_matrix.json``'ın çalışma anı okuyucusu.

Matris BLUEPRINT §3.8'in makine-okur hâlidir (kaynak ``supabase/migrations/0014_rls.sql`` GRANT'leri; M02'nin
malıdır, bu modül yalnız okur). ``JsonlDb`` yazımlarda ``batch_worker``'ın INSERT/UPDATE sütun yetkisini buradan
denetler; sahte dünya canlıda reddedilecek bir yazımı **sessizce kabul etmez** (§12 #57).

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
from .paths import repo_root

GRANTS_MATRIX_ENV = "OGRENMEN_GRANTS_MATRIX"
"""Matris yolunu geçersiz kılar (yalnız sınama için)."""

_cache: dict[str, tuple[float, dict]] = {}


def grants_matrix_path() -> Path:
    override = os.environ.get(GRANTS_MATRIX_ENV)
    if override:
        return Path(override)
    return repo_root() / "supabase" / "tests" / "grants_matrix.json"


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
    entry = (data["tables"].get(qualified(table)) or {}).get(role) or {}
    value: Any = entry.get(op)
    if value is None:
        return None
    if value == "*":
        return "*"
    return frozenset(value)


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

