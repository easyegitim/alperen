"""``python -m ogrenmen_tablet`` — Tablet pilot dilimi: sıfır LLM ``template`` komutu (BLUEPRINT §6.1).

Kullanım::

    python -m ogrenmen_tablet template --id kesir-modeli-toplama --count 5 --seed 7 --out /tmp/tablet-out
    python -m ogrenmen_tablet template --id islem-onceligi --count 10 --auto-approve --dry-run --out /tmp/t
    python -m ogrenmen_tablet template --fill --min-stock 30 --dry-run --fixtures fixtures/tablet --out /tmp/t

Kipler:

* **Yalnız üretim** (``--auto-approve``/``--fill`` yok): veritabanına dokunmaz. ``out/questions.jsonl``
  (şemaya karşı doğrulanmış, anahtarsız ``QuestionItem`` satırları), ``out/figures/<code_hash>.png``,
  ``out/cost_estimate.json`` (sıfır çağrı); ``--dump-keys`` ile ``out/keys.jsonl`` (yalnız test için).
* **Kayıt** (``--auto-approve`` ya da ``--fill``): ``ogrenmen_common`` DB adaptörü — dry-run'da (``--dry-run`` ya da
  ``SUPABASE_URL``/``SUPABASE_BATCH_JWT`` yokken) ``JsonlDb`` (fixtures; ``out/questions.jsonl``, ``figures.jsonl``,
  ``rpc_calls.jsonl`` JsonlDb'nin yazdıklarıdır), aksi hâlde ``PostgrestDb`` + ``SupabaseStorage`` (``batch_worker``
  JWT). Yazım yalnız ``register_template_question`` RPC'sidir. ``--fill`` özeti ``out/template_fill.json``,
  ``--auto-approve`` özeti ``out/template_auto_approve.json``.

LLM adaptörü bu komutta hiç kurulmaz (gerçek kipte model anahtarı istenmez); dry-run'da ``Runtime``'ın sahte
LLM'i vardır ama çağrılmaz — ``cost_estimate.json`` sıfır deneme yazar.

Zaman damgası (``generated_at``): dry-run'da ``Runtime``'ın sabit saati (``OGRENMEN_NOW`` ya da fixture 'şimdi'si),
yalnız üretimde ``--dry-run``/``OGRENMEN_NOW`` varsa aynı sabit saat; gerçek kipte sistem saati. Aynı girdi → bayt
bayt aynı özet dosyaları.
"""

from __future__ import annotations

import argparse
import os
import sys
from collections.abc import Iterator, Mapping, Sequence
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from ogrenmen_common import cli_base
from ogrenmen_common.clock import Clock, fake_clock_from_env, iso, system_clock
from ogrenmen_common.errors import OgrError
from ogrenmen_common.runtime import Runtime

from . import fill as F
from . import templates as T

PROG = "ogrenmen_tablet"
DEFAULT_COUNT = 50
DEFAULT_MIN_STOCK = 30


def build_parser() -> argparse.ArgumentParser:
    parser = cli_base.build_parser(PROG, "Öğrenmen Tablet: parametrik şablon soruları (sıfır LLM)")
    sub = parser.add_subparsers(dest="command", required=True, metavar="komut")
    tpl = cli_base.add_command(sub, "template", "Şablondan varyant üret; --auto-approve / --fill ile RPC'den kaydet")
    tpl.add_argument("--id", dest="template_id", default=None, help="şablon kimliği (ör. kesir-modeli-toplama)")
    tpl.add_argument("--count", type=int, default=None,
                     help=f"üretilecek farklı varyant sayısı (varsayılan {DEFAULT_COUNT}; --fill ile kullanılmaz)")
    tpl.add_argument("--seed", type=int, default=7, help="rastgele tohum; aynı tohum aynı varyantları verir")
    tpl.add_argument("--auto-approve", action="store_true",
                     help="varyantları register_template_question ile onaylı kaydet")
    tpl.add_argument("--fill", action="store_true",
                     help="her enabled şablonun onaylı stokunu --min-stock'a tamamla")
    tpl.add_argument("--min-stock", type=int, default=None,
                     help=f"--fill hedef onaylı stok (varsayılan {DEFAULT_MIN_STOCK}; yalnız --fill ile)")
    tpl.add_argument("--dump-keys", action="store_true",
                     help="yalnız test: cevap anahtarlarını out/keys.jsonl'e yaz (gerçek veritabanıyla kullanılamaz)")
    return parser


def zero_cost_estimate(dry_run: bool | None, clock: Clock = system_clock) -> dict[str, Any]:
    """``CostLedger.estimate()`` ile aynı anahtarlar; şablon yolunda model çağrısı yoktur."""
    return {"dry_run": dry_run, "currency": "USD", "generated_at": iso(clock()), "attempts": 0,
            "calls_ok": 0, "total_usd": 0.0, "chat_batch_usd": 0.0, "lesson_usd": 0.0, "tokens_in": 0,
            "tokens_out": 0, "cf_ai_neurons": 0.0, "by_purpose": {}, "by_model": {}, "by_status": {},
            "note": "şablon yolu: LLM çağrısı yok"}


@dataclass
class Backend:
    db: Any
    storage: Any
    dry_run: bool
    runtime: Runtime | None = None

    @property
    def clock(self) -> Clock:
        """Dry-run'da ``Runtime``'ın sabit saati (JsonlDb/audit ile aynı an), gerçek kipte sistem saati."""
        return self.runtime.clock if self.runtime is not None else system_clock


@contextmanager
def open_backend(args: argparse.Namespace, env: Mapping[str, str] | None = None,
                 transport: Any = None) -> Iterator[Backend]:
    """Dry-run'da ``Runtime`` (JsonlDb + yerel depo); aksi hâlde ``PostgrestDb`` + ``SupabaseStorage``.

    Gerçek kipte LLM adaptörü kurulmaz: şablon komutu model anahtarı istemez (``Runtime._real`` gerçek veritabanıyla
    model anahtarı zorunlu tutar; bu komut model çağırmadığı için o kural burada gerekmez).
    """
    env = os.environ if env is None else env
    common = cli_base.common_args(args)
    dry, message = cli_base.effective_dry_run(common, env)
    if message:
        cli_base.warn(message, env)
    if dry:
        rt = Runtime.from_env(dry_run=True, fixtures=common.fixtures, out=common.out, adapters="fake", env=env)
        try:
            yield Backend(db=rt.db, storage=rt.storage, dry_run=True, runtime=rt)
        finally:
            rt.close()
        return
    from ogrenmen_common.adapters.postgrest import PostgrestDb
    from ogrenmen_common.adapters.storage import SupabaseStorage

    url, jwt, anon = env["SUPABASE_URL"], env["SUPABASE_BATCH_JWT"], env.get("SUPABASE_ANON_KEY")
    backend = Backend(db=PostgrestDb(url, jwt, anon_key=anon, transport=transport),
                      storage=SupabaseStorage(url, jwt, anon_key=anon, transport=transport), dry_run=False)
    try:
        yield backend
    finally:
        cli_base.write_json(common.out, "cost_estimate.json", zero_cost_estimate(False, backend.clock))


def _render_all(variants: list[T.Variant], figures_dir: Path) -> None:
    for v in variants:
        v.render(figures_dir)


def _write_items(out: Path, variants: list[T.Variant], ids: Mapping[str, str] | None = None) -> Path:
    rows = []
    for v in variants:
        item = dict(v.item)
        if ids is not None:
            item = {"id": ids[v.content_hash], **item}
        T.check_no_key_fields(item)
        rows.append(item)
    return cli_base.write_jsonl(out, "questions.jsonl", rows)


def _write_registered(out: Path, sink: list[tuple[str, T.Variant]]) -> Path:
    """Gerçek kipte kaydedilen maddeler ``out/questions.jsonl``'e (``id`` ile, anahtarsız)."""
    return _write_items(out, [v for _q, v in sink], {v.content_hash: q for q, v in sink})


def generate_only_clock(args: argparse.Namespace, env: Mapping[str, str] | None) -> Clock:
    """Yalnız üretim kipinin saati: ``--dry-run`` ya da ``OGRENMEN_NOW`` varsa sabit saat, yoksa sistem saati."""
    env = os.environ if env is None else env
    if getattr(args, "dry_run", False) or env.get("OGRENMEN_NOW"):
        return fake_clock_from_env(dict(env))
    return system_clock


def cmd_generate_only(args: argparse.Namespace, out: Path, env: Mapping[str, str] | None = None) -> int:
    variants = T.generate_variants(args.template_id, args.count, args.seed)
    _render_all(variants, out / "figures")
    _write_items(out, variants)
    if args.dump_keys:
        cli_base.write_jsonl(out, "keys.jsonl", [v.key_record() for v in variants])
    cli_base.write_json(out, "cost_estimate.json", zero_cost_estimate(None, generate_only_clock(args, env)))
    figs = sum(1 for v in variants if v.figure is not None)
    print(f"{args.template_id}: {len(variants)} varyant (tohum {args.seed}), {figs} şekil. LLM çağrısı yok. "
          f"Çıktı: {out}")
    return 0


def cmd_auto_approve(args: argparse.Namespace, out: Path, env: Mapping[str, str] | None, transport: Any) -> int:
    variants = T.generate_variants(args.template_id, args.count, args.seed)
    with open_backend(args, env, transport) as be:
        if args.dump_keys and not be.dry_run:
            raise T.TemplateError("OGR-TPL-006 --dump-keys yalnız dry-run içindir (anahtar dosyaya yazılmaz)")
        sink: list[tuple[str, T.Variant]] = []
        results: list[F.TemplateResult] = []
        try:
            _render_all(variants, out / "figures")
            results.append(F.auto_approve(be.db, be.storage, variants, figures_dir=out / "figures", sink=sink))
            if args.dump_keys:
                cli_base.write_jsonl(out, "keys.jsonl", [v.key_record() for v in variants])
        finally:  # yarım kalan çalışma da özet bırakır
            if not be.dry_run:
                _write_registered(out, sink)
            summary = F.summarize(results, mode="auto_approve", dry_run=be.dry_run, seed=args.seed,
                                  count=args.count, generated_at=iso(be.clock()))
            cli_base.write_json(out, "template_auto_approve.json", summary)
    result = results[0]
    print(f"{args.template_id}: {result.registered}/{len(variants)} varyant onaylı kaydedildi, "
          f"{result.skipped_hash_collision} çakışma atlandı ({F.RPC_NAME}; LLM çağrısı yok).")
    if result.error:
        print(f"HATA: {result.error}", file=sys.stderr)
        return 1
    return 0


def cmd_fill(args: argparse.Namespace, out: Path, env: Mapping[str, str] | None, transport: Any) -> int:
    with open_backend(args, env, transport) as be:
        if args.dump_keys:
            raise T.TemplateError("OGR-TPL-006 --dump-keys --fill ile kullanılmaz (anahtar dosyaya yazılmaz)")
        sink: list[tuple[str, T.Variant]] = []
        results: list[F.TemplateResult] = []
        aborted: str | None = None
        try:
            for result in F.iter_fill(be.db, be.storage, min_stock=args.min_stock, seed=args.seed,
                                      figures_dir=out / "figures", only=args.template_id, sink=sink):
                results.append(result)
        except OgrError as exc:  # ör. question_templates okunamadı: özet yine yazılır, hata run_main'e gider
            aborted = exc.message
            raise
        finally:  # yarım kalan çalışma da özet bırakır
            if not be.dry_run:
                _write_registered(out, sink)
            summary = F.summarize(results, mode="fill", dry_run=be.dry_run, seed=args.seed,
                                  min_stock=args.min_stock, generated_at=iso(be.clock()), aborted=aborted)
            cli_base.write_json(out, "template_fill.json", summary)
    t = summary["totals"]
    print(f"Şablon stoku: {t['templates']} şablon, {t['registered']} yeni onaylı soru, {t['full']} şablon dolu "
          f"(atlandı), {t['skipped_hash_collision']} çakışma atlandı. LLM çağrısı yok. Özet: "
          f"{out / 'template_fill.json'}")
    failed = [r for r in results if r.status == "error"]
    for r in failed:
        print(f"HATA: {r.template_id}: {r.error}", file=sys.stderr)
    for r in results:
        for w in r.warnings:
            cli_base.warn(f"{r.template_id}: {w}", env)
    return 1 if failed else 0


def main(argv: Sequence[str] | None = None, *, env: Mapping[str, str] | None = None, transport: Any = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    if args.command != "template":  # pragma: no cover - argparse yalnız kayıtlı komutları kabul eder
        parser.error(f"bilinmeyen komut: {args.command}")
    if args.out is None:
        parser.error("template --out <dizin> ister")
    if args.fill and args.auto_approve:
        parser.error("--fill ve --auto-approve birlikte kullanılmaz")
    if not args.fill and not args.template_id:
        parser.error("--id <şablon> gerekir (ya da --fill)")
    if args.fill and args.count is not None:
        parser.error("--count --fill ile kullanılmaz (--fill eksik stoku --min-stock'a tamamlar)")
    if not args.fill and args.min_stock is not None:
        parser.error("--min-stock yalnız --fill ile kullanılır")
    args.count = DEFAULT_COUNT if args.count is None else args.count
    args.min_stock = DEFAULT_MIN_STOCK if args.min_stock is None else args.min_stock
    if args.count < 1:
        parser.error("--count en az 1")
    if args.min_stock < 1:
        parser.error("--min-stock en az 1")
    out: Path = args.out
    out.mkdir(parents=True, exist_ok=True)
    if args.fill:
        return cmd_fill(args, out, env, transport)
    if args.auto_approve:
        return cmd_auto_approve(args, out, env, transport)
    return cmd_generate_only(args, out, env)


def entrypoint() -> None:
    sys.exit(cli_base.run_main(main))
