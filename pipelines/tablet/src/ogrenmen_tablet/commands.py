"""``template`` dışındaki komutların gövdeleri (BLUEPRINT §6.1): ``generate``, ``render``, ``vision``, ``verify``,
``pdf``, ``review-queue``, ``notes ingest``.

Çalışma ortamı: ``--dry-run`` (ya da ``SUPABASE_URL``/``SUPABASE_BATCH_JWT`` yokken; uyarıyla) tamamen sahte
``Runtime`` (``JsonlDb`` + yerel depo + ``FakeLLM``; çıkışta ``out/<tablo>.jsonl`` ve ``cost_estimate.json``).
Gerçek kipte model çağıran komutlar (``generate``, ``vision``, ``notes ingest``) tam ``Runtime`` kurar (model
anahtarı zorunlu); model çağırmayanlar (``render``, ``verify``, ``pdf``, ``review-queue``) yalnız ``PostgrestDb`` +
``SupabaseStorage`` + bildirim adaptörüyle çalışır ve model anahtarı istemez.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from collections.abc import Iterator, Mapping
from contextlib import contextmanager
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

from ogrenmen_common import cli_base
from ogrenmen_common.clock import Clock, system_clock
from ogrenmen_common.errors import OgrError
from ogrenmen_common.runtime import Runtime

from . import figures as FG
from . import generate as G
from . import library as L
from . import pdf as PDF
from . import review as R
from . import sandbox as S
from . import shared
from . import verify as V


@dataclass
class LiteRuntime:
    """Model çağırmayan komutların gerçek kip ortamı (LLM adaptörü kurulmaz, anahtar istenmez)."""

    db: Any
    storage: Any
    notifier: Any
    out: Path | None
    clock: Clock = system_clock
    dry_run: bool = False
    warnings: list[str] = field(default_factory=list)

    def close(self) -> list[Path]:
        if self.out is None:
            return []
        from .cli import zero_cost_estimate

        return [cli_base.write_json(self.out, "cost_estimate.json", zero_cost_estimate(False, self.clock))]


@contextmanager
def open_env(args: argparse.Namespace, env: Mapping[str, str] | None, *, needs_llm: bool, out: Path | None,
             transport: Any = None, llm_options: Mapping[str, Any] | None = None) -> Iterator[Any]:
    env = os.environ if env is None else env
    common = cli_base.common_args(args)
    dry, message = cli_base.effective_dry_run(common, env)
    if message:
        cli_base.warn(message, env)
    if out is not None:
        out.mkdir(parents=True, exist_ok=True)
    if dry or needs_llm:
        rt = Runtime.from_env(dry_run=dry, fixtures=common.fixtures, out=out,
                              adapters="fake" if dry else common.adapters, env=env, llm_options=llm_options)
        try:
            yield rt
        finally:
            rt.close()
        return
    from ogrenmen_common.adapters.postgrest import PostgrestDb
    from ogrenmen_common.adapters.storage import SupabaseStorage
    from ogrenmen_common.fakes import FakeNotifier

    url, jwt, anon = env["SUPABASE_URL"], env["SUPABASE_BATCH_JWT"], env.get("SUPABASE_ANON_KEY")
    if env.get("TELEGRAM_OPS_BOT_TOKEN") and env.get("ADMIN_CHAT_ID"):
        from ogrenmen_common.adapters.telegram_notify import TelegramNotifier

        notifier: Any = TelegramNotifier(env["TELEGRAM_OPS_BOT_TOKEN"], env["ADMIN_CHAT_ID"], transport=transport)
    else:
        notifier = FakeNotifier()
    lite = LiteRuntime(db=PostgrestDb(url, jwt, anon_key=anon, transport=transport),
                       storage=SupabaseStorage(url, jwt, anon_key=anon, transport=transport), notifier=notifier,
                       out=out)
    try:
        yield lite
    finally:
        lite.close()


def _require_out(parser: argparse.ArgumentParser, args: argparse.Namespace) -> Path:
    if args.out is None:
        parser.error(f"{args.command} --out <dizin> ister")
    return Path(args.out)


def _is_dry(args: argparse.Namespace, env: Mapping[str, str] | None) -> bool:
    return cli_base.effective_dry_run(cli_base.common_args(args), os.environ if env is None else env)[0]


# --- generate --------------------------------------------------------------------------------------


def cmd_generate(parser, args, env, transport, llm_options) -> int:
    out = _require_out(parser, args)
    if args.count is not None and args.count < 1:
        parser.error("--count en az 1")
    if args.dump_keys and not _is_dry(args, env):
        raise G.GenerateError("OGR-GEN-003 --dump-keys yalnız dry-run içindir (anahtar dosyaya yazılmaz)")
    opts = G.Options(skill=args.skill, count=args.count, band=args.band, batch=args.batch, dump_keys=args.dump_keys)
    with open_env(args, env, needs_llm=True, out=out, transport=transport, llm_options=llm_options) as rt:
        report, keys = G.strip_keys(G.run(rt, opts))
        report["dry_run"] = bool(getattr(rt, "dry_run", False) or getattr(rt, "is_fake", False))
        cli_base.write_json(out, "generate_report.json", report)
        if keys is not None:
            cli_base.write_jsonl(out, "keys.jsonl", keys)
        if not getattr(rt, "is_fake", False):
            cli_base.write_jsonl(out, "questions.jsonl", G.stored_questions(rt, report))
    t = report["totals"]
    by = ", ".join(f"{k} {v}" for k, v in t["by_status"].items()) or "hedef yok"
    print(f"Soru üretimi ({report['mode']}): {t['targets']} hedef, {t['questions']} soru yazıldı ({by}); "
          f"maliyet {t['cost_usd']:.6f} $. Özet: {out / 'generate_report.json'}")
    for w in report["warnings"]:
        cli_base.warn(w, env)
    return 1 if G.has_errors(report) else 0


# --- render / vision -------------------------------------------------------------------------------


def _figure_source_dir(fixtures: Path) -> Path:
    sub = fixtures / "figures"
    return sub if sub.is_dir() else fixtures


def cmd_render(parser, args, env, transport, llm_options) -> int:
    out = _require_out(parser, args)
    if args.queue:
        with open_env(args, env, needs_llm=False, out=out, transport=transport) as rt:
            results = FG.render_queue(rt, limit=args.limit)
            summary = FG.queue_summary(results)
            cli_base.write_json(out, "render_queue.json", summary)
        print(f"Render kuyruğu: {summary['total']} şekil ({summary['by_status']}).")
        return 1 if summary["by_status"].get("error") else 0
    if args.fixtures is None:
        parser.error("render --queue ya da render --fixtures <dizin> gerekir")
    report = FG.render_fixtures(_figure_source_dir(Path(args.fixtures)), out)
    cli_base.write_json(out, "render_report.json", {"engine_net_namespace": bool(S.netns_prefix()),
                                                   "files": report})
    from .cli import zero_cost_estimate

    cli_base.write_json(out, "cost_estimate.json", zero_cost_estimate(True))
    print("Render (fixtures): " + ", ".join(f"{r['file']}={r['status']}" for r in report))
    return 0


def cmd_vision(parser, args, env, transport, llm_options) -> int:
    out = _require_out(parser, args)
    if not args.queue:
        parser.error("vision --queue gerekir")
    with open_env(args, env, needs_llm=True, out=out, transport=transport, llm_options=llm_options) as rt:
        ctx_code = _curriculum_code(rt)
        results = FG.vision_queue(rt, curriculum_code=ctx_code, limit=args.limit)
        summary = FG.queue_summary(results)
        cli_base.write_json(out, "vision_queue.json", summary)
    print(f"Vision kuyruğu: {summary['total']} şekil ({summary['by_status']}).")
    return 1 if summary["by_status"].get("error") else 0


def _curriculum_code(rt: Any) -> str:
    try:
        return shared.curriculum_label(shared.active_curriculum(rt.db))
    except shared.CurriculumError as exc:
        raise G.GenerateError(exc.message) from exc


# --- verify ----------------------------------------------------------------------------------------


def verify_envelope_file(path: Path) -> dict[str, Any]:
    try:
        envelope = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise OgrError(f"OGR-VER-001 zarf okunamadı: {exc}") from exc
    report: dict[str, Any] = {"source": str(path), "mode": "envelope"}
    try:
        check = V.check_envelope(envelope)
    except V.VerifyError as exc:
        report.update(status="failed", rule=exc.code, detail=exc.message)
        return report
    report.update(status=check.sympy.status if check.sympy.status != "verified" else "verified",
                  content_hash=check.content_hash, sympy=check.sympy.report())
    figure = check.item.get("figure")
    if figure:
        render = S.render(str(figure["tool"]), str(figure["code"]), expected_px=figure.get("expected_px"))
        report["render"] = render.report()
        if not render.ok and report["status"] == "verified":
            report["status"] = "failed"
    return report


def verify_question(rt: Any, qid: str, key_path: Path | None) -> dict[str, Any]:
    rows = rt.db.select("questions", where={"id": qid})
    if not rows:
        raise OgrError(f"OGR-VER-002 soru yok: {qid}")
    q = dict(rows[0])
    report: dict[str, Any] = {"question_id": qid, "mode": "question", "status": "verified",
                              "question_status": q.get("status"), "source": q.get("source")}
    item = {"kind": q["kind"], "stem": q["stem"], "stem_values": q.get("stem_values") or {},
            "options": q.get("options")}
    problems: list[str] = []
    if q["kind"] == "mcq":
        try:
            from . import templates as T

            T.check_option_rule(item)
        except OgrError as exc:
            problems.append(exc.message)
    if key_path is not None:
        key = json.loads(Path(key_path).read_text(encoding="utf-8"))
        check = V.verify_key(item, key)
        report["sympy"] = {"status": check.status, **check.report()}
        if check.status == "failed":
            problems.append(f"SymPy: {check.note}")
    else:
        report["sympy"] = {"status": (q.get("verification") or {}).get("sympy"),
                           "note": "anahtar secure şemasında; batch_worker okuyamaz (--key ile eğitmen dosyası)"}
    if q.get("figure_id"):
        figs = rt.db.select("figures", where={"id": q["figure_id"]})
        if figs:
            fig = dict(figs[0])
            report["figure"] = {"render_status": fig.get("render_status"), "vision_status": fig.get("vision_status"),
                                "review_status": fig.get("review_status"), "attempts": fig.get("attempts")}
            name = FG.storage_name(fig.get("png_path"))
            if name:
                try:
                    png = rt.storage.download(FG.FIGURE_BUCKET, name)
                    chk = S.check_png(png)
                    report["figure"]["png_check"] = {"status": chk.status, "reason": chk.reason,
                                                     "width_px": chk.width_px, "height_px": chk.height_px,
                                                     "bytes": chk.bytes}
                    if not chk.ok:
                        problems.append(f"şekil: {chk.reason}")
                except Exception as exc:  # noqa: BLE001
                    problems.append(f"şekil PNG'si indirilemedi: {exc}")
            elif fig.get("render_status") != "rendered":
                problems.append(f"şekil render edilmemiş ({fig.get('render_status')})")
    if problems:
        report["status"] = "failed"
    report["problems"] = problems
    return report


def cmd_verify(parser, args, env, transport, llm_options) -> int:
    out = _require_out(parser, args)
    path = Path(args.question)
    if path.suffix.lower() == ".json" or path.is_file():
        report = verify_envelope_file(path)
        cli_base.write_json(out, "verify_report.json", report)
    else:
        with open_env(args, env, needs_llm=False, out=out, transport=transport) as rt:
            report = verify_question(rt, args.question, args.key)
            cli_base.write_json(out, "verify_report.json", report)
    print(f"Doğrulama: {report['status']} ({out / 'verify_report.json'})")
    return 0 if report["status"] in ("verified", "not_applicable") else 1


# --- pdf / review-queue / notes --------------------------------------------------------------------


def cmd_pdf(parser, args, env, transport, llm_options) -> int:
    target = _require_out(parser, args)
    with open_env(args, env, needs_llm=False, out=None, transport=transport) as rt:
        result = PDF.build(rt, test=args.test, out=target, with_keys=args.with_keys, require_pdf=args.require_pdf,
                           env=os.environ if env is None else env, transport=transport)
    for w in result.warnings:
        cli_base.warn(w, env)
    print(f"PDF: {result.questions} soru; .tex {result.tex}; "
          + (f"PDF {result.pdf}" if result.compiled else result.note))
    return 0


def cmd_review_queue(parser, args, env, transport, llm_options) -> int:
    out = _require_out(parser, args)
    with open_env(args, env, needs_llm=False, out=out, transport=transport) as rt:
        summary = R.collect(rt)
        if args.push:
            summary["pushed_text"] = R.push(rt, summary)
        cli_base.write_json(out, "review_queue.json", summary)
    print(R.message(summary))
    return 0


def cmd_notes(parser, args, env, transport, llm_options) -> int:
    out = _require_out(parser, args)
    with open_env(args, env, needs_llm=True, out=out, transport=transport, llm_options=llm_options) as rt:
        result = L.ingest(rt, args.pdf, curriculum=args.curriculum, title=args.title)
        cli_base.write_json(out, "notes_ingest.json", asdict(result))
    print(f"Ders notu: {result.title} ({result.curriculum}) — {result.status}, {result.pages} sayfa, "
          f"{result.chunks} parça.")
    return 0


HANDLERS = {"generate": cmd_generate, "render": cmd_render, "vision": cmd_vision, "verify": cmd_verify,
            "pdf": cmd_pdf, "review-queue": cmd_review_queue, "notes": cmd_notes}


def dispatch(parser: argparse.ArgumentParser, args: argparse.Namespace, *, env: Mapping[str, str] | None,
             transport: Any, llm_options: Mapping[str, Any] | None) -> int:
    handler = HANDLERS.get(args.command)
    if handler is None:  # pragma: no cover - argparse yalnız kayıtlı komutları kabul eder
        parser.error(f"bilinmeyen komut: {args.command}")
    try:
        return handler(parser, args, env, transport, llm_options)
    except BrokenPipeError:  # pragma: no cover
        sys.stderr.close()
        return 1
