"""``python -m ogrenmen_ders`` — ders videosu analizi (BLUEPRINT §6.3).

Komutlar::

    register --student-ref s_… --staff-id <uuid> --held-at 2026-10-20T18:00 --duration 90 --video <yol>
        register_lesson RPC; yeni dersin uuid'si stdout'a (tek satır) yazılır — `make ders` bunu analyze'a zincirler.
        --held-at saat dilimsizse Europe/Istanbul yerel saatidir. Video yüklenmez, yalnız video_ref kaydedilir:
        yerel dosya --video-dir (varsayılan $OGRENMEN_VIDEO_DIR) içinde olmalı, yalnız göreli yol yazılır.
    analyze --lesson <uuid> --video <yol> [--transcriber chain|whispercpp] [--force]
        ses + sahne kareleri → isimsiz transkript (transcripts/<id>.jsonl) → seed profili → lesson_analysis zinciri →
        write_lesson_analysis RPC (lesson_analyses taslak + lesson_claims bekleyen; observations YAZILMAZ).
    transcribe-only --lesson <uuid> --video <yol>     yalnız isimsiz transkript
    frames-only --video <yol> [--lesson <uuid>]       yalnız kareler (<out>/frames/, <out>/frames.json)
    purge --older-than 30d --video-dir $OGRENMEN_VIDEO_DIR [--confirm-missing]
        süresi dolan ham videoları siler, confirm_video_deleted RPC (öğrenci + veli bildirimi kuyruğa). Dizinde
        bulunmayan dosya yalnız --confirm-missing ile silinmiş sayılır.

Ortak bayraklar (``ogrenmen_common.cli_base``): ``--dry-run --fixtures --out --limit --since --student-ref
--adapters``. ``--dry-run``: ağ yok, sahte veritabanı ``--fixtures`` (ör. ``fixtures/ders``) ile kurulur, çıktı
``--out``'a (JSONL + ``api_payload.json`` + ``cost_estimate.json``).
"""

from __future__ import annotations

import json
import os
import sys
from collections.abc import Sequence
from dataclasses import asdict
from pathlib import Path

from ogrenmen_common import cli_base

from . import pipeline as P
from .errors import DersError
from .transcript import ENGINES

PROG = "ogrenmen_ders"


def build_parser():
    parser = cli_base.build_parser(PROG, "Öğrenmen ders videosu analizi")
    sub = parser.add_subparsers(dest="command", required=True, metavar="komut")

    p = cli_base.add_command(sub, "register", "Dersi kaydet (register_lesson); uuid stdout'a yazılır")
    p.add_argument("--staff-id", required=True, help="eğitmenin public.staff.id değeri (uuid)")
    p.add_argument("--held-at", required=True, help="ders zamanı (ISO; saat dilimsizse Europe/Istanbul)")
    p.add_argument("--duration", type=int, default=None, help="süre (dakika)")
    p.add_argument("--video", required=True, help="kurucu makinesindeki video yolu ya da drive:<kimlik>")
    p.add_argument("--video-dir", type=Path, default=None, help="video kök dizini (varsayılan $OGRENMEN_VIDEO_DIR)")

    for name, text in (("analyze", "Ders analizi (transkript + kareler + güçlü model)"),
                       ("transcribe-only", "Yalnız isimsiz transkript")):
        p = cli_base.add_command(sub, name, text)
        p.add_argument("--lesson", required=True, help="register çıktısındaki ders uuid'si")
        p.add_argument("--video", type=Path, required=True, help="yerel video ya da ses dosyası (Storage değil)")
        p.add_argument("--transcriber", choices=ENGINES, default="chain",
                       help="chain: models.json transcribe zinciri; whispercpp: WHISPER_CPP_BIN ile yerel")
        if name == "analyze":
            p.add_argument("--force", action="store_true",
                           help="processing/approved/corrected durumundaki dersi yeniden analiz et")

    p = cli_base.add_command(sub, "frames-only", "Yalnız sahne kareleri")
    p.add_argument("--video", type=Path, required=True, help="yerel video dosyası")
    p.add_argument("--lesson", default=None, help="verilirse lessons.frames_count güncellenir")

    p = cli_base.add_command(sub, "purge", "Süresi dolan ham videoları sil ve bildir")
    p.add_argument("--older-than", default="30d", help="ör. 30d (gün) ya da 12h (saat)")
    p.add_argument("--video-dir", type=Path, default=None, help="video kök dizini (varsayılan $OGRENMEN_VIDEO_DIR)")
    p.add_argument("--confirm-missing", action="store_true",
                   help="dizinde bulunmayan (elle silinmiş) dosyaları da silindi olarak kaydet ve bildir")
    return parser


def _video_dir(value: Path | None) -> Path | None:
    if value is not None:
        return value
    env = os.environ.get("OGRENMEN_VIDEO_DIR")
    return Path(env) if env else None


def _print_summary_stderr(data) -> None:
    """Özet stderr'e: stdout yalnız zincirlenecek tek değeri (uuid) taşır."""
    print(json.dumps(data, ensure_ascii=False, indent=2), file=sys.stderr)


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if args.command == "frames-only" and args.out is None:
        args.out = Path("out")
    with cli_base.open_runtime(args) as rt:
        if args.command == "register":
            if not args.student_ref:
                raise DersError("OGR-DERS-007 register için --student-ref s_… gerekli")
            lesson_id = P.register(rt, student_ref=args.student_ref, staff_id=args.staff_id, held_at=args.held_at,
                                   duration=args.duration, video=args.video, video_dir=_video_dir(args.video_dir))
            print(lesson_id)
            return 0
        if args.command == "analyze":
            result = P.analyze(rt, lesson_id=args.lesson, video=args.video, engine=args.transcriber,
                               fixtures=args.fixtures, out=args.out, force=args.force)
            _print_summary_stderr(result.as_dict())
            print(result.analysis_id)
            return 0
        if args.command == "transcribe-only":
            summary = P.transcribe_only(rt, lesson_id=args.lesson, video=args.video, engine=args.transcriber,
                                        out=args.out)
            _print_summary_stderr(summary)
            return 0
        if args.command == "frames-only":
            summary = P.frames_only(rt, video=args.video, out=args.out, lesson_id=args.lesson)
            print(f"{summary['count']} kare ({summary['method']}) → {Path(args.out) / 'frames'}", file=sys.stderr)
            return 0
        if args.command == "purge":
            items = P.purge(rt, older_than=P.parse_older_than(args.older_than), video_dir=_video_dir(args.video_dir),
                            delete_files=not rt.dry_run, confirm_missing=args.confirm_missing)
            report = {"dry_run": rt.dry_run, "items": [asdict(i) for i in items]}
            if args.out is not None:
                cli_base.write_json(args.out, "purge_report.json", report)
            done = sum(1 for i in items if i.confirmed)
            print(f"{len(items)} ders incelendi, {done} video silindi olarak kaydedildi"
                  + (" (dry-run: dosyalara dokunulmadı)" if rt.dry_run else ""), file=sys.stderr)
            return 0
    return 2


def entrypoint() -> None:
    sys.exit(cli_base.run_main(main))


if __name__ == "__main__":
    entrypoint()
