"""``GrantedDb`` — ``supabase/tests/grants_matrix.json``'daki ``batch_worker`` sütun yetkilerini uygulayan JsonlDb.

JsonlDb yazımlarda sütun yetkilerini aynı matristen denetler, ama okumalarda (``select``) sütun düzeyi SELECT'i
uygulamaz. Bu sınıf, kuralları her çağrıda güncel ``grants_matrix.json``'dan alarak canlıdaki reddi yeniden üretir:

* ``select``: tabloda SELECT yoksa ret; sütun düzeyi yetkide ``columns`` verilmemişse (``select=*``) ya da
  ``columns``/``where``/``order`` yetkisiz sütun içeriyorsa ret (``messages`` için PostgrestDb'nin varsayılan
  sütun listesi kullanılır).
* ``insert``/``update``: yazılan sütunlar INSERT/UPDATE yetkisinde olmalı; ``returning`` PostgrestDb gibi çözülür
  (tek satır eklemesi ``representation``, satır dizisi ve ``update`` ``minimal``) ve ``representation``
  (``RETURNING *``) tablo düzeyi SELECT ister; ``on_conflict='merge'`` ayrıca UPDATE ve SELECT ister.
* ``insert_minimal``/``update_minimal`` (``return=minimal``): ``RETURNING`` yok; ``where`` sütunları ve
  ``on_conflict='merge'`` için birincil anahtar sütunları SELECT ister.

RPC gövdeleri ve tetikleyiciler (SECURITY DEFINER) denetlenmez — canlıda da öyledir.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any

from ogrenmen_common import grants as common_grants
from ogrenmen_common.adapters.base import resolve_returning
from ogrenmen_common.adapters.postgrest import MESSAGES_COLUMNS
from ogrenmen_common.errors import DbPermissionError
from ogrenmen_common.fakes.jsonl_db import JsonlDb, _pk


def grant(table: str, op: str) -> Any:
    """``batch_worker`` için ``"*"`` (tablo düzeyi), sütun kümesi ya da ``None`` (yetki yok).

    Matris her çağrıda ``ogrenmen_common.grants``'tan okunur (JsonlDb'nin kendi denetimiyle aynı kaynak; mtime
    önbellekli, ``OGRENMEN_GRANTS_MATRIX`` ile geçersiz kılınabilir) — ``pilot_metrics`` dahil hiçbir tablo için
    burada sabit kural yoktur."""
    return common_grants.grant("batch_worker", table, op)


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

    # --- returning (PostgrestDb ile aynı varsayılan: tek satır representation, toplu yazım minimal) ------

    def insert(self, table: str, rows: Mapping[str, Any] | Sequence[Mapping[str, Any]], *,
               on_conflict: str | None = None, returning: str | None = None) -> list[dict]:
        if self._enforced():
            self._check_insert(table, rows, on_conflict)
            if resolve_returning(returning, single_row=isinstance(rows, Mapping)) == "representation":
                self._need_full_select(table, "insert RETURNING *")
        return super().insert(table, rows, on_conflict=on_conflict, returning=returning)

    def update(self, table: str, values: Mapping[str, Any], *, where: Any,
               returning: str | None = None) -> list[dict]:
        if self._enforced():
            self._need_write(table, "update", list(values))
            self._need_select(table, list(where or {}), "update where")
            if resolve_returning(returning, single_row=False) == "representation":
                self._need_full_select(table, "update RETURNING *")
        return super().update(table, values, where=where, returning=returning)

    # --- return=minimal -----------------------------------------------------------------------------

    def insert_minimal(self, table: str, rows: Sequence[Mapping[str, Any]], *, on_conflict: str | None = None) -> None:
        if self._enforced():
            self._check_insert(table, rows, on_conflict)
        super().insert(table, rows, on_conflict=on_conflict, returning="minimal")

    def update_minimal(self, table: str, values: Mapping[str, Any], *, where: Any) -> None:
        if self._enforced():
            self._need_write(table, "update", list(values))
            self._need_select(table, list(where or {}), "update where")
        super().update(table, values, where=where, returning="minimal")

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
