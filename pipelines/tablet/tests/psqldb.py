"""Canlı testler için ``DB`` Protocol'ü: her işlem ``psql`` ile ``SET LOCAL ROLE batch_worker`` altında koşar.

PostgREST'in ``batch_worker`` JWT'siyle kurduğu deyimlerin eşleniğidir (``request.jwt.claims`` rol iddiası, RLS ve
sütun yetkileri gerçek). PostgREST ikilisi bu ortamda yok; Tablet'in yazdığı her satırın gerçek şema, politika ve
yetki matrisinden geçtiğini bu sınıf gösterir. Yalnız testte kullanılır.
"""

from __future__ import annotations

import json
import os
import subprocess
import tempfile
from collections.abc import Mapping, Sequence
from typing import Any

from ogrenmen_common.adapters.base import Filter
from ogrenmen_common.errors import DbError, DbPermissionError, RpcError

PRELUDE = r"""\set QUIET on
\o /dev/null
begin;
set local role batch_worker;
select set_config('request.jwt.claims', '{"role":"batch_worker"}', true);
\o
"""
_CMP = {"gt": ">", "gte": ">=", "lt": "<", "lte": "<="}


def _text(value: Any) -> str:
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, dict | list):
        return json.dumps(value, ensure_ascii=False)
    return str(value)


class PsqlDb:
    def __init__(self, url: str):
        self.url = url
        self._fns: dict[str, tuple[list[tuple[str, str]], bool, str]] = {}
        self.statements: list[str] = []

    # --- çalıştırma ----------------------------------------------------------------------------

    def _psql(self, sql: str, variables: Mapping[str, str], *, as_batch: bool = True) -> str:
        with tempfile.NamedTemporaryFile("w", suffix=".sql", delete=False, encoding="utf-8") as fh:
            fh.write((PRELUDE if as_batch else "") + sql + ("\ncommit;\n" if as_batch else "\n"))
            path = fh.name
        cmd = ["psql", "-X", "-q", "-At", "-v", "ON_ERROR_STOP=1", "-d", self.url, "-f", path]
        for k, v in variables.items():
            cmd += ["-v", f"{k}={v}"]
        try:
            proc = subprocess.run(cmd, capture_output=True, text=True, timeout=120,
                                  env={**os.environ, "PGOPTIONS": ""})
        finally:
            os.unlink(path)
        self.statements.append(sql)
        if proc.returncode != 0:
            err = next((ln.split("ERROR:", 1)[1].strip() for ln in proc.stderr.splitlines() if "ERROR:" in ln),
                       proc.stderr.strip())
            if err.startswith("OGR-"):
                raise RpcError(err)
            if "permission denied" in err or "row-level security" in err:
                raise DbPermissionError(f"OGR-DB-001 {err}")
            raise DbError(f"OGR-DB-002 {err}")
        return proc.stdout.strip()

    def _where(self, where: Mapping[str, Any] | None, variables: dict[str, str]) -> str:
        clauses = []
        for col, cond in (where or {}).items():
            name = f"w{len(variables)}"
            if isinstance(cond, Filter):
                op, arg = cond.op, cond.value
            elif isinstance(cond, list | tuple | set | frozenset):
                op, arg = "in", list(cond)
            else:
                op, arg = "eq", cond
            q = f'"{col}"'
            if op == "eq":
                variables[name] = _text(arg)
                clauses.append(f"{q}::text = :'{name}'")
            elif op == "neq":
                variables[name] = _text(arg)
                clauses.append(f"{q}::text <> :'{name}'")
            elif op == "in":
                variables[name] = json.dumps([_text(a) for a in arg], ensure_ascii=False)
                clauses.append(f"{q}::text in (select json_array_elements_text(:'{name}'::json))")
            elif op == "is":
                clauses.append(f"{q} is null" if arg is None else f"{q} is {_text(arg)}")
            elif op == "not_is":
                clauses.append(f"{q} is not null" if arg is None else f"{q} is not {_text(arg)}")
            elif op == "cs":
                variables[name] = json.dumps([_text(a) for a in arg], ensure_ascii=False)
                clauses.append(f"{q} @> array(select json_array_elements_text(:'{name}'::json))")
            elif op in _CMP:
                variables[name] = _text(arg)
                clauses.append(f"{q} {_CMP[op]} :'{name}'")
            else:
                raise DbError(f"OGR-DB-002 bilinmeyen işleç: {op}")
        return (" where " + " and ".join(clauses)) if clauses else ""

    @staticmethod
    def _order(order: str | Sequence[str] | None) -> str:
        specs = [order] if isinstance(order, str) else list(order or [])
        parts = []
        for spec in specs:
            desc = spec.startswith("-") or spec.endswith(".desc")
            col = spec.lstrip("-").removesuffix(".desc").removesuffix(".asc")
            parts.append(f'"{col}" {"desc" if desc else "asc"}')
        return (" order by " + ", ".join(parts)) if parts else ""

    # --- DB Protocol ---------------------------------------------------------------------------

    def select(self, table: str, *, where=None, columns=None, order=None, limit=None) -> list[dict]:
        variables: dict[str, str] = {}
        cols = ", ".join(f'"{c}"' for c in columns) if columns else "*"
        sql = (f"select coalesce(json_agg(t), '[]'::json) from (select {cols} from public.{table}"
               f"{self._where(where, variables)}{self._order(order)}"
               f"{f' limit {int(limit)}' if limit is not None else ''}) t;")
        return json.loads(self._psql(sql, variables) or "[]")

    def insert(self, table: str, rows, *, on_conflict: str | None = None, returning: str | None = None):
        items = [dict(rows)] if isinstance(rows, Mapping) else [dict(r) for r in rows]
        if on_conflict:
            raise DbError("OGR-DB-002 PsqlDb on_conflict desteklemez")
        out: list[dict] = []
        groups: dict[tuple[str, ...], list[dict]] = {}
        for item in items:
            groups.setdefault(tuple(item), []).append(item)
        for keys, group in groups.items():
            cols = ", ".join(f'"{c}"' for c in keys)
            variables = {"rows": json.dumps(group, ensure_ascii=False)}
            body = (f"insert into public.{table} ({cols}) select {cols} from "
                    f"json_populate_recordset(null::public.{table}, :'rows'::json)")
            if returning == "representation" or (returning is None and isinstance(rows, Mapping)):
                sql = f"with ins as ({body} returning *) select coalesce(json_agg(ins), '[]'::json) from ins;"
                out.extend(json.loads(self._psql(sql, variables) or "[]"))
            else:
                self._psql(body + ";", variables)
        return out

    def update(self, table: str, values, *, where, returning: str | None = None):
        variables = {"vals": json.dumps(dict(values), ensure_ascii=False)}
        cols = ", ".join(f'"{c}"' for c in values)
        sql = (f"update public.{table} set ({cols}) = (select {cols} from "
               f"json_populate_record(null::public.{table}, :'vals'::json)){self._where(where, variables)};")
        self._psql(sql, variables)
        return []

    def delete(self, table: str, *, where) -> int:
        variables: dict[str, str] = {}
        self._psql(f"delete from public.{table}{self._where(where, variables)};", variables)
        return 0

    def _signature(self, name: str) -> tuple[list[tuple[str, str]], bool, str]:
        if name not in self._fns:
            sql = ("select json_build_object('args', pg_get_function_identity_arguments(p.oid), 'set', p.proretset, "
                   "'ret', p.prorettype::regtype::text) from pg_proc p where p.pronamespace = 'public'::regnamespace "
                   "and p.proname = :'n';")
            raw = self._psql(sql, {"n": name}, as_batch=False)
            if not raw:
                raise RpcError(f"OGR-RPC-001 fonksiyon yok: {name}")
            meta = json.loads(raw)
            args = []
            for part in [a.strip() for a in meta["args"].split(",") if a.strip()]:
                arg_name, arg_type = part.split(" ", 1)
                args.append((arg_name, arg_type))
            self._fns[name] = (args, bool(meta["set"]), meta["ret"])
        return self._fns[name]

    def rpc(self, name: str, params: Mapping[str, Any] | None = None) -> Any:
        args, is_set, ret = self._signature(name)
        params = dict(params or {})
        variables: dict[str, str] = {}
        call_args = []
        for arg_name, arg_type in args:
            if arg_name not in params:
                continue
            value = params[arg_name]
            if value is None:
                call_args.append(f"{arg_name} => null::{arg_type}")
                continue
            variables[arg_name] = _text(value)
            call_args.append(f"{arg_name} => :'{arg_name}'::{arg_type}")
        call = f"public.{name}({', '.join(call_args)})"
        if is_set:
            return json.loads(self._psql(f"select coalesce(json_agg(r), '[]'::json) from {call} r;", variables) or "[]")
        if ret == "void":
            self._psql(f"select {call};", variables)
            return None
        raw = self._psql(f"select to_json({call});", variables)
        return json.loads(raw) if raw else None
