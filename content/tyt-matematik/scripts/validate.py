#!/usr/bin/env python3
"""TYT Matematik içeriğini doğrular (BLUEPRINT §2.7, §10).

Denetimler: şemalar (curriculum, misconception-tags, diagnostic-test, diagnostic-keys); aynı ``code`` için tam
bir ``active`` sürüm; kazanım ağacı ve ön koşul grafı (Kahn, döngüsüz); 27 etiket, ``genel.*`` dışında
``skill_id`` dolu, ``prereq_skill_id`` gerçekten ön koşul, metin kuralları (sen dili, ünlemsiz, ``-yor``);
20 teşhis maddesi, şık kuralı (§10.3), her yaprak ≥ 1 madde ya da ``diagnostic_exempt``; anahtar dosyasında
her madde için tek doğru şık ve ``canonical_expr``'in SymPy ile doğru şıkkı vermesi; şekil PNG'leri
(200–1600 px) ve kaynak ``.py``'leri; şablonlar; ``settings.default_period`` (seed varsa); sürüm farkı raporu
(``versions/<sürüm>.json``; kaldırılan kazanım uyarıdır).

Çıkış: 0 geçerli, 1 hata.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import _contentlib as lib  # noqa: E402


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="TYT Matematik içerik doğrulaması")
    ap.add_argument("--content", type=Path, default=lib.CONTENT_DIR, help="içerik dizini")
    ap.add_argument("--previous", type=Path, default=None,
                    help="karşılaştırılacak önceki sürüm: versions/<sürüm>.json ya da skills.json")
    ap.add_argument("--write-snapshot", action="store_true",
                    help="geçerliyse versions/<sürüm>.json kazanım kimliği anlık görüntüsünü yazar")
    ap.add_argument("--no-templates", action="store_true", help="şablon denetimini atla")
    ap.add_argument("--quiet", action="store_true", help="yalnız uyarı ve hataları yaz")
    args = ap.parse_args(argv)
    try:
        content = lib.load_content(args.content)
        report = lib.validate_content(content, previous=args.previous, with_templates=not args.no_templates)
    except lib.ContentError as exc:
        print(f"HATA: {exc}", file=sys.stderr)
        return 1
    if args.quiet:
        report.infos.clear()
    text = report.render()
    if text:
        print(text)
    if not report.ok:
        print(f"validate: {len(report.errors)} hata", file=sys.stderr)
        return 1
    if args.write_snapshot:
        print(f"anlık görüntü yazıldı: {lib.write_snapshot(content)}")
    print(f"validate: {content.code} geçerli ({len(report.warnings)} uyarı)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
