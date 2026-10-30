#!/usr/bin/env python3
"""schemas/*.schema.json → schemas/gemini/<ad>.json (Gemini responseSchema düzleştirmesi).

``bun run gen`` çağırır; çıktı commit edilir ve CI ``git diff --exit-code
packages/contracts/schemas/gemini`` ile tazeliği denetler. Dönüşüm
``python/ogrenmen_contracts/gemini.py`` içindedir (TS ``toGeminiSchema`` eşleniği); bu betik
paketi kurmadan dosya yolundan yükler. Ortak tanım şeması (common) atlanır.

Kullanım: ``python3 scripts/flatten.py [--out DİZİN]`` (varsayılan ``schemas/gemini``; testler
commit edilen dosyalara dokunmadan geçici bir dizine üretir).
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCHEMA_DIR = ROOT / "schemas"
OUT_DIR = SCHEMA_DIR / "gemini"


def _load_gemini_module():
    path = ROOT / "python" / "ogrenmen_contracts" / "gemini.py"
    spec = importlib.util.spec_from_file_location("_ogrenmen_gemini", path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="schemas/*.schema.json → Gemini responseSchema")
    parser.add_argument("--out", type=Path, default=OUT_DIR, help="çıktı dizini (varsayılan schemas/gemini)")
    out_dir: Path = parser.parse_args(argv).out.resolve()
    gemini = _load_gemini_module()
    files = sorted(SCHEMA_DIR.glob("*.schema.json"))
    docs = {f.name[: -len(".schema.json")]: json.loads(f.read_text(encoding="utf-8")) for f in files}
    out_dir.mkdir(parents=True, exist_ok=True)
    expected = set()
    for name, doc in docs.items():
        if "type" not in doc:
            continue
        flat = gemini.flatten(doc, list(docs.values()))
        target = out_dir / f"{name}.json"
        target.write_text(json.dumps(flat, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        expected.add(target.name)
    for stale in out_dir.glob("*.json"):
        if stale.name not in expected:
            stale.unlink()
    shown = out_dir.relative_to(ROOT) if out_dir.is_relative_to(ROOT) else out_dir
    print(f"flatten: {len(expected)} şema → {shown}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
