"""PostgrestDb — ``DB`` Protocol'ünün gerçek uygulaması (Supabase PostgREST, ``batch_worker`` JWT).

* Başlıklar: ``apikey: SUPABASE_ANON_KEY``, ``Authorization: Bearer SUPABASE_BATCH_JWT``. ``service_role``
  bu kodda yoktur; ``secure`` şeması PostgREST'e açık değildir ve istek atılmadan reddedilir.
* ``messages`` okumasının varsayılan sütun listesi ``MESSAGES_COLUMNS``'tır: ``text_raw`` **yoktur**
  (``batch_worker``'ın sütun yetkisinde değildir; §3.8, §6 kural 5 — statik test bunu denetler);
  ``text_raw`` isteyen çağrı ağa gitmeden ``DbPermissionError``.
* RPC hataları (``{"code":"P0001","message":"OGR-…"}``) ``RpcError`` olarak, mesaj aynen taşınır.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from datetime import date, datetime
from typing import Any

import httpx

from ..clock import iso
from ..errors import DbError, DbPermissionError, RpcError
from .base import Filter, Where
from .http import make_client

MESSAGES_COLUMNS: tuple[str, ...] = (
    "id", "chat_id", "telegram_message_id", "sender_role", "student_id", "staff_id", "reply_to_telegram_message_id",
    "text_llm", "attachments", "mentions_bot", "is_question", "answered_at", "sent_at", "created_at",
)
"""batch_worker'ın ``messages`` sütun yetkisi (0014_rls.sql ``grant select (…)``) — ``text_raw`` YOK."""

DEFAULT_COLUMNS: dict[str, tuple[str, ...]] = {"messages": MESSAGES_COLUMNS}
DENIED_COLUMNS: dict[str, frozenset[str]] = {"messages": frozenset({"text_raw"})}


def base_column(item: str) -> str:
    """PostgREST seçim öğesinin taban sütunu: takma ad (``raw:text_raw``), tür dönüşümü (``text_raw::text``),
    JSON yolu (``meta->a``, ``meta->>a``) ve boşluklar soyulur — yasak sütun denetimi buna bakar."""
    text = str(item).strip()
    cast = text.find("::")
    if cast != -1:
        text = text[:cast]
    if ":" in text:  # takma ad: "ad:sütun" (tür dönüşümü yukarıda ayrıldı)
        text = text.split(":")[-1]
    arrow = text.find("->")
    if arrow != -1:
        text = text[:arrow]
    return text.strip().strip('"')


def _literal(value: Any) -> str:
    if value is True:
        return "true"
    if value is False:
        return "false"
    if value is None:
        return "null"
    if isinstance(value, datetime):
        return iso(value)
    if isinstance(value, date):
        return value.isoformat()
    return str(value)


def _list_item(value: Any) -> str:
    text = _literal(value)
    if any(ch in text for ch in ',()"\\ ') or text == "":
        return '"' + text.replace("\\", "\\\\").replace('"', '\\"') + '"'
    return text


def filter_params(where: Where | None) -> list[tuple[str, str]]:
    """``{"status": "queued", "created_at": gte(x)}`` → ``[("status", "eq.queued"), ("created_at", "gte.x")]``."""
    out: list[tuple[str, str]] = []
    for col, cond in (where or {}).items():
        if isinstance(cond, Filter):
            op, val = cond.op, cond.value
        elif isinstance(cond, (list, tuple, set, frozenset)):
            op, val = "in", list(cond)
        else:
            op, val = "eq", cond
        if op == "in":
            out.append((col, "in.(" + ",".join(_list_item(v) for v in val) + ")"))
        elif op == "is":
            out.append((col, "is.null" if val is None else f"is.{_literal(val)}"))
        elif op == "not_is":
            out.append((col, "not.is.null" if val is None else f"not.is.{_literal(val)}"))
        elif op == "cs":
            out.append((col, "cs.{" + ",".join(_list_item(v) for v in val) + "}"))
        elif op in ("eq", "neq", "gt", "gte", "lt", "lte"):
            out.append((col, f"{op}.{_literal(val)}"))
        else:
            raise DbError(f"OGR-DB-002 bilinmeyen işleç: {op}")
    return out


def order_param(order: str | Sequence[str] | None) -> str | None:
    specs = [order] if isinstance(order, str) else list(order or [])
    parts = []
    for spec in specs:
        if spec.startswith("-"):
            parts.append(f"{spec[1:]}.desc")
        elif spec.endswith((".desc", ".asc")):
            parts.append(spec)
        else:
            parts.append(f"{spec}.asc")
    return ",".join(parts) or None


class PostgrestDb:
    def __init__(self, url: str, jwt: str, *, anon_key: str | None = None, transport: httpx.BaseTransport | None = None,
                 timeout_s: float = 30.0):
        if not url or not jwt:
            raise DbError("OGR-DB-003 SUPABASE_URL ve SUPABASE_BATCH_JWT gerekli")
        self.base = url.rstrip("/") + "/rest/v1"
        headers = {"Authorization": f"Bearer {jwt}", "Content-Type": "application/json"}
        if anon_key:
            headers["apikey"] = anon_key
        self.client = make_client(transport, headers=headers, timeout_s=timeout_s)

    @staticmethod
    def _check_table(table: str) -> None:
        if table.startswith("secure.") or table.startswith("audit."):
            raise DbPermissionError(f"OGR-DB-001 permission denied for schema {table.split('.')[0]}")

    def select_columns(self, table: str, columns: Sequence[str] | None) -> str:
        cols = list(columns) if columns else list(DEFAULT_COLUMNS.get(table, ("*",)))
        denied = DENIED_COLUMNS.get(table, frozenset())
        bad = [c for c in cols if (base := base_column(c)) in denied or (base == "*" and denied)]
        if bad:
            raise DbPermissionError(f"OGR-DB-001 permission denied for column {bad[0]} of relation {table}")
        return ",".join(cols)

    def _raise(self, response: httpx.Response, rpc: str | None = None) -> None:
        try:
            payload = response.json()
        except ValueError:
            payload = {}
        message = str(payload.get("message") or response.text[:300] or f"HTTP {response.status_code}")
        if message.startswith("OGR-"):
            raise RpcError(message, rpc=rpc)
        if response.status_code in (401, 403) or payload.get("code") == "42501":
            raise DbPermissionError(f"OGR-DB-001 {message}")
        if response.status_code == 404 and rpc is not None:
            raise RpcError(f"OGR-RPC-001 bilinmeyen RPC: {rpc} ({message})", rpc=rpc)
        raise DbError(f"OGR-DB-003 PostgREST {response.status_code}: {message}")

    def _send(self, method: str, path: str, *, params: list[tuple[str, str]] | None = None, json: Any = None,
              prefer: str | None = None, rpc: str | None = None) -> httpx.Response:
        headers = {"Prefer": prefer} if prefer else None
        try:
            response = self.client.request(method, f"{self.base}/{path}", params=params, json=json, headers=headers)
        except httpx.HTTPError as exc:
            raise DbError(f"OGR-DB-003 PostgREST ulaşılamadı: {exc}") from exc
        if response.status_code >= 400:
            self._raise(response, rpc)
        return response

    def select(self, table: str, *, where: Where | None = None, columns: Sequence[str] | None = None,
               order: str | Sequence[str] | None = None, limit: int | None = None) -> list[dict]:
        self._check_table(table)
        params = [("select", self.select_columns(table, columns)), *filter_params(where)]
        o = order_param(order)
        if o:
            params.append(("order", o))
        if limit is not None:
            params.append(("limit", str(int(limit))))
        return list(self._send("GET", table, params=params).json())

    def insert(self, table: str, rows: Mapping[str, Any] | Sequence[Mapping[str, Any]], *,
               on_conflict: str | None = None) -> list[dict]:
        self._check_table(table)
        body = [dict(rows)] if isinstance(rows, Mapping) else [dict(r) for r in rows]
        prefer = "return=representation"
        if on_conflict == "ignore":
            prefer += ",resolution=ignore-duplicates"
        elif on_conflict == "merge":
            prefer += ",resolution=merge-duplicates"
        elif on_conflict is not None:
            raise DbError(f"OGR-DB-002 bilinmeyen on_conflict: {on_conflict}")
        return list(self._send("POST", table, json=body, prefer=prefer).json())

    def update(self, table: str, values: Mapping[str, Any], *, where: Where) -> list[dict]:
        self._check_table(table)
        if not where:
            raise DbError("OGR-DB-002 koşulsuz update yapılmaz")
        return list(self._send("PATCH", table, params=filter_params(where), json=dict(values),
                               prefer="return=representation").json())

    def delete(self, table: str, *, where: Where) -> int:
        self._check_table(table)
        if not where:
            raise DbError("OGR-DB-002 koşulsuz delete yapılmaz")
        return len(self._send("DELETE", table, params=filter_params(where), prefer="return=representation").json())

    def rpc(self, name: str, params: Mapping[str, Any] | None = None) -> Any:
        response = self._send("POST", f"rpc/{name}", json=dict(params or {}), rpc=name)
        if response.status_code == 204 or not response.content:
            return None
        return response.json()
