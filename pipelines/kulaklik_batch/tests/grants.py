"""``GrantedDb`` — ``supabase/tests/grants_matrix.json``'daki ``batch_worker`` sütun yetkilerini uygulayan JsonlDb.

JsonlDb yalnız kaba yazım matrisini taklit eder; sütun düzeyinde SELECT/INSERT yetkisini ve PostgREST'in
``return=representation`` (``RETURNING *``) davranışını denetlemez. Bu sınıf canlıdaki reddi yeniden üretir:

* ``select``: tabloda SELECT yoksa ret; sütun düzeyi yetkide ``columns`` verilmemişse (``select=*``) ya da
  ``columns``/``where``/``order`` yetkisiz sütun içeriyorsa ret (``messages`` için PostgrestDb'nin varsayılan
  sütun listesi kullanılır).
* ``insert``/``update`` (``return=representation``): yazılan sütunlar INSERT/UPDATE yetkisinde olmalı **ve**
  ``RETURNING *`` için tablo düzeyi SELECT gerekir; ``on_conflict='merge'`` ayrıca UPDATE ve SELECT ister.
* ``insert_minimal``/``update_minimal`` (``return=minimal``): ``RETURNING`` yok; ``where`` sütunları ve
  ``on_conflict='merge'`` için birincil anahtar sütunları SELECT ister.

RPC gövdeleri ve tetikleyiciler (SECURITY DEFINER) denetlenmez — canlıda da öyledir.
"""

from __future__ import annotations

import json
from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import Any

from ogrenmen_common.adapters.postgrest import MESSAGES_COLUMNS
from ogrenmen_common.errors import DbPermissionError
from ogrenmen_common.fakes.jsonl_db import JsonlDb, _pk

MATRIX_PATH = Path(__file__).resolve().parents[3] / "supabase" / "tests" / "grants_matrix.json"
MATRIX = json.loads(MATRIX_PATH.read_text(encoding="utf-8"))

UPSTREAM_TOLERATED: dict[tuple[str, str], frozenset[str]] = {
    ("llm_calls", "insert"): frozenset({"created_at"}),
}
"""M07 dışındaki koddan gelen bilinen yetki farkları (denetimde yok sayılır, orkestratöre bildirildi):
``ogrenmen_common.ledger.CostLedger.record`` ``llm_calls``'a ``created_at`` gönderir; ``batch_worker``'ın
INSERT yetkisinde bu sütun yoktur (varsayılan ``now()``). M05 düzeltince bu girdi silinmelidir."""


def grant(table: str, op: str) -> Any:
    """``"*"`` (tablo düzeyi), sütun listesi ya da ``None`` (yetki yok)."""
    entry = MATRIX["tables"].get(f"public.{table}") or {}
    return (entry.get("batch_worker") or {}).get(op)


def _covers(granted: Any, columns: Sequence[str]) -> bool:
    if granted is None:
        return False
    if granted == "*":
        return True
    return set(columns) <= set(granted)


def _order_columns(order: str | Sequence[str] | None) -> list[str]:
    specs = [order] if isinstance(order, str) else list(order or [])
    return [s.lstrip("-").removesuffix(".desc").removesuffix(".asc") for s in specs]


class GrantedDb(JsonlDb):
    denials: list[str]

    def _enforced(self) -> bool:
        # RPC gövdesi ve tetikleyiciler (SECURITY DEFINER) denetlenmez: _via 'rpc:…' ya da rol 'postgres'
        return not self._privileged() and self._via == "direct"

    def _deny(self, text: str) -> None:
        self.__dict__.setdefault("denials", []).append(text)
        raise DbPermissionError(f"OGR-DB-001 permission denied: {text}")

    def _need_select(self, table: str, columns: Sequence[str], why: str) -> None:
        if not _covers(grant(table, "select"), columns):
            self._deny(f"select {table}({', '.join(sorted(columns)) or '*'}) — {why}")

    def _need_full_select(self, table: str, why: str) -> None:
        if grant(table, "select") != "*":
            self._deny(f"select * on {table} — {why}")

    def _need_write(self, table: str, op: str, columns: Sequence[str]) -> None:
        columns = [c for c in columns if c not in UPSTREAM_TOLERATED.get((table, op), frozenset())]
        if not _covers(grant(table, op), columns):
            self._deny(f"{op} {table}({', '.join(sorted(columns))})")

    # --- okuma --------------------------------------------------------------------------------------

    def select(self, table: str, *, where: Any = None, columns: Sequence[str] | None = None,
               order: str | Sequence[str] | None = None, limit: int | None = None) -> list[dict]:
        if self._enforced() and not table.startswith(("secure.", "audit.")):
            cols = list(columns) if columns else (list(MESSAGES_COLUMNS) if table == "messages" else [])
            if not cols:
                self._need_full_select(table, "select=*")
            else:
                self._need_select(table, cols, "columns")
            used = [*(where or {}).keys(), *_order_columns(order)]
            if used:
                self._need_select(table, used, "where/order")
        return super().select(table, where=where, columns=columns, order=order, limit=limit)

    # --- return=representation ----------------------------------------------------------------------

    def insert(self, table: str, rows: Mapping[str, Any] | Sequence[Mapping[str, Any]], *,
               on_conflict: str | None = None) -> list[dict]:
        if self._enforced():
            self._check_insert(table, rows, on_conflict)
            self._need_full_select(table, "insert RETURNING *")
        return super().insert(table, rows, on_conflict=on_conflict)

    def update(self, table: str, values: Mapping[str, Any], *, where: Any) -> list[dict]:
        if self._enforced():
            self._need_write(table, "update", list(values))
            self._need_select(table, list(where or {}), "update where")
            self._need_full_select(table, "update RETURNING *")
        return super().update(table, values, where=where)

    # --- return=minimal -----------------------------------------------------------------------------

    def insert_minimal(self, table: str, rows: Sequence[Mapping[str, Any]], *, on_conflict: str | None = None) -> None:
        if self._enforced():
            self._check_insert(table, rows, on_conflict)
        super().insert(table, rows, on_conflict=on_conflict)

    def update_minimal(self, table: str, values: Mapping[str, Any], *, where: Any) -> None:
        if self._enforced():
            self._need_write(table, "update", list(values))
            self._need_select(table, list(where or {}), "update where")
        super().update(table, values, where=where)

    def _check_insert(self, table: str, rows: Any, on_conflict: str | None) -> None:
        items = [rows] if isinstance(rows, Mapping) else list(rows)
        for row in items:
            self._need_write(table, "insert", list(row))
            if on_conflict == "merge":
                self._need_write(table, "update", list(row))
                self._need_select(table, list(_pk(table)), "on conflict do update")


def enforce(db: JsonlDb) -> GrantedDb:
    """Var olan JsonlDb'yi (Runtime ve CostLedger aynı nesneyi tutar) yerinde ``GrantedDb``'ye çevirir."""
    db.__class__ = GrantedDb
    db.__dict__.setdefault("denials", [])
    return db  # type: ignore[return-value]
