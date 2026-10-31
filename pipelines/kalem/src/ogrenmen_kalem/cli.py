"""``python -m ogrenmen_kalem`` — sınav arşivi → öncelik planı; çeldirici motoru raporları (BLUEPRINT §6.4).

Komutlar::

    ingest --pdf <yol> --course MAT101 --year 2023 --term final --legal-basis "öğrenci kendi kopyası"
           [--instructor-alias hoca-A] [--uploaded-by <staff uuid>]
    ingest --source <uuid>
    ingest --queue [--limit 10]                 gece: exam_sources.status='uploaded' (yoksa SKIP)
    embed --course <kod> [--all]                ocr_text → embedding (halfvec 768)
    cluster --course <kod> | --changed          kümeler; bitince align otomatik (izlence varsa)
    align --course <kod> [--syllabus <json>]    izlence ↔ küme hizalaması
    plan --course <kod> --period <dönem>        exam-priority-plan → exam_priority_plans (pending_review)
    variants --plan <uuid> [--top 5]            generation_requests(exam_variant) — Tablet'e yalnız meta
    distractor-report [--curriculum TYT-MAT]    etiket başına seçilme oranı, hiç seçilmeyenler
    prerequisite-audit [--curriculum TYT-MAT] [--window-days 14]

Ortak bayraklar (``ogrenmen_common.cli_base``): ``--dry-run --fixtures --out --limit --since --student-ref
--adapters``. ``--out`` verilmezse ``./out``. ``--name-hashes <json>``: ad-token sha256 listesi; modele giden
metin (OCR istemi, gömülecek madde metni) bu hash'lerle bir kez daha temizlenir.
"""

from __future__ import annotations

import argparse
import sys
from collections.abc import Sequence
from pathlib import Path

from ogrenmen_common import cli_base

from . import align as AL
from . import cluster as CL
from . import embed as EM
from . import ingest as IN
from . import plan as PL
from . import reports as RP
from . import variants as VA
from .common import course_by_code, load_name_hashes, write_json, write_text

PROG = "ogrenmen_kalem"


def build_parser() -> argparse.ArgumentParser:
    parser = cli_base.build_parser(PROG, "Öğrenmen Kalem: sınav arşivi → öncelik planı; çeldirici raporları")
    sub = parser.add_subparsers(dest="command", required=True, metavar="komut")

    p = cli_base.add_command(sub, "ingest", "Sınav PDF'i → OCR → exam_items")
    src = p.add_mutually_exclusive_group(required=True)
    src.add_argument("--pdf", type=Path, help="yerel PDF (exam_sources satırını bu komut açar)")
    src.add_argument("--source", help="exam_sources.id (uuid)")
    src.add_argument("--queue", action="store_true", help="status='uploaded' kaynaklar (gece işi)")
    p.add_argument("--course", help="ders kodu (--pdf ile zorunlu)")
    p.add_argument("--year", type=int, help="sınav yılı (--pdf ile zorunlu)")
    p.add_argument("--term", choices=IN.TERMS, help="dönem (--pdf ile zorunlu)")
    p.add_argument("--legal-basis", choices=IN.LEGAL_BASES, help="hukuki dayanak (--pdf ile zorunlu)")
    p.add_argument("--instructor-alias", help="hoca-A … hoca-Z (gerçek ad girilmez)")
    p.add_argument("--uploaded-by", help="yükleyen personelin staff.id'si (isteğe bağlı)")
    p.add_argument("--name-hashes", type=Path, default=None, help="ad-token sha256 hex listesi (JSON)")

    p = cli_base.add_command(sub, "embed", "Madde metinlerini göm (exam_items.embedding)")
    p.add_argument("--course", required=True, help="ders kodu")
    p.add_argument("--all", action="store_true", help="gömmesi olanları da yeniden göm")
    p.add_argument("--name-hashes", type=Path, default=None, help="ad-token sha256 hex listesi (JSON)")

    p = cli_base.add_command(sub, "cluster", "Maddeleri kümele (exam_clusters); bitince align")
    which = p.add_mutually_exclusive_group(required=True)
    which.add_argument("--course", help="ders kodu")
    which.add_argument("--changed", action="store_true", help="ocr_done kaynağı olan dersler")
    p.add_argument("--algorithm", choices=CL.ALGORITHMS, default="auto", help="auto: scikit-learn varsa onu kullan")
    p.add_argument("--name-hashes", type=Path, default=None, help="ad-token sha256 hex listesi (JSON)")

    p = cli_base.add_command(sub, "align", "İzlence ↔ küme hizalaması (syllabus_topics)")
    p.add_argument("--course", required=True, help="ders kodu")
    p.add_argument("--syllabus", type=Path, default=None, help='[{"week":1,"topics":[...],"skill_ids":[...]}]')

    p = cli_base.add_command(sub, "plan", "Sıklık analizine göre öncelik planı (elle)")
    p.add_argument("--course", required=True, help="ders kodu")
    p.add_argument("--period", required=True, help="dönem (ör. 2026-guz)")
    p.add_argument("--algorithm", choices=CL.ALGORITHMS, default="auto", help="kümeleme gerekirse algoritma")
    p.add_argument("--name-hashes", type=Path, default=None, help="ad-token sha256 hex listesi (JSON)")

    p = cli_base.add_command(sub, "variants", "Onaylı plandan Tablet varyant istekleri (generation_requests)")
    p.add_argument("--plan", required=True, help="exam_priority_plans.id (status='approved')")
    p.add_argument("--top", type=int, default=VA.DEFAULT_TOP, help="ilk N satır (varsayılan 5)")

    p = cli_base.add_command(sub, "distractor-report", "Çeldirici seçilme oranları")
    p.add_argument("--curriculum", default=None, help="müfredat kodu (ör. TYT-MAT); verilmezse tümü")

    p = cli_base.add_command(sub, "prerequisite-audit", "Ön koşul çıkarımı ↔ sonraki doğrudan ölçüm")
    p.add_argument("--curriculum", default=None, help="müfredat kodu (ör. TYT-MAT); verilmezse tümü")
    p.add_argument("--window-days", type=int, default=RP.DEFAULT_WINDOW_DAYS, help="izleme penceresi (gün)")
    return parser


def _ingest(rt, ns: argparse.Namespace, out: Path) -> int:
    hashes = load_name_hashes(ns.name_hashes)
    if ns.queue:
        results = IN.ingest_queue(rt, limit=ns.limit or IN.DEFAULT_QUEUE_LIMIT, name_hashes=hashes)
        if not results:
            print("SKIP: no uploaded sources")
            return 0
    elif ns.source:
        results = [IN.ingest_source(rt, ns.source, name_hashes=hashes)]
    else:
        missing = [flag for flag, value in (("--course", ns.course), ("--year", ns.year), ("--term", ns.term),
                                            ("--legal-basis", ns.legal_basis)) if value is None]
        if missing:
            print(f"HATA: --pdf ile {', '.join(missing)} zorunlu", file=sys.stderr)
            return 2
        results = [IN.ingest_pdf(rt, ns.pdf, course_code=ns.course, year=ns.year, term=ns.term,
                                 legal_basis=ns.legal_basis, instructor_alias=ns.instructor_alias,
                                 uploaded_by=ns.uploaded_by, name_hashes=hashes)]
    write_json(out, "ingest_report.json", [r.as_dict() for r in results])
    failed = 0
    for r in results:
        if r.status == "ocr_done":
            print(f"OCR tamam: {r.year}/{r.term} · {r.items} madde (kaynak {r.source_id})")
        elif r.status == "deferred":
            print(f"ERTELENDİ: {r.year}/{r.term} (kaynak {r.source_id}) harcama tavanı nedeniyle 'uploaded' kaldı; "
                  f"sonraki gece yeniden denenir: {r.error}")
        else:
            failed += 1
            print(f"OCR tamamlanamadı: {r.year}/{r.term} (kaynak {r.source_id}): {r.error}", file=sys.stderr)
        for w in r.warnings:
            print(f"UYARI: {w}", file=sys.stderr)
    return 0 if ns.queue or not failed else 1


def _cluster(rt, ns: argparse.Namespace, out: Path) -> int:
    hashes = load_name_hashes(ns.name_hashes)
    courses = CL.changed_courses(rt) if ns.changed else [course_by_code(rt.db, ns.course)]
    if not courses:
        print("SKIP: no changed courses")
        return 0
    summaries = [CL.cluster_course(rt, c, name_hashes=hashes, algorithm=ns.algorithm) for c in courses]
    write_json(out, "cluster_report.json", summaries)
    for s in summaries:
        print(f"{s['course_code']}: {s['items']} madde → {s['clusters']} küme ({s['years_total']} yıl, "
              f"{s['algorithm'] or '—'})")
    return 0


def main(argv: Sequence[str] | None = None) -> int:
    ns = build_parser().parse_args(argv)
    if ns.out is None:
        ns.out = Path("out")
    out: Path = ns.out
    with cli_base.open_runtime(ns) as rt:
        cmd = ns.command
        if cmd == "ingest":
            return _ingest(rt, ns, out)
        if cmd == "embed":
            rep = EM.embed_course(rt, course_by_code(rt.db, ns.course), name_hashes=load_name_hashes(ns.name_hashes),
                                  refresh=ns.all)
            write_json(out, "embed_report.json", rep)
            print(f"{rep['course_code']}: {rep['embedded']} madde gömüldü ({rep['items']} madde)")
            return 0
        if cmd == "cluster":
            return _cluster(rt, ns, out)
        if cmd == "align":
            rep = AL.align_course(rt, course_by_code(rt.db, ns.course), syllabus=ns.syllabus)
            print(f"{rep['course_code']}: {len(rep['clusters'])} küme hizalandı; izlencede olup sorulmamış "
                  f"{len(rep['uncovered_topics'])} konu")
            return 0
        if cmd == "plan":
            res = PL.plan_course(rt, course_by_code(rt.db, ns.course), ns.period,
                                 name_hashes=load_name_hashes(ns.name_hashes), algorithm=ns.algorithm)
            plan = res["plan"]
            print(f"{plan['course_code']} · {plan['period']}: {len(plan['rows'])} satırlık plan onaya düştü "
                  f"({plan['years_total']} yıl, {plan['evidence_count']} madde)")
            return 0
        if cmd == "variants":
            rep = VA.variants_for_plan(rt, ns.plan, top=ns.top)
            sk = rep["skipped"]
            print(f"{rep['written']} varyant isteği yazıldı; atlanan: ispat {sk['proof']}, kazanımsız "
                  f"{sk['no_skill']}, zaten açık {sk['exists']}")
            return 0
        if cmd == "distractor-report":
            rep = RP.distractor_report(rt.db, curriculum=ns.curriculum)
            write_json(out, "distractor_report.json", rep)
            write_text(out, "distractor_report.md", RP.distractor_markdown(rep))
            print(f"Çeldirici raporu: {rep['n']} etiketli çeldirici, {rep['unused']} hiç seçilmemiş")
            return 0
        if cmd == "prerequisite-audit":
            rep = RP.prerequisite_audit(rt.db, curriculum=ns.curriculum, window_days=ns.window_days, since=ns.since)
            write_json(out, "prerequisite_audit.json", rep)
            write_text(out, "prerequisite_audit.md", RP.prerequisite_markdown(rep))
            print(f"Ön koşul denetimi: {rep['n_inferred']} çıkarım, {rep['n_measured']} sonradan ölçülen, "
                  f"{rep['n_agreed']} örtüşen")
            return 0
    raise AssertionError(f"bilinmeyen komut: {ns.command}")  # pragma: no cover - argparse reddeder


def entrypoint() -> None:
    sys.exit(cli_base.run_main(main))
