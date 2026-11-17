#!/usr/bin/env python3
"""Kopya sapma denetimi: tek kaynaklı SQL blokları migration'lara birebir kopyalanmış mı.

Kaynak: BLUEPRINT §2.2, §2.3, §11 M13.

* BKT: ``packages/mastery-math/sql/bkt.sql`` ↔ ``supabase/migrations/0011_mastery.sql`` içinde ``-- begin bkt`` …
  ``-- end bkt`` arası (blueprint'in ``diff bkt.sql <(sed -n '/-- begin bkt/,/-- end bkt/p' … | sed '1d;$d')``
  komutunun eşdeğeri).
* PII: ``packages/pii/sql/name_token_hashes.sql`` ↔ migration'daki ``-- begin pii`` … ``-- end pii`` arası
  (kaynak dosya işaretleri kendisi taşıyorsa yalnız işaretli blok karşılaştırılır).

İşaret satırı tam satırdır (``-- begin bkt`` ve başka bir şey yok); işaretli blok migration kümesinde tam bir kez
bulunmalı ve beklenen dosyada olmalıdır. Fark varsa birleşik diff yazılır ve çıkış 1'dir.

Kullanım: ``python scripts/check-drift.py [--root <depo>]``
"""

from __future__ import annotations

import argparse
import difflib
import re
import sys
from dataclasses import dataclass
from pathlib import Path

ROOT_DEFAULT = Path(__file__).resolve().parent.parent


@dataclass(frozen=True)
class Pair:
    marker: str
    source: str
    migration: str


PAIRS: tuple[Pair, ...] = (
    Pair("bkt", "packages/mastery-math/sql/bkt.sql", "supabase/migrations/0011_mastery.sql"),
    Pair("pii", "packages/pii/sql/name_token_hashes.sql", "supabase/migrations/0003_identity.sql"),
)


class DriftError(Exception):
    pass


def marked_block(lines: list[str], marker: str, where: str) -> list[str] | None:
    """İşaretler arasındaki satırlar (işaretler hariç); işaret yoksa None, bozuksa DriftError."""
    begin = re.compile(rf"^--\s*begin {re.escape(marker)}\s*$")
    end = re.compile(rf"^--\s*end {re.escape(marker)}\s*$")
    starts = [i for i, ln in enumerate(lines) if begin.match(ln)]
    ends = [i for i, ln in enumerate(lines) if end.match(ln)]
    if not starts and not ends:
        return None
    if len(starts) != 1 or len(ends) != 1:
        raise DriftError(f"{where}: '-- begin {marker}' {len(starts)} kez, '-- end {marker}' {len(ends)} kez "
                         "(tam bir çift gerekir)")
    if ends[0] < starts[0]:
        raise DriftError(f"{where}: '-- end {marker}' işareti '-- begin {marker}'den önce")
    return lines[starts[0] + 1 : ends[0]]


def check_pair(root: Path, pair: Pair) -> tuple[bool, str]:
    src = root / pair.source
    if not src.exists():
        return False, f"FAIL {pair.marker}: kaynak yok: {pair.source}"
    mig_dir = (root / pair.migration).parent
    found: list[tuple[Path, list[str]]] = []
    for path in sorted(mig_dir.glob("*.sql")):
        block = marked_block(path.read_text(encoding="utf-8").splitlines(), pair.marker, str(path.relative_to(root)))
        if block is not None:
            found.append((path, block))
    if not found:
        return False, f"FAIL {pair.marker}: migration'larda '-- begin {pair.marker}' … '-- end {pair.marker}' bloğu yok"
    if len(found) > 1:
        names = ", ".join(p.name for p, _ in found)
        return False, f"FAIL {pair.marker}: işaretli blok birden çok migration'da: {names}"
    path, block = found[0]
    rel = str(path.relative_to(root))
    if rel != pair.migration:
        return False, f"FAIL {pair.marker}: blok {rel} içinde, beklenen {pair.migration}"
    src_lines = src.read_text(encoding="utf-8").splitlines()
    src_block = marked_block(src_lines, pair.marker, pair.source)
    expected = src_lines if src_block is None else src_block
    if expected == block:
        return True, f"PASS {pair.marker}: {pair.source} ↔ {rel} ({len(block)} satır birebir)"
    diff = "\n".join(difflib.unified_diff(expected, block, fromfile=pair.source, tofile=f"{rel} [{pair.marker}]",
                                          lineterm=""))
    return False, f"FAIL {pair.marker}: {pair.source} ↔ {rel} farklı\n{diff}"


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="BKT ve PII SQL kopyalarının migration'larla birebirliği.")
    ap.add_argument("--root", type=Path, default=ROOT_DEFAULT)
    args = ap.parse_args(argv)
    root = args.root.resolve()
    ok = True
    for pair in PAIRS:
        try:
            passed, msg = check_pair(root, pair)
        except DriftError as exc:
            passed, msg = False, f"FAIL {pair.marker}: {exc}"
        ok = ok and passed
        print(msg)
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
