"""``python -m ogrenmen_ders`` — ders medya servisi komutları.

Komutlar::

    serve [--host 127.0.0.1] [--port 8711]          HTTP servisi (service.py; apps/worker lesson.* işleri çağırır)
    frames-only --video <yol> --out <dizin>         yalnız ses + sahne kareleri (<out>/frames/, <out>/prepare.json)
    stt --wav <yol> [--fixture ad.json]             yalnız transkript (Groq ya da OGRENMEN_STT=fake) → stdout JSON

Hata tek satır Türkçe stderr'e yazılır ve çıkış 1 olur.
"""

from __future__ import annotations

import argparse
import json
import shutil
import sys
import uuid
from collections.abc import Sequence
from pathlib import Path

from . import service as S


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="ogrenmen_ders", description="Öğrenmen ders medya servisi")
    sub = parser.add_subparsers(dest="command", required=True, metavar="komut")
    p = sub.add_parser("serve", help="HTTP servisi")
    p.add_argument("--host", default="127.0.0.1")
    p.add_argument("--port", type=int, default=S.DEFAULT_PORT)
    p = sub.add_parser("frames-only", help="ses + sahne kareleri (yerel)")
    p.add_argument("--video", type=Path, required=True)
    p.add_argument("--out", type=Path, required=True)
    p = sub.add_parser("stt", help="yalnız transkript")
    p.add_argument("--wav", type=Path, required=True)
    p.add_argument("--fixture", default=None, help="OGRENMEN_STT=fake iken fixtures/ders altındaki dosya adı")
    p.add_argument("--language", default="tr")
    return parser


def _local_job(src: Path) -> tuple[str, str]:
    """Kaynağı servis çalışma köküne kopyalar: (ders kimliği, köke göreli yol)."""
    if not src.is_file():
        raise S.ServiceError(404, "OGR-DERS-001", f"dosya yok: {src.name}")
    lesson_id = str(uuid.uuid4())
    target = S.work_root() / lesson_id / f"source{src.suffix.lower() or '.bin'}"
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(src, target)
    return lesson_id, target.relative_to(S.work_root()).as_posix()


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if args.command == "serve":
        return S.main(["--host", args.host, "--port", str(args.port)])
    lesson_id, rel = _local_job(args.video if args.command == "frames-only" else args.wav)
    try:
        if args.command == "frames-only":
            res = S.handle_prepare({"lesson_id": lesson_id, "local_path": rel})
            out = Path(args.out)
            (out / "frames").mkdir(parents=True, exist_ok=True)
            for fr in res["frames"]:
                shutil.copyfile(S.work_root() / fr["path"], out / "frames" / Path(fr["path"]).name)
            shutil.copyfile(S.work_root() / res["audio"]["path"], out / "audio.wav")
            (out / "prepare.json").write_text(json.dumps(res, ensure_ascii=False, indent=2), encoding="utf-8")
            print(f"{len(res['frames'])} kare ({res['method']}) → {out / 'frames'}", file=sys.stderr)
        else:
            res = S.handle_stt({"lesson_id": lesson_id, "wav_path": rel, "language": args.language,
                                **({"fixture": args.fixture} if args.fixture else {})})
            print(json.dumps(res, ensure_ascii=False, indent=2))
        return 0
    finally:
        S.handle_cleanup({"lesson_id": lesson_id})


def entrypoint() -> None:
    try:
        sys.exit(main())
    except S.ServiceError as exc:
        print(f"{exc.code} {exc.message}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    entrypoint()
