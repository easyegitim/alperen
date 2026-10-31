"""``python -m ogrenmen_kulaklik`` — Kulaklık toplu işleri (BLUEPRINT §6.2).

Komutlar::

    facts [--day 2026-10-18] [--batch]           gece olgu çıkarımı (önce reembed --missing; çıktısı <out>/reembed/)
    summaries [--week 2026-10-13] [--batch]      haftalık özet
    metrics [--week …] [--gate] [--ci-status J]  eğitmen alarmları + pilot_metrics (+ out/pilot_gate.md)
    review-sample [--week …]                     işaretli cevaplar + rastgele 20 → out/review-<hafta>.md
    retention [--report] [--export-md <yol>]     run_retention + cap_memory_facts + compute_table_sizes
    cost-report --month 2026-10 [--check]        out/cost-report.md (+ --check: ledger drift → çıkış 2)
    check-spend [--purpose …]                    check_spend durumu (gece işinin ilk adımı)
    reembed [--missing]                          memory_facts embedding'leri

Ortak bayraklar (``ogrenmen_common.cli_base``): ``--dry-run --fixtures --out --limit --since --student-ref
--adapters``. ``--out`` verilmezse ``./out``. ``--name-hashes <json>``: ad-token sha256 hex listesi (düz ad değil);
LLM'e giden metin bu hash'lerle bir kez daha temizlenir.
"""

from __future__ import annotations

import argparse
import dataclasses
import sys
from collections.abc import Sequence
from datetime import timedelta
from pathlib import Path
from typing import Any

from ogrenmen_common import cli_base

from . import alerts as A
from . import cost as C
from . import facts as F
from . import gate as G
from . import pilot as P
from . import retention as R
from . import review as V
from . import summaries as S
from .common import load_name_hashes, month_window, parse_day, today, tr_usd, week_window, write_text
from .fixture_llm import install as install_fixture_llm

PROG = "ogrenmen_kulaklik"
DEFAULT_SPEND_PURPOSES = ("nightly_facts", "weekly_summary", "question_gen", "embedding", "lesson_analysis")


def _day(value: str):
    try:
        return parse_day(value)
    except Exception as exc:  # noqa: BLE001 - argparse hata iletisine çevrilir
        raise argparse.ArgumentTypeError(str(exc)) from exc


def build_parser() -> argparse.ArgumentParser:
    parser = cli_base.build_parser(PROG, "Öğrenmen Kulaklık toplu işleri")
    sub = parser.add_subparsers(dest="command", required=True, metavar="komut")

    p = cli_base.add_command(sub, "facts", "Gece olgu çıkarımı (memory_facts)")
    p.add_argument("--day", type=_day, default=None, help="gün (YYYY-AA-GG; varsayılan dün, Europe/Istanbul)")
    p.add_argument("--batch", action="store_true", help="Gemini Batch ile (gece); gecikirse ertelenir")
    p.add_argument("--name-hashes", type=Path, default=None, help="ad-token sha256 hex listesi (JSON)")

    p = cli_base.add_command(sub, "summaries", "Haftalık özet (weekly_summaries)")
    p.add_argument("--week", type=_day, default=None, help="hafta başlangıcı (varsayılan bugünden 7 gün önce)")
    p.add_argument("--batch", action="store_true", help="Gemini Batch ile")
    p.add_argument("--name-hashes", type=Path, default=None, help="ad-token sha256 hex listesi (JSON)")

    p = cli_base.add_command(sub, "metrics", "Eğitmen alarmları ve pilot ölçütleri (LLM yok)")
    p.add_argument("--week", type=_day, default=None, help="hafta başlangıcı (varsayılan bugünden 7 gün önce)")
    p.add_argument("--gate", action="store_true", help="pilot kapısını değerlendir → out/pilot_gate.md")
    p.add_argument("--ci-status", default=None,
                   help='CI sonuçları: JSON dosyası ya da metni {"isolation_tests":"pass","key_leak_tests":"pass"}')

    p = cli_base.add_command(sub, "review-sample", "İşaretli cevaplar + rastgele 20 (review_week)")
    p.add_argument("--week", type=_day, default=None, help="hafta başlangıcı (varsayılan bugünden 7 gün önce)")
    p.add_argument("--name-hashes", type=Path, default=None, help="ad-token sha256 hex listesi (JSON)")

    p = cli_base.add_command(sub, "retention", "Saklama işleri ve raporu")
    p.add_argument("--report", action="store_true", help="out/retention-report.md yaz")
    p.add_argument("--export-md", type=Path, default=None, help="retention_policies → saklama-sureleri.md")

    p = cli_base.add_command(sub, "cost-report", "Aylık maliyet raporu (iki bütçe)")
    p.add_argument("--month", required=True, help="ay (YYYY-AA)")
    p.add_argument("--check", action="store_true", help="llm_calls ↔ spend_ledger denetimi; fark > %%5 → çıkış 2")

    p = cli_base.add_command(sub, "check-spend", "check_spend durumu")
    p.add_argument("--purpose", action="append", default=None, help="amaç (birden çok verilebilir)")

    p = cli_base.add_command(sub, "reembed", "memory_facts embedding'leri")
    p.add_argument("--missing", action="store_true", help="yalnız embedding'i boş aktif olgular")
    return parser


def _args(ns: argparse.Namespace, **changes: Any) -> cli_base.CommonArgs:
    ca = cli_base.common_args(ns)
    if ca.out is None:
        ca = dataclasses.replace(ca, out=Path("out"))
    return dataclasses.replace(ca, **changes) if changes else ca


def _json(out: Path, name: str, data: Any) -> Path:
    return cli_base.write_json(out, name, data)


def cmd_reembed(ns: argparse.Namespace) -> int:
    ca = _args(ns)
    with cli_base.open_runtime(ca) as rt:
        rep = F.reembed(rt, missing=ns.missing, limit=ca.limit)
        _json(ca.out, "reembed_report.json", rep)
    print(f"reembed ({rep['mode']}): {rep['embedded']}/{rep['selected']} olgu")
    return 1 if rep["error"] else 0


def cmd_facts(ns: argparse.Namespace) -> int:
    ca = _args(ns)
    hashes = load_name_hashes(ns.name_hashes)
    first = dataclasses.replace(ca, out=ca.out / "reembed")
    with cli_base.open_runtime(first) as rt0:
        rep0 = F.reembed(rt0, missing=True, limit=ca.limit)
        _json(first.out, "reembed_report.json", rep0)
        shared = rt0.db.tables if rt0.is_fake else None
        carried = list(rt0.ledger.calls)
    with cli_base.open_runtime(ca) as rt:
        if shared is not None:
            rt.db.tables = shared  # dry-run: reembed adımının yazdıkları bu adımda da görünsün (tek veritabanı)
        # out/cost_estimate.json çalışmanın tamamını (embedding adımı dahil) gösterir
        rt.ledger.calls[:0] = carried
        install_fixture_llm(rt, ca.fixtures)
        day = ns.day or (today(rt.clock()) - timedelta(days=1))
        rep = F.run_facts(rt, day, batch=ns.batch, name_hashes=hashes, student_ref=ca.student_ref, limit=ca.limit)
        data = rep.as_dict()
        data["reembed"] = {k: rep0[k] for k in ("selected", "embedded", "error")}
        data["reembed"]["cost_usd"] = round(sum(float(c.get("cost_usd") or 0) for c in carried), 6)
        _json(ca.out, "facts_report.json", data)
    print(f"facts {rep.day}: {rep.students_called} öğrenci, {rep.inserted} olgu, {rep.merged} birleşen, "
          f"{len(rep.dropped)} atılan, onaysız atlanan {len(rep.skipped_unconsented)}; Batch {rep.batch_status}")
    return 0


def cmd_summaries(ns: argparse.Namespace) -> int:
    ca = _args(ns)
    hashes = load_name_hashes(ns.name_hashes)
    with cli_base.open_runtime(ca) as rt:
        install_fixture_llm(rt, ca.fixtures)
        window = week_window(ns.week, rt.clock())
        rep = S.run_summaries(rt, window, batch=ns.batch, name_hashes=hashes, student_ref=ca.student_ref,
                              limit=ca.limit)
        _json(ca.out, "summaries_report.json", rep.as_dict())
    print(f"summaries {rep.week_start}: {rep.written} özet; {len(rep.rejected)} reddedilen, "
          f"{len(rep.skipped_existing)} zaten var")
    return 0


def cmd_metrics(ns: argparse.Namespace) -> int:
    ca = _args(ns)
    ci = G.load_ci_status(ns.ci_status)
    with cli_base.open_runtime(ca) as rt:
        now = rt.clock()
        window = week_window(ns.week, now)
        # canlıda kurallar SQL'de (cron_open_alerts); dry-run'da Python eşleniği
        alert_rep = A.open_alerts(rt.db, now, via_rpc=not rt.is_fake)
        rows = P.compute(rt.db, window)
        write_rep = P.write(rt.db, rows, now)
        _json(ca.out, "alerts.json", alert_rep.rows)
        _json(ca.out, "distractor_report.json", P.distractor_report(rt.db))
        _json(ca.out, "metrics_report.json", {"window": {"start": window.start.isoformat(),
                                                         "end": window.end.isoformat(),
                                                         "period": window.period.isoformat()},
                                              "alerts": alert_rep.as_dict(), "pilot_metrics": rows,
                                              "pilot_metrics_write": write_rep})
        result = None
        if ns.gate:
            thresholds = G.load_thresholds(rt.db)
            # az önce hesaplanan dönem (batch_worker pilot_metrics'i okuyamaz; tanım gereği son dönemdir)
            result = G.evaluate(thresholds, rows, ci)
            write_text(ca.out, "pilot_gate.md", G.render_markdown(result))
            _json(ca.out, "pilot_gate.json", result.as_dict())
    print(f"metrics {window.period}: {alert_rep.opened} yeni alarm ({alert_rep.deduplicated} zaten açık, "
          f"{len(alert_rep.rejected)} reddedilen), {len(rows)} pilot ölçütü ({write_rep['written']} yazıldı)")
    if result is not None:
        print(f"Kapı: {result.label}")
    return 0


def cmd_review(ns: argparse.Namespace) -> int:
    ca = _args(ns)
    hashes = load_name_hashes(ns.name_hashes)
    with cli_base.open_runtime(ca) as rt:
        window = week_window(ns.week, rt.clock())
        rep, md = V.run_review(rt, window, name_hashes=hashes)
        path = write_text(ca.out, f"review-{window.start.isoformat()}.md", md)
        rep.file = path.name
        _json(ca.out, "review_report.json", rep.as_dict())
    print(f"review-sample {rep.week_start}: {len(rep.flagged)} işaretli + {len(rep.sampled)} örneklem → {rep.file}")
    return 0


def cmd_retention(ns: argparse.Namespace) -> int:
    ca = _args(ns)
    with cli_base.open_runtime(ca) as rt:
        run = ns.report or ns.export_md is None
        if run:
            jobs = R.run_jobs(rt.db)
            rep = R.build_report(rt.db, jobs, rt.clock())
            _json(ca.out, "retention_report.json", rep)
            if ns.report:
                write_text(ca.out, "retention-report.md", R.render_report(rep))
            print(f"retention: {len(rep['runs'])} politika, {rep['affected_total']} satır; "
                  f"bekleyen depolama silmesi {rep['storage_deletions']['pending']}")
        if ns.export_md is not None:
            target = ns.export_md
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(R.export_markdown(rt.db), encoding="utf-8")
            print(f"saklama süreleri → {target}")
    return 0


def cmd_cost(ns: argparse.Namespace) -> int:
    ca = _args(ns)
    month = month_window(ns.month)
    code = 0
    with cli_base.open_runtime(ca) as rt:
        data = C.compute(rt.db, month, rt.models, now=rt.clock())
        check = C.run_check(rt.db, data, rt.clock()) if ns.check else None
        write_text(ca.out, "cost-report.md", C.render(data, check=check))
        if check is not None:
            data["check"] = check
            code = check["exit_code"]
        _json(ca.out, "cost-report.json", data)
    print(f"cost-report {data['month']}: sohbet ve toplu {tr_usd(data['chat']['month_usd'])}, "
          f"ders analizi {tr_usd(data['lesson']['month_usd'])}")
    if code == C.EXIT_DRIFT:
        print("ledger drift: llm_calls ile spend_ledger %5'ten fazla ayrışıyor", file=sys.stderr)
    return code


def cmd_check_spend(ns: argparse.Namespace) -> int:
    ca = _args(ns)
    purposes = list(ns.purpose or DEFAULT_SPEND_PURPOSES)
    with cli_base.open_runtime(ca) as rt:
        rep = C.check_spend(rt.db, purposes)
        _json(ca.out, "check_spend.json", rep)
    for purpose, r in rep["purposes"].items():
        print(f"{purpose}: durum {r.get('state')}, ücretli çağrı {'açık' if r.get('paid_allowed') else 'kapalı'}")
    return 0


COMMANDS = {
    "facts": cmd_facts,
    "summaries": cmd_summaries,
    "metrics": cmd_metrics,
    "review-sample": cmd_review,
    "retention": cmd_retention,
    "cost-report": cmd_cost,
    "check-spend": cmd_check_spend,
    "reembed": cmd_reembed,
}


def main(argv: Sequence[str] | None = None) -> int:
    ns = build_parser().parse_args(argv)
    return COMMANDS[ns.command](ns)


def entrypoint() -> None:
    sys.exit(cli_base.run_main(main))
