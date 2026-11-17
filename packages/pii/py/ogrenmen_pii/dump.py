"""`python -m ogrenmen_pii.dump` — cases.json vakalarının gerçek çıktısını JSON olarak yazar.

TS eşleniği `bun run --cwd packages/pii/ts dump`; CI iki çıktıyı `diff` ile karşılaştırır.
Çıktı beklenen değerleri değil, temizleyicinin o anki sonucunu içerir; desen dizgeleri
ve kelime listeleri de yazıldığı için iki dil arasındaki her kural sapması görünür.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from collections.abc import Callable
from typing import Any

from .cases import load_cases
from .scrub import config, name_token_hashes, scrub

_CODE = re.compile(r"OGR-[A-Z]+-[0-9]{3}")


def error_code(fn: Callable[[], object]) -> str | None:
    """Hata mesajının başındaki OGR-XXX-NNN kodu; hata yoksa None (TS `errorCode` ile aynı)."""
    try:
        fn()
    except Exception as e:  # noqa: BLE001 — her hata türü koda indirgenir
        m = _CODE.match(str(e))
        return m.group(0) if m else "NO-CODE"
    return None


def build_dump(data: dict[str, Any]) -> dict[str, Any]:
    return {
        "config": config(),
        "hash_cases": [
            {"id": hc["id"], "hashes": name_token_hashes(hc["full_name"])} for hc in data["hash_cases"]
        ],
        "cases": [
            {"id": c["id"], **scrub(c["text"], c["opts"])} for c in data["cases"]
        ],
        "error_cases": [
            {"id": ec["id"], "error": error_code(lambda ec=ec: scrub(ec["text"], ec["opts"]))}
            for ec in data["error_cases"]
        ],
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m ogrenmen_pii.dump", description="PII vaka çıktısı")
    parser.add_argument("--cases", help="cases.json yolu (varsayılan: packages/pii/cases.json)")
    args = parser.parse_args(argv)
    out = json.dumps(build_dump(load_cases(args.cases)), ensure_ascii=False, indent=2)
    sys.stdout.buffer.write((out + "\n").encode("utf-8"))
    sys.stdout.flush()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
