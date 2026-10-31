#!/usr/bin/env python3
"""Migration'lardaki CREATE TABLE satır içi yorumlarından `comment on table/column` bloklarını üretir.

BLUEPRINT §3: "her tablo ve sütun comment on ile Türkçe açıklanır". Tablo açıklaması `create table … (  -- metin`
satırından, sütun açıklaması sütun satırının sonundaki `-- metin` yorumundan okunur. Her tablonun hemen ardına

    -- begin comments <şema.tablo>
    comment on table …;
    comment on column …;
    -- end comments <şema.tablo>

bloğu yazılır (var olan blok yeniden üretilir; betik idempotenttir). Açıklaması olmayan sütun → hata (çıkış 1).
`--check` dosya yazmaz, blokların güncel olup olmadığını denetler (check_sql.py ayrıca OGR-LINT-COMMENT ile denetler).

Kullanım: python supabase/scripts/sync_comments.py [--check] [migrations dizini]
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

import pglast
from pglast import ast

BLOCK_RE = re.compile(r"\n-- begin comments (\S+)\n.*?\n-- end comments \1\n", re.S)


def qlit(text: str) -> str:
    return "'" + text.replace("'", "''") + "'"


def table_blocks(sql: str, path: Path) -> list[tuple[int, str, str]]:
    """(statement bitiş bayt konumu, tablo adı, blok metni) listesi."""
    out = []
    errors = []
    for stmt in pglast.parse_sql(sql):
        node = stmt.stmt
        if not isinstance(node, ast.CreateStmt):
            continue
        rel = node.relation
        name = f"{rel.schemaname or 'public'}.{rel.relname}"
        start = stmt.stmt_location
        end = start + stmt.stmt_len
        text = sql[start:end]
        lines = text.split("\n")
        head = next((i for i, line in enumerate(lines) if re.match(r"^\s*create\s+table\b", line, re.I)), 0)
        lines = lines[head:]
        m = re.search(r"--\s*(.+?)\s*$", lines[0])
        if not m:
            errors.append(f"{path.name}: {name} tablo açıklaması yok (create table satırında -- yorum)")
            continue
        stmts = [f"comment on table {name} is {qlit(m.group(1))};"]
        for el in node.tableElts or ():
            if not isinstance(el, ast.ColumnDef):
                continue
            col = el.colname
            cm = None
            for line in lines[1:]:
                if re.match(rf"^\s*{re.escape(col)}\s", line):
                    cm = re.search(r"--\s*(.+?)\s*$", line)
                    break
            if not cm:
                errors.append(f"{path.name}: {name}.{col} sütun açıklaması yok")
                continue
            stmts.append(f"comment on column {name}.{col} is {qlit(cm.group(1))};")
        # statement ';' sonrası satır sonuna kadar
        semi = sql.index(";", end) + 1
        eol = sql.find("\n", semi)
        eol = len(sql) if eol < 0 else eol
        block = f"\n-- begin comments {name}\n" + "\n".join(stmts) + f"\n-- end comments {name}\n"
        out.append((eol, name, block))
    if errors:
        raise SystemExit("\n".join(errors))
    return out


def render(sql: str, path: Path) -> str:
    base = BLOCK_RE.sub("\n", sql)
    pieces = []
    last = 0
    for eol, _name, block in table_blocks(base, path):
        pieces.append(base[last:eol])
        pieces.append(block.rstrip("\n"))
        last = eol
    pieces.append(base[last:])
    return "".join(pieces)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--check", action="store_true", help="dosya yazma; güncel değilse 1 ile çık")
    ap.add_argument("migrations", nargs="?", type=Path, default=Path(__file__).resolve().parent.parent / "migrations")
    args = ap.parse_args(argv)
    stale = []
    for path in sorted(args.migrations.glob("*.sql")):
        sql = path.read_text(encoding="utf-8")
        new = render(sql, path)
        if new != sql:
            if args.check:
                stale.append(path.name)
            else:
                path.write_text(new, encoding="utf-8")
                print(f"güncellendi: {path.name}")
    if stale:
        print("comment blokları güncel değil: " + ", ".join(stale), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
