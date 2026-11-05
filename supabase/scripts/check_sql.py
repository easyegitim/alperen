#!/usr/bin/env python3
"""Migration kümesinin statik denetimi (v2; docs/PLAN-v2-detail.md §2) — pglast sözdizimi ağacıyla, canlı DB gerekmez.

Denetimler (kod → anlam):
  OGR-LINT-PARSE         dosya ayrıştırılamıyor
  OGR-LINT-RLS           public/secure/audit tablosu için kümenin herhangi bir dosyasında ENABLE + FORCE RLS yok
  OGR-LINT-POLICY        (yalnız --require-policies) tablo için CREATE POLICY yok ve --allowlist'te değil (ya da liste
                         bayat); B1 tabanında politikalar yoktur, RLS politikaları B2'de eklenince açılır
  OGR-LINT-SECURE        secure/audit nesnesine authenticated|anon GRANT'i (dosya başına; service_role serbest)
  OGR-LINT-GRANTALL      GRANT ALL yasak
  OGR-LINT-BASELINE      0002'de ALTER DEFAULT PRIVILEGES … REVOKE ya da REVOKE ALL ON ALL TABLES IN SCHEMA public
                         FROM anon, authenticated yok
  OGR-LINT-SEARCHPATH    SECURITY DEFINER fonksiyonda SET search_path yok
  OGR-LINT-GENERATED     generated always as ifadesinde now()/current_date/current_timestamp …
  OGR-LINT-ORDER         language sql gövdesindeki şema.tablo daha SONRAKİ bir migration'da yaratılıyor
  OGR-LINT-VARCONFLICT   plpgsql: v_ öneksiz yerel değişken, p_ öneksiz parametre ya da değişken/dönüş sütunu adıyla
                         aynı adlı sütuna takma adsız başvuru
  OGR-LINT-COMMENT       tablo ya da sütunun comment on açıklaması yok
  OGR-LINT-CREATEDAT     public/secure/audit tablosunda created_at sütunu yok
  OGR-LINT-UUIDPK        tek sütunlu uuid birincil anahtar (FK değilse) default gen_random_uuid() değil
  OGR-LINT-HALFVEC       halfvec sütunu 1024 boyutlu değil (Voyage voyage-3.5)
  OGR-LINT-MATRIX        fonksiyonda PUBLIC'e EXECUTE verilmiş

Kullanım: python check_sql.py <migrations> [--require-policies] [--allowlist …] [--dump-grants]
Çıkış: hata yoksa 0, varsa 1 (her hata bir satır: KOD dosya: açıklama).
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import Path

import pglast
from pglast import ast
from pglast.enums import AlterTableType, ConstrType, GrantTargetType, ObjectType, RoleSpecType

APP_ROLES = ("anon", "authenticated")
HALFVEC_DIM = 1024
TABLE_SCHEMAS = ("public", "secure", "audit")
VOLATILE_TIME = {"now", "clock_timestamp", "statement_timestamp", "transaction_timestamp", "timeofday", "random"}


@dataclass
class Ctx:
    errors: list[str] = field(default_factory=list)

    def err(self, code: str, where: str, msg: str) -> None:
        self.errors.append(f"{code} {where}: {msg}")


@dataclass
class FileInfo:
    path: Path
    index: int
    sql: str
    stmts: list = field(default_factory=list)


def walk(node):
    """pglast düğüm ağacında derinlemesine gezinti."""
    if isinstance(node, ast.Node):
        yield node
        for name in node:
            yield from walk(getattr(node, name))
    elif isinstance(node, (tuple, list)):
        for item in node:
            yield from walk(item)


def rel_name(rv: ast.RangeVar) -> str:
    return f"{rv.schemaname or 'public'}.{rv.relname}"


def role_name(spec: ast.RoleSpec) -> str:
    if spec.roletype == RoleSpecType.ROLESPEC_PUBLIC:
        return "public"
    return spec.rolename or str(spec.roletype)


def func_options(st: ast.CreateFunctionStmt) -> dict:
    return {o.defname: o.arg for o in (st.options or ())}


def func_name(st) -> str:
    names = [n.sval for n in st.funcname]
    return ".".join(names) if len(names) > 1 else f"public.{names[0]}"


def body_text(opts: dict) -> str | None:
    arg = opts.get("as")
    if arg is None:
        return None
    items = arg if isinstance(arg, (tuple, list)) else (arg,)
    return items[0].sval if items and isinstance(items[0], ast.String) else None


# --- toplama ---------------------------------------------------------------------------------------

def load(migrations: Path, ctx: Ctx) -> list[FileInfo]:
    files = []
    for i, path in enumerate(sorted(migrations.glob("*.sql"))):
        sql = path.read_text(encoding="utf-8")
        info = FileInfo(path=path, index=i, sql=sql)
        try:
            info.stmts = list(pglast.parse_sql(sql))
        except pglast.parser.ParseError as exc:
            ctx.err("OGR-LINT-PARSE", path.name, str(exc))
        files.append(info)
    if not files:
        ctx.err("OGR-LINT-PARSE", str(migrations), "migration dosyası yok")
    return files


def collect_tables(files):
    tables: dict[str, tuple[FileInfo, ast.CreateStmt]] = {}
    views: dict[str, FileInfo] = {}
    columns: dict[str, list[str]] = {}
    for f in files:
        for raw in f.stmts:
            st = raw.stmt
            if isinstance(st, ast.CreateStmt):
                name = rel_name(st.relation)
                tables[name] = (f, st)
                columns[name] = [el.colname for el in (st.tableElts or ()) if isinstance(el, ast.ColumnDef)]
            elif isinstance(st, ast.ViewStmt):
                views[rel_name(st.view)] = f
    return tables, views, columns


# --- denetimler ------------------------------------------------------------------------------------

def check_rls_policies(files, tables, allowlist: set[str], ctx: Ctx, require_policies: bool = False) -> None:
    enabled, forced, policies = set(), set(), defaultdict(int)
    for f in files:
        for raw in f.stmts:
            st = raw.stmt
            if isinstance(st, ast.AlterTableStmt) and st.relation is not None:
                for cmd in st.cmds or ():
                    if cmd.subtype == AlterTableType.AT_EnableRowSecurity:
                        enabled.add(rel_name(st.relation))
                    elif cmd.subtype == AlterTableType.AT_ForceRowSecurity:
                        forced.add(rel_name(st.relation))
            elif isinstance(st, ast.CreatePolicyStmt):
                policies[rel_name(st.table)] += 1
    for name, (f, _st) in sorted(tables.items()):
        if name.split(".")[0] not in TABLE_SCHEMAS:
            continue
        if name not in enabled:
            ctx.err("OGR-LINT-RLS", f.path.name, f"{name}: ENABLE ROW LEVEL SECURITY yok")
        if name not in forced:
            ctx.err("OGR-LINT-RLS", f.path.name, f"{name}: FORCE ROW LEVEL SECURITY yok")
        if not require_policies:
            continue
        if policies[name] == 0 and name not in allowlist:
            ctx.err("OGR-LINT-POLICY", f.path.name, f"{name}: CREATE POLICY yok ve no-policy-allowlist'te değil")
        if policies[name] > 0 and name in allowlist:
            ctx.err("OGR-LINT-POLICY", f.path.name, f"{name}: allowlist'te ama politikası var (liste bayat)")
    if require_policies:
        for name in sorted(allowlist - set(tables)):
            ctx.err("OGR-LINT-POLICY", "no-policy-allowlist.json", f"{name}: böyle bir tablo yok (liste bayat)")


def check_grants_per_file(files, ctx: Ctx) -> None:
    for f in files:
        for raw in f.stmts:
            st = raw.stmt
            if not isinstance(st, ast.GrantStmt) or not st.is_grant:
                continue
            if st.privileges is None:
                ctx.err("OGR-LINT-GRANTALL", f.path.name, "GRANT ALL yasak")
            grantees = {role_name(g) for g in st.grantees}
            bad = grantees & set(APP_ROLES)
            if not bad:
                continue
            for obj in st.objects or ():
                schema = None
                if isinstance(obj, ast.RangeVar):
                    schema = obj.schemaname or "public"
                elif isinstance(obj, ast.ObjectWithArgs):
                    schema = obj.objname[0].sval if len(obj.objname) > 1 else "public"
                elif isinstance(obj, ast.String):
                    schema = obj.sval   # GRANT … ON SCHEMA x / ON ALL … IN SCHEMA x
                if schema in ("secure", "audit"):
                    ctx.err("OGR-LINT-SECURE", f.path.name, f"{schema} nesnesine GRANT: {', '.join(sorted(bad))}")


def check_baseline(files, ctx: Ctx) -> None:
    base = next((f for f in files if f.path.name.startswith("0002")), None)
    if base is None:
        ctx.err("OGR-LINT-BASELINE", "0002_grants_baseline.sql", "dosya yok")
        return
    has_adp = has_revoke = False
    for raw in base.stmts:
        st = raw.stmt
        if isinstance(st, ast.AlterDefaultPrivilegesStmt) and not st.action.is_grant:
            has_adp = True
        if (isinstance(st, ast.GrantStmt) and not st.is_grant and st.privileges is None
                and st.targtype == GrantTargetType.ACL_TARGET_ALL_IN_SCHEMA and st.objtype == ObjectType.OBJECT_TABLE
                and any(isinstance(o, ast.String) and o.sval == "public" for o in st.objects)
                and {"anon", "authenticated"} <= {role_name(g) for g in st.grantees}):
            has_revoke = True
    if not has_adp:
        ctx.err("OGR-LINT-BASELINE", base.path.name, "ALTER DEFAULT PRIVILEGES … REVOKE yok")
    if not has_revoke:
        ctx.err("OGR-LINT-BASELINE", base.path.name, "REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated yok")


def check_functions_and_generated(files, tables, views, columns, ctx: Ctx) -> None:
    created_at = {name: f.index for name, (f, _s) in tables.items()}
    created_at.update({name: f.index for name, f in views.items()})
    for f in files:
        for raw in f.stmts:
            st = raw.stmt
            if isinstance(st, ast.CreateStmt):
                for el in st.tableElts or ():
                    if not isinstance(el, ast.ColumnDef):
                        continue
                    for con in el.constraints or ():
                        if con.contype != ConstrType.CONSTR_GENERATED or con.raw_expr is None:
                            continue
                        for node in walk(con.raw_expr):
                            if isinstance(node, ast.SQLValueFunction) or (
                                    isinstance(node, ast.FuncCall) and node.funcname[-1].sval in VOLATILE_TIME):
                                ctx.err("OGR-LINT-GENERATED", f.path.name,
                                        f"{rel_name(st.relation)}.{el.colname}: generated ifadesinde zaman/rastgele fonksiyon")
            if not isinstance(st, ast.CreateFunctionStmt):
                continue
            opts = func_options(st)
            fname = func_name(st)
            lang = opts.get("language").sval if opts.get("language") is not None else None
            secdef = isinstance(opts.get("security"), ast.Boolean) and opts["security"].boolval
            sets = [o.arg for o in (st.options or ()) if o.defname == "set"]
            if secdef and not any(isinstance(s, ast.VariableSetStmt) and s.name == "search_path" for s in sets):
                ctx.err("OGR-LINT-SEARCHPATH", f.path.name, f"{fname}: SECURITY DEFINER ama SET search_path yok")
            body = body_text(opts)
            if body is None:
                continue
            if lang == "sql":
                check_sql_body_order(f, fname, body, created_at, ctx)
            elif lang == "plpgsql":
                start = raw.stmt_location
                text = f.sql[start:start + raw.stmt_len]
                check_plpgsql(f, fname, st, text, columns, ctx)


def check_sql_body_order(f: FileInfo, fname: str, body: str, created_at: dict, ctx: Ctx) -> None:
    try:
        stmts = pglast.parse_sql(body)
    except pglast.parser.ParseError as exc:
        ctx.err("OGR-LINT-PARSE", f.path.name, f"{fname}: SQL gövdesi ayrıştırılamadı: {exc}")
        return
    for node in walk(stmts):
        if isinstance(node, ast.RangeVar) and node.schemaname:
            name = rel_name(node)
            idx = created_at.get(name)
            if idx is not None and idx > f.index:
                ctx.err("OGR-LINT-ORDER", f.path.name, f"{fname}: gövde {name} okuyor ama tablo daha sonraki bir migration'da yaratılıyor")


PARAM_RE = re.compile(r"^p(_|$)")


def check_plpgsql(f: FileInfo, fname: str, st: ast.CreateFunctionStmt, text: str, columns: dict, ctx: Ctx) -> None:
    params, outs = [], []
    for p in st.parameters or ():
        mode = chr(p.mode) if isinstance(p.mode, int) else getattr(p.mode, "value", p.mode)
        mode = mode if isinstance(mode, str) else str(mode)
        name = p.name
        if name is None:
            continue
        if mode in ("o", "t") or "OUT" in str(p.mode) or "TABLE" in str(p.mode):
            outs.append(name)
        else:
            params.append(name)
    for name in params:
        if not PARAM_RE.match(name):
            ctx.err("OGR-LINT-VARCONFLICT", f.path.name, f"{fname}: parametre {name} p_ önekli değil")
    try:
        tree = json.loads(pglast.parser.parse_plpgsql_json(text))
    except Exception as exc:  # noqa: BLE001 — plpgsql ayrıştırıcı hatası
        ctx.err("OGR-LINT-PARSE", f.path.name, f"{fname}: plpgsql ayrıştırılamadı: {exc}")
        return
    func = tree[0]["PLpgSQL_function"]
    declared = []
    for d in func.get("datums", []):
        kind, val = next(iter(d.items()))
        if kind in ("PLpgSQL_var", "PLpgSQL_rec") and "lineno" in val and val.get("refname") not in ("found", "sqlstate", "sqlerrm"):
            declared.append(val["refname"])
    for name in declared:
        if not name.startswith("v_"):
            ctx.err("OGR-LINT-VARCONFLICT", f.path.name, f"{fname}: yerel değişken {name} v_ önekli değil")
    names = set(declared) | set(outs) | set(params)
    for q, mode in iter_exprs(func):
        sql = expr_sql(q, mode)
        if sql is None:
            continue
        try:
            parsed = pglast.parse_sql(sql)
        except pglast.parser.ParseError:
            continue
        rels = {node.relname for node in walk(parsed) if isinstance(node, ast.RangeVar)}
        cols = set()
        for rel in rels:
            for tname, tcols in columns.items():
                if tname.split(".")[1] == rel:
                    cols.update(tcols)
        for node in walk(parsed):
            if isinstance(node, ast.ColumnRef) and len(node.fields) == 1 and isinstance(node.fields[0], ast.String):
                ref = node.fields[0].sval
                if ref in names and ref in cols:
                    ctx.err("OGR-LINT-VARCONFLICT", f.path.name,
                            f"{fname}: '{ref}' hem değişken/dönüş sütunu hem tablo sütunu; takma adla nitele")


def iter_exprs(node):
    if isinstance(node, dict):
        if "PLpgSQL_expr" in node:
            e = node["PLpgSQL_expr"]
            yield e.get("query", ""), e.get("parseMode", 0)
        for v in node.values():
            yield from iter_exprs(v)
    elif isinstance(node, list):
        for v in node:
            yield from iter_exprs(v)


def expr_sql(query: str, mode: int) -> str | None:
    q = query.strip()
    if not q:
        return None
    if mode == 0:
        return q
    if mode in (3, 4, 5) and ":=" in q:
        q = q.split(":=", 1)[1]
    return "select " + q


def type_name(tn: ast.TypeName) -> str:
    return tn.names[-1].sval if tn.names else ""


def type_mods(tn: ast.TypeName) -> list[int]:
    out = []
    for m in tn.typmods or ():
        val = getattr(m, "val", None)
        if isinstance(val, ast.Integer):
            out.append(val.ival)
    return out


def check_table_shapes(tables, ctx: Ctx) -> None:
    """created_at her tabloda; tek sütunlu uuid pk default gen_random_uuid(); halfvec(1024)."""
    for name, (f, st) in sorted(tables.items()):
        if name.split(".")[0] not in TABLE_SCHEMAS:
            continue
        cols = [el for el in (st.tableElts or ()) if isinstance(el, ast.ColumnDef)]
        if not any(c.colname == "created_at" for c in cols):
            ctx.err("OGR-LINT-CREATEDAT", f.path.name, f"{name}: created_at sütunu yok")
        for c in cols:
            tname = type_name(c.typeName)
            cons = list(c.constraints or ())
            if tname == "halfvec" and type_mods(c.typeName) != [HALFVEC_DIM]:
                ctx.err("OGR-LINT-HALFVEC", f.path.name, f"{name}.{c.colname}: halfvec({HALFVEC_DIM}) olmalı")
            is_pk = any(k.contype == ConstrType.CONSTR_PRIMARY for k in cons)
            is_fk = any(k.contype == ConstrType.CONSTR_FOREIGN for k in cons)
            if tname == "uuid" and is_pk and not is_fk:
                default = next((k.raw_expr for k in cons if k.contype == ConstrType.CONSTR_DEFAULT), None)
                ok = isinstance(default, ast.FuncCall) and default.funcname[-1].sval == "gen_random_uuid"
                if not ok:
                    ctx.err("OGR-LINT-UUIDPK", f.path.name, f"{name}.{c.colname}: uuid pk default gen_random_uuid() değil")


def check_comments(files, tables, columns, ctx: Ctx) -> None:
    commented_tables, commented_cols = set(), set()
    for f in files:
        for raw in f.stmts:
            st = raw.stmt
            if isinstance(st, ast.CommentStmt):
                parts = [p.sval for p in st.object] if isinstance(st.object, tuple) else []
                if st.objtype == ObjectType.OBJECT_TABLE and len(parts) == 2:
                    commented_tables.add(".".join(parts))
                elif st.objtype == ObjectType.OBJECT_COLUMN and len(parts) == 3:
                    commented_cols.add(".".join(parts))
    for name, (f, _s) in sorted(tables.items()):
        if name.split(".")[0] not in TABLE_SCHEMAS:
            continue
        if name not in commented_tables:
            ctx.err("OGR-LINT-COMMENT", f.path.name, f"{name}: comment on table yok (scripts/sync_comments.py)")
        for col in columns[name]:
            if f"{name}.{col}" not in commented_cols:
                ctx.err("OGR-LINT-COMMENT", f.path.name, f"{name}.{col}: comment on column yok")


# --- GRANT matrisi --------------------------------------------------------------------------------

def effective_grants(files, tables, views, columns):
    """Migration sırasıyla GRANT/REVOKE uygulanmış yetki kümesi: rel → rol → yetki → '*' | {sütunlar}; fn → {roller}."""
    rels: dict[str, dict[str, dict[str, object]]] = defaultdict(lambda: defaultdict(dict))
    funcs: dict[str, set[str]] = defaultdict(set)
    created_funcs: dict[str, str] = {}
    for f in files:
        for raw in f.stmts:
            st = raw.stmt
            if isinstance(st, ast.CreateFunctionStmt):
                created_funcs[func_name(st)] = f.path.name
                continue
            if not isinstance(st, ast.GrantStmt):
                continue
            grantees = [role_name(g) for g in st.grantees]
            roles = [r for r in grantees if r in APP_ROLES or r == "public"]
            if st.objtype == ObjectType.OBJECT_TABLE:
                targets = []
                if st.targtype == GrantTargetType.ACL_TARGET_ALL_IN_SCHEMA:
                    schemas = {o.sval for o in st.objects}
                    targets = [n for n in list(tables) + list(views) if n.split(".")[0] in schemas]
                else:
                    targets = [rel_name(o) for o in st.objects]
                for rel in targets:
                    for role in roles:
                        privs = rels[rel][role]
                        if st.privileges is None:
                            if st.is_grant:
                                for p in ("select", "insert", "update", "delete", "truncate", "references", "trigger"):
                                    privs[p] = "*"
                            else:
                                privs.clear()
                            continue
                        for ap in st.privileges:
                            pname = ap.priv_name
                            cols = [c.sval for c in ap.cols] if ap.cols else None
                            if st.is_grant:
                                if cols is None:
                                    privs[pname] = "*"
                                elif privs.get(pname) != "*":
                                    privs[pname] = sorted(set(privs.get(pname) or []) | set(cols))
                            else:
                                if cols is None:
                                    privs.pop(pname, None)
                                elif isinstance(privs.get(pname), list):
                                    rest = sorted(set(privs[pname]) - set(cols))
                                    if rest:
                                        privs[pname] = rest
                                    else:
                                        privs.pop(pname, None)
            elif st.objtype == ObjectType.OBJECT_FUNCTION:
                if st.targtype == GrantTargetType.ACL_TARGET_ALL_IN_SCHEMA:
                    schemas = {o.sval for o in st.objects}
                    names = [n for n in created_funcs if n.split(".")[0] in schemas]
                else:
                    names = [".".join(n.sval for n in o.objname) if len(o.objname) > 1 else f"public.{o.objname[0].sval}"
                             for o in st.objects]
                for name in names:
                    for role in roles:
                        if st.is_grant:
                            funcs[name].add(role)
                        else:
                            funcs[name].discard(role)
    out_rels = {}
    for rel in sorted(set(tables) | set(views)):
        if rel.split(".")[0] not in TABLE_SCHEMAS:
            continue
        entry = {}
        for role in APP_ROLES:
            privs = rels.get(rel, {}).get(role) or {}
            if privs:
                entry[role] = {p: v for p, v in sorted(privs.items())}
        out_rels[rel] = entry
    out_funcs = {name: {"grants": sorted(r for r in funcs.get(name, set()) if r != "public")}
                 for name in sorted(created_funcs) if name.split(".")[0] in ("public", "app")}
    public_leaks = sorted(n for n, rs in funcs.items() if "public" in rs)
    return out_rels, out_funcs, public_leaks


def dump_matrix(rels, funcs, existing: dict | None) -> dict:
    out = dict(existing or {})
    out["tables"] = rels
    out["functions"] = funcs
    return out


def main(argv: list[str] | None = None) -> int:
    here = Path(__file__).resolve().parent
    ap = argparse.ArgumentParser(description="Supabase migration kümesinin statik denetimi (pglast)")
    ap.add_argument("migrations", type=Path)
    ap.add_argument("--require-policies", action="store_true",
                    help="her RLS tablosunda CREATE POLICY ya da --allowlist kaydı iste (B2 RLS politikalarıyla açılır)")
    ap.add_argument("--allowlist", type=Path, default=here / "no-policy-allowlist.json")
    ap.add_argument("--dump-grants", action="store_true", help="migration'lardan hesaplanan yetki kümesini stdout'a yaz (inceleme için)")
    args = ap.parse_args(argv)
    ctx = Ctx()
    files = load(args.migrations, ctx)
    if any(e.startswith("OGR-LINT-PARSE") for e in ctx.errors):
        print("\n".join(ctx.errors), file=sys.stderr)
        return 1
    tables, views, columns = collect_tables(files)
    allow_doc = json.loads(args.allowlist.read_text(encoding="utf-8")) if args.allowlist.exists() else {"tables": []}
    allowlist = {t["name"] if isinstance(t, dict) else t for t in allow_doc.get("tables", [])}
    rels, funcs, leaks = effective_grants(files, tables, views, columns)
    if args.dump_grants:
        print(json.dumps(dump_matrix(rels, funcs, None), ensure_ascii=False, indent=2))
        return 0
    check_rls_policies(files, tables, allowlist, ctx, require_policies=args.require_policies)
    check_grants_per_file(files, ctx)
    check_baseline(files, ctx)
    check_functions_and_generated(files, tables, views, columns, ctx)
    check_comments(files, tables, columns, ctx)
    check_table_shapes(tables, ctx)
    for name in leaks:
        ctx.err("OGR-LINT-MATRIX", "migrations", f"{name}: PUBLIC'e EXECUTE verilmiş")
    if ctx.errors:
        print("\n".join(ctx.errors), file=sys.stderr)
        print(f"check_sql: {len(ctx.errors)} hata", file=sys.stderr)
        return 1
    n_funcs = sum(1 for f in files for r in f.stmts if isinstance(r.stmt, ast.CreateFunctionStmt))
    print(f"check_sql: {len(files)} migration, {len(tables)} tablo, {len(views)} görünüm, {n_funcs} fonksiyon — hata yok")
    return 0


if __name__ == "__main__":
    sys.exit(main())
