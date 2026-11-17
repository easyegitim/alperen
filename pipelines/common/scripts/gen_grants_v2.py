#!/usr/bin/env python3
"""v2 yetki matrisini migration'lardan üretir: ``src/ogrenmen_common/fakes/grants-v2.json``.

v2'de özel uygulama rolü yoktur (``batch_worker``/``bot_runtime`` kaldırıldı; docs/PLAN-v2-detail.md §2): pipeline'lar
yalnız ``service_role`` ile çalışır ve RLS'i aşar. Matris bu yüzden her tablo için ``service_role``'a tablo düzeyi
yetki verir; asıl değeri her tablonun SÜTUN listesidir (JsonlDb olmayan sütuna yazımı reddeder).

Kullanım:  python gen_grants_v2.py          # dosyayı yazar
           python gen_grants_v2.py --check  # dosya migration'larla uyuşmuyorsa 1 ile çıkar
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
MIGRATIONS = ROOT / "supabase" / "migrations"
OUT = HERE.parent / "src" / "ogrenmen_common" / "fakes" / "grants-v2.json"

_CREATE = re.compile(r"^create table (?:if not exists )?([a-z_]+\.[a-z_0-9]+)\s*\(", re.I)
_ADD_COL = re.compile(
    r"^alter table (?:only )?([a-z_]+\.[a-z_0-9]+)\s+add column (?:if not exists )?([a-z_0-9]+)", re.I)
_SKIP = ("primary", "foreign", "unique", "check", "constraint", "exclude", "like")
_COL = re.compile(r"^\s{2}([a-z_][a-z_0-9]*)\s+\S")


def parse_columns(sql_dir: Path = MIGRATIONS) -> dict[str, list[str]]:
    tables: dict[str, list[str]] = {}
    for path in sorted(sql_dir.glob("*.sql")):
        current: str | None = None
        for line in path.read_text(encoding="utf-8").splitlines():
            if current is None:
                m = _CREATE.match(line)
                if m:
                    current = m.group(1).lower()
                    tables.setdefault(current, [])
                    continue
                m = _ADD_COL.match(line)
                if m and m.group(1).lower() in tables:
                    tables[m.group(1).lower()].append(m.group(2).lower())
                continue
            if line.startswith(");") or line.startswith(")"):
                current = None
                continue
            m = _COL.match(line)
            if m and m.group(1).lower() not in _SKIP:
                tables[current].append(m.group(1).lower())
    return {t: sorted(set(c)) for t, c in sorted(tables.items())}


def build(sql_dir: Path = MIGRATIONS) -> dict:
    full = {"select": "*", "insert": "*", "update": "*", "delete": "*"}
    append_only = {"select": "*", "insert": "*"}  # 0002: audit şeması `select, insert` (yalnız eklemeli)
    cols = parse_columns(sql_dir)
    return {
        "description": "v2 yetki matrisi (migration'lardan üretilir: scripts/gen_grants_v2.py). v2'de uygulama rolü "
                       "yoktur; pipeline'lar service_role ile çalışır (RLS'i aşar). 'columns' tablonun sütunlarıdır.",
        "roles": ["service_role"],
        "tables": {t: {"columns": c, "service_role": dict(append_only if t.startswith("audit.") else full)}
                   for t, c in cols.items()},
    }


def main(argv: list[str]) -> int:
    data = json.dumps(build(), ensure_ascii=False, indent=2, sort_keys=False) + "\n"
    if "--check" in argv:
        if not OUT.is_file() or OUT.read_text(encoding="utf-8") != data:
            print(f"HATA: {OUT} migration'larla uyuşmuyor; python {Path(__file__).name} ile yeniden üretin")
            return 1
        return 0
    OUT.write_text(data, encoding="utf-8")
    print(f"yazıldı: {OUT} ({len(build()['tables'])} tablo)")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
