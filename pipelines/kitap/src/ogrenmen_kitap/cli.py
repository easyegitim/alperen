"""``python -m ogrenmen_kitap`` — araştırma ajanı (BLUEPRINT §6.5).

Komutlar::

    run --request <uuid>                 tek istek (queued | failed | blocked_quota) → done | failed | blocked_quota
    run --query "..." [--dry-run]        elle çalıştırma: istek satırı yok, DB'ye çıktı yazılmaz; --out/output.json
    run --queued [--limit 5]             gece kuyruğu: research_requests where status='queued' order by created_at
    verify --output <uuid>               yalnız Crossref yeniden denetimi (LLM yok)

Ortak bayraklar (``ogrenmen_common.cli_base``): ``--dry-run --fixtures --out --limit --since --student-ref
--adapters``. ``--out`` verilmezse ``./out``. ``--name-hashes <json>``: ad-token sha256 listesi; modele giden soru
ve PDF metni bu hash'lerle de temizlenir (düz ad kabul edilmez).

``runtime_flags.research_enabled=false`` iken ``--queued`` ve ``--request`` "SKIP: research disabled" yazar ve 0 ile
çıkar; ``--query`` elle çalıştırmadır, bayrağı bilgi satırı olarak yazar ve sürer (harcama ve aylık tavan yine
denetlenir). Kuyrukta satır yoksa "SKIP: no queued requests".

Çıkış kodu: ``run --queued`` işlenen satırlardan biri ``failed`` olduysa 1 döner (gece işi adımı kırmızı görünür;
diğer satırlar yine işlenmiş ve ``queued_report.json`` yazılmıştır); ``done``, ``queued`` (geçici harcama engeli)
ve ``blocked_quota`` 0'dır. ``--limit`` verilmezse 5; 1'den küçük değeri ``cli_base`` ayrıştırırken reddeder.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from collections.abc import Sequence
from pathlib import Path
from typing import Any

from ogrenmen_common import cli_base

from . import gate
from . import pipeline as P
from .errors import GateBlocked, KitapError

PROG = "ogrenmen_kitap"
DEFAULT_LIMIT = 5
_HEX64 = re.compile(r"[0-9a-fA-F]{64}")


def build_parser() -> argparse.ArgumentParser:
    parser = cli_base.build_parser(PROG, "Öğrenmen Kitap: kaynakları Crossref'te doğrulanmış araştırma sentezi")
    sub = parser.add_subparsers(dest="command", required=True, metavar="komut")

    p = cli_base.add_command(sub, "run", "Araştırma çalıştır (--request | --query | --queued)")
    which = p.add_mutually_exclusive_group(required=True)
    which.add_argument("--request", help="research_requests.id (uuid)")
    which.add_argument("--query", help="elle araştırma sorusu (istek satırı açılmaz)")
    which.add_argument("--queued", action="store_true",
                       help="status='queued' istekler (gece işi; --limit, varsayılan 5)")
    p.add_argument("--name-hashes", type=Path, default=None, help="ad-token sha256 hex listesi (JSON)")

    p = cli_base.add_command(sub, "verify", "Kayıtlı çıktının atıflarını Crossref'te yeniden denetle")
    p.add_argument("--output", required=True, help="research_outputs.id (uuid)")
    return parser


def load_name_hashes(path: Path | None) -> list[str]:
    if path is None:
        return []
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    if not isinstance(data, list) or not all(isinstance(h, str) and _HEX64.fullmatch(h) for h in data):
        raise KitapError("OGR-KITAP-009 --name-hashes 64 karakterlik sha256 hex dizisi olmalı (düz ad değil)")
    return [h.lower() for h in data]


def write_json(out: Path, name: str, data: Any) -> Path:
    path = out / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return path


def _summary(report: dict) -> str:
    removed = ", ".join(f"{k} {v}" for k, v in report.get("removed", {}).items()) or "yok"
    return (f"{report['kept']} kaynak doğrulandı, çıkarılan: {removed}; {report['paragraphs']} paragraf; "
            f"{report['llm_calls']} model çağrısı, {report['cost_usd']:.4f} $")


def cmd_run(ns: argparse.Namespace, ca: cli_base.CommonArgs) -> int:
    hashes = load_name_hashes(ns.name_hashes)
    out: Path = ca.out
    with cli_base.open_runtime(ca) as rt:
        if ns.query is not None:
            if not gate.research_enabled(rt.db):
                print("BİLGİ: runtime_flags.research_enabled=false; --query elle çalıştırma olarak sürüyor "
                      "(öğrenci kuyruğu kapalı kalır).")
            res = P.research(rt, ns.query, request_id=P.query_request_id(ns.query), name_hashes=hashes,
                             require_enabled=False)
            write_json(out, "output.json", res.output)
            write_json(out, "report.json", res.report)
            print(f"Araştırma tamam: {_summary(res.report)}. Çıktı: {out / 'output.json'}")
            return 0
        if ns.queued:
            limit = DEFAULT_LIMIT if ca.limit is None else int(ca.limit)   # < 1 cli_base'de reddedilir
            try:
                results = P.run_queued(rt, limit=limit, name_hashes=hashes)
            except GateBlocked as blocked:
                if blocked.kind == "disabled":
                    print("SKIP: research disabled")
                    return 0
                raise
            if not results:
                print("SKIP: no queued requests")
                return 0
            for r in results:
                if r.output is not None:
                    write_json(out, f"outputs/{r.request_id}.json", r.output)
                line = f"{r.request_id}: {r.status}"
                print(line + (f" ({r.error})" if r.error else f" — çıktı {r.output_id}" if r.output_id else ""))
            write_json(out, "queued_report.json", [
                {"request_id": r.request_id, "status": r.status, "output_id": r.output_id, "error": r.error,
                 "cost_usd": r.cost_usd, "report": r.report} for r in results])
            failed = [r.request_id for r in results if r.status == "failed"]
            if failed:
                print(f"HATA: {len(failed)} istek başarısız: {', '.join(failed)}", file=sys.stderr)
                return 1
            return 0
        if not gate.research_enabled(rt.db):
            print("SKIP: research disabled")
            return 0
        r = P.run_request(rt, ns.request, name_hashes=hashes)
        if r.output is not None:
            write_json(out, "output.json", r.output)
            write_json(out, "report.json", r.report)
        print(f"{r.request_id}: {r.status}" + (f" ({r.error})" if r.error else f" — çıktı {r.output_id}"))
        return 0 if r.status in ("done", "queued", "blocked_quota") else 1


def cmd_verify(ns: argparse.Namespace, ca: cli_base.CommonArgs) -> int:
    with cli_base.open_runtime(ca) as rt:
        res = P.verify_output(rt, ns.output)
        write_json(ca.out, "output.json", res.output)
        write_json(ca.out, "verify_report.json", {"output_id": res.output_id, "checked": res.checked,
                                                   "removed": res.removed, "paragraphs_dropped": res.paragraphs_dropped,
                                                   "alert": res.alert})
        removed = len(res.removed)
        print(f"Yeniden denetim: {res.checked} atıf denetlendi, {removed} çıkarıldı, {res.paragraphs_dropped} paragraf "
              "çıktı." + (" Doğrulanmış paragraf kalmadı; eğitmene bildirim açıldı." if res.alert else ""))
        return 0


def main(argv: Sequence[str] | None = None) -> int:
    ns = build_parser().parse_args(argv)
    ca = cli_base.common_args(ns)
    if ca.out is None:
        ca = cli_base.CommonArgs(**{**ca.__dict__, "out": Path("out")})
    if ns.command == "run":
        return cmd_run(ns, ca)
    return cmd_verify(ns, ca)


def entrypoint() -> None:
    sys.exit(cli_base.run_main(main))
