"""Araştırma akışı (§6.5): ``research`` (tek soru), ``run_request`` (istek satırı), ``run_queued`` (gece kuyruğu),
``verify_output`` (yalnız Crossref yeniden denetimi).

Yazımlar ``batch_worker`` yetkisiyle (§3.8; ``supabase/tests/grants_matrix.json``):

* ``research_requests`` — yalnız ``status, expanded_queries, cost_usd, finished_at`` güncellenir (``return=minimal``);
* ``research_outputs`` — ``request_id, output, bibtex, apa, model`` eklenir (``status`` DB varsayılanı
  ``pending_review``; RLS ``with check (status = 'pending_review')``); yeni satırın ``id``'si ``RETURNING`` ile okunur
  (tablo düzeyi SELECT var);
* ``citations`` — tutulan **ve** çıkarılan her aday bir satırdır (``status='kept'|'removed'``, ``removed_reason``,
  ``crossref_status`` ``verified|unresolved|no_doi|pending``). Çözülemeyen DOI yalnız bu tabloda kalır (inceleme ve
  ``citations.unresolved`` 7 günlük saklama kuralı için ``verified_at`` = denetim anı); ``research-output`` JSON'unda
  hiçbir yerde geçmez — ``removed[].doi_or_title`` bu satırlar için başlıktır.

``output.query`` modele giden **temizlenmiş** sorudur (``scrub_for_llm``; e-posta, telefon, ad-token hash'leri);
istek satırındaki ham soru ``research_requests.query``'de kalır, çıktıya (öğrenciye ve dosyaya) kopyalanmaz.

Öğrenci kimliği hiçbir yere taşınmaz (``students.id`` → ``public_ref`` eşlemesi yapılmaz; ``llm_calls.student_ref``
boş, ``ref_table='research_requests'``, ``ref_id`` = istek kimliği).
"""

from __future__ import annotations

import dataclasses
import os
import uuid
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any

import httpx
import ogrenmen_contracts as contracts
from ogrenmen_common.adapters.base import insert_minimal, update_minimal
from ogrenmen_common.clock import iso
from ogrenmen_common.errors import AdapterError, LedgerError
from ogrenmen_common.fakes import FakeUnpaywall
from ogrenmen_common.pii import scrub_for_llm
from ogrenmen_common.runtime import Runtime

from . import bib, gate, search, synthesize, zotero
from . import verify as V
from .errors import GateBlocked, KitapError
from .pdfs import FakePdfFetcher, HttpPdfFetcher, PdfFetcher, collect
from .verify import Checked

NAMESPACE_KITAP = uuid.UUID("5d1f3a64-6b0e-5c3e-9a51-0f1c2e7b8a90")
OUTPUT_SCHEMA = "research-output"


def query_request_id(query: str) -> str:
    """``run --query`` için deterministik istek kimliği (istek satırı yoktur)."""
    return str(uuid.uuid5(NAMESPACE_KITAP, "kitap:query:" + " ".join(query.split()).lower()))


def _spent_since(rt: Runtime, calls_before: int) -> float:
    """``calls_before``'dan sonraki ``CostLedger`` çağrılarının toplam maliyeti."""
    return round(sum(float(c.get("cost_usd") or 0) for c in rt.ledger.calls[calls_before:]), 6)


def pdf_fetcher_for(rt: Runtime) -> PdfFetcher:
    if rt.is_fake:
        return FakePdfFetcher(rt.fixtures if rt.fixtures is not None and (rt.fixtures / "sample.pdf").is_file()
                              else None)
    return HttpPdfFetcher()


@dataclass
class ResearchResult:
    request_id: str
    query: str
    output: dict
    checked: list[Checked]
    report: dict
    cost_usd: float
    output_id: str | None = None


@dataclass
class QueueResult:
    request_id: str
    status: str
    output_id: str | None = None
    error: str | None = None
    cost_usd: float = 0.0
    report: dict = field(default_factory=dict)
    output: dict | None = None


# --- tek soru ------------------------------------------------------------------------------------


def research(rt: Runtime, query: str, *, request_id: str, name_hashes: Sequence[str] = (),
             fetcher: PdfFetcher | None = None, require_enabled: bool = True,
             env: Mapping[str, str] | None = None) -> ResearchResult:
    """Kapı → genişletme → arama → Crossref → Unpaywall/PDF → sentez → BibTeX/APA → şema. DB'ye yazmaz."""
    now = rt.clock()
    gate.check(rt.db, rt.ledger, now, require_enabled=require_enabled)
    calls_before = len(rt.ledger.calls)
    question = scrub_for_llm(query, list(name_hashes)).text
    queries, _ = search.expand_queries(rt.ledger, question, ref_id=request_id, name_hashes=name_hashes)
    scholars = search.active_scholars(rt.scholars, fake=rt.is_fake, env=env)
    records, source_errors = search.gather(scholars, [question, *queries])
    candidates, duplicates = search.merge(records)
    search.score(candidates, [question, *queries], current_year=now.year)
    pool = search.top(candidates)
    now_iso = iso(now)
    checked = [V.check_candidate(rt.doi, c, now_iso=now_iso) for c in pool]
    kept = [c for c in checked if c.kept]
    removed = [c for c in checked if not c.kept]
    for d in duplicates:
        removed.append(Checked(cand=d, crossref_status="pending", kept=False, reason="duplicate", title=d.title,
                               authors=[V.split_name(a) for a in d.authors], venue=d.venue, year=d.year,
                               oa_pdf_url=d.oa_pdf_url))
    if not kept:
        raise KitapError("OGR-KITAP-004 doğrulanmış kaynak kalmadı (her aday Crossref'te çözülemedi ya da bağlantısız)")
    for i, c in enumerate(kept, start=1):
        c.ordinal = i
    for i, c in enumerate(removed, start=len(kept) + 1):
        c.ordinal = i
    oa_lookups = 0
    # Gerçek kipte UNPAYWALL_EMAIL yoksa Runtime sahte Unpaywall verir: fixture bağlantıları gerçek atıflara
    # yazılmasın diye o durumda açık erişim sorgusu atlanır (kaynağın kendi bağlantısı kalır).
    oa_usable = rt.is_fake or not isinstance(rt.oa, FakeUnpaywall)
    for c in kept:
        if oa_usable and c.crossref_status == "verified" and c.cand.doi:
            oa_lookups += 1
            try:
                hit = rt.oa.lookup(c.cand.doi)
            except AdapterError:
                hit = None
            if hit and hit.get("pdf_url"):
                c.oa_pdf_url = hit["pdf_url"]
    fetcher = fetcher or pdf_fetcher_for(rt)
    excerpts = collect(fetcher, [(c.ordinal, c.oa_pdf_url) for c in kept if c.oa_pdf_url])
    excerpts = [dataclasses.replace(e, text=scrub_for_llm(e.text, list(name_hashes)).text) for e in excerpts]
    syn = synthesize.synthesize(rt.ledger, question, queries, kept, excerpts, ref_id=request_id,
                                name_hashes=name_hashes)
    cost = _spent_since(rt, calls_before)
    output = {
        "schema_version": "1.0",
        "request_id": request_id,
        "query": question,
        "expanded_queries": queries,
        "synthesis": syn.paragraphs,
        "citations": [citation_json(c) for c in kept],
        "matrix": syn.matrix,
        "removed": [{"doi_or_title": removed_label(c), "reason": c.reason} for c in removed],
        "bibtex": bib.bibtex(kept),
        "apa": bib.apa(kept),
        "model": syn.model,
        "cost_usd": cost,
    }
    errs = contracts.errors(OUTPUT_SCHEMA, output)
    if errs:
        raise KitapError("OGR-KITAP-006 research-output sözleşmesine aykırı: "
                         + "; ".join(f"{e.path or '/'} {e.message}" for e in errs[:5]))
    report = {
        "request_id": request_id,
        "expanded_queries": queries,
        "sources": [s.source for s in scholars],
        "source_errors": source_errors,
        "records": len(records),
        "candidates": len(pool),
        "kept": len(kept),
        "removed": {r: sum(1 for c in removed if c.reason == r) for r in sorted({c.reason for c in removed})},
        "oa_lookups": oa_lookups,
        "oa_skipped": not oa_usable,
        "pdfs": [{"ordinal": e.ordinal, "pages_read": e.pages_read, "pages_total": e.pages_total,
                  "tokens": e.tokens} for e in excerpts],
        "paragraphs": len(syn.paragraphs),
        "paragraphs_dropped": syn.dropped,
        "paragraphs_regenerated": syn.regenerated,
        "llm_calls": len(rt.ledger.calls) - calls_before,
        "cost_usd": cost,
        "model": syn.model,
    }
    return ResearchResult(request_id=request_id, query=question, output=output, checked=kept + removed, report=report,
                          cost_usd=cost)


def removed_label_for(reason: str | None, doi: str | None, title: str) -> str:
    """Çözülemeyen DOI çıktıda tekrar edilmez (uydurma olabilir): başlık yazılır. Diğerlerinde DOI varsa DOI."""
    if reason == "crossref_unresolved" or not doi:
        return title
    return doi


def removed_label(c: Checked) -> str:
    return removed_label_for(c.reason, c.cand.doi, c.title or c.cand.title)


def citation_json(c: Checked) -> dict:
    out: dict[str, Any] = {"ordinal": c.ordinal}
    if c.crossref_status == "verified":
        out["doi"] = c.cand.doi
    out.update({"title": c.title, "authors": c.authors_text, "venue": c.venue, "year": int(c.year),
                "crossref_status": c.crossref_status})
    if c.crossref_status == "verified":
        out["title_similarity"] = c.title_similarity
        out["verified_at"] = c.verified_at
    out["oa_pdf_url"] = c.oa_pdf_url
    tldr = " ".join(c.cand.tldr.split()) if c.cand.tldr else None
    if tldr and contracts.find_forbidden_word(tldr, synthesize.forbidden_words()):
        tldr = None   # ilke 10: kaynağın kendi özeti de yasaklı kelimeyle çıktıya giremez
    out["tldr"] = (tldr[:239] + "…") if tldr and len(tldr) > 240 else tldr
    out["source"] = c.cand.source
    return out


def citation_row(c: Checked, output_id: str) -> dict:
    """``citations`` satırı (yalnız ``batch_worker`` INSERT sütunları)."""
    tldr = citation_json(c)["tldr"] if c.kept else None
    return {"output_id": output_id, "ordinal": c.ordinal, "doi": c.cand.doi, "title": c.title or c.cand.title,
            "authors": c.authors_text or None, "venue": c.venue, "year": c.year,
            "crossref_status": c.crossref_status, "title_similarity": c.title_similarity,
            "verified_at": c.verified_at, "oa_pdf_url": c.oa_pdf_url, "tldr": tldr,
            "status": "kept" if c.kept else "removed", "removed_reason": None if c.kept else c.reason}


def store(rt: Runtime, res: ResearchResult) -> str:
    """``research_outputs(pending_review)`` + ``citations``; çıktı kimliğini döner."""
    row = {"request_id": res.request_id, "output": res.output, "bibtex": res.output["bibtex"],
           "apa": "\n".join(res.output["apa"]), "model": res.output["model"]}
    got = rt.db.insert("research_outputs", row, returning="representation")
    if not got or not got[0].get("id"):
        raise KitapError("OGR-KITAP-006 research_outputs satırı kimliksiz döndü")
    output_id = str(got[0]["id"])
    res.output_id = output_id   # citations yazımı düşerse yarım çıktının kimliği hata satırında görünsün
    insert_minimal(rt.db, "citations", [citation_row(c, output_id) for c in res.checked])
    return output_id


# --- istek satırları -----------------------------------------------------------------------------


def _finish(rt: Runtime, request_id: str, status: str, *, cost: float | None = None,
            queries: Sequence[str] | None = None) -> None:
    values: dict[str, Any] = {"status": status, "finished_at": iso(rt.clock())}
    if cost is not None:
        values["cost_usd"] = round(cost, 6)
    if queries is not None:
        values["expanded_queries"] = list(queries)
    update_minimal(rt.db, "research_requests", values, where={"id": request_id})


def load_request(rt: Runtime, request_id: str) -> dict:
    rows = rt.db.select("research_requests", where={"id": request_id}, limit=1)
    if not rows:
        raise KitapError(f"OGR-KITAP-001 araştırma isteği bulunamadı: {request_id}")
    return rows[0]


def transient_block(exc: BaseException) -> bool:
    """Ertesi gece kendiliğinden geçebilecek harcama engeli: kapının ``spend``/``degraded`` engeli ya da
    ``CostLedger``'ın ``OGR-LLM-002``'si (tavan çağrı sırasında aşıldı, degraded kip)."""
    if isinstance(exc, GateBlocked):
        return exc.kind in ("spend", "degraded")
    return isinstance(exc, LedgerError) and exc.code == "OGR-LLM-002"


def _error_text(exc: BaseException) -> str:
    message = getattr(exc, "message", None)
    return (str(message) if message else f"{type(exc).__name__}: {exc}")[:200]


def process_row(rt: Runtime, row: Mapping[str, Any], *, name_hashes: Sequence[str] = (),
                fetcher: PdfFetcher | None = None, env: Mapping[str, str] | None = None) -> QueueResult:
    """Tek istek: ``running`` → ``done | failed | blocked_quota``. Geçici harcama engelinde (``spend``,
    ``degraded``, ``OGR-LLM-002``) satır ``queued`` kalır ya da ``queued``'a döner ve ertesi gece yeniden denenir;
    aylık araştırma tavanı → ``blocked_quota``. ``running``'e geçen satır hiçbir hatada ``running`` kalmaz:
    beklenmeyen her ``Exception`` (DB/RPC hatası, hata ayıklanmamış kusur) satırı ``failed`` yapar ve kuyruğun
    kalanı sürer (``KeyboardInterrupt``/``SystemExit`` ``Exception`` değildir, yayılır)."""
    rid = str(row["id"])
    try:
        gate.check(rt.db, rt.ledger, rt.clock(), require_enabled=True)
    except GateBlocked as blocked:
        if blocked.kind == "monthly_cap":
            _finish(rt, rid, "blocked_quota")
            return QueueResult(rid, "blocked_quota", error=blocked.message)
        return QueueResult(rid, "queued", error=blocked.message)
    update_minimal(rt.db, "research_requests", {"status": "running"}, where={"id": rid})
    calls_before = len(rt.ledger.calls)
    prior = float(row.get("cost_usd") or 0)
    res: ResearchResult | None = None
    try:
        res = research(rt, str(row["query"]), request_id=rid, name_hashes=name_hashes, fetcher=fetcher,
                       require_enabled=True, env=env)
        output_id = store(rt, res)
    except Exception as exc:  # noqa: BLE001 - satır hiçbir hatada 'running' kalmamalı
        spent = _spent_since(rt, calls_before)
        error = _error_text(exc)
        partial = res.output_id if res is not None else None
        if partial:
            error = f"{error} (yarım çıktı {partial})"[:240]
        if transient_block(exc):
            update_minimal(rt.db, "research_requests", {"status": "queued", "cost_usd": round(prior + spent, 6)},
                           where={"id": rid})
            return QueueResult(rid, "queued", error=error, cost_usd=spent)
        status = "blocked_quota" if isinstance(exc, GateBlocked) and exc.kind == "monthly_cap" else "failed"
        _finish(rt, rid, status, cost=prior + spent)
        return QueueResult(rid, status, output_id=partial, error=error, cost_usd=spent)
    _finish(rt, rid, "done", cost=prior + res.cost_usd, queries=res.output["expanded_queries"])
    res.report["zotero"] = export_zotero(rt, res, env=env)
    return QueueResult(rid, "done", output_id=output_id, cost_usd=res.cost_usd, report=res.report, output=res.output)


def export_zotero(rt: Runtime, res: ResearchResult, *, env: Mapping[str, str] | None = None) -> dict | None:
    """İsteğe bağlı Zotero aktarımı: yalnız gerçek kipte ve anahtar varken; hata araştırmayı düşürmez (satır zaten
    ``done``; yapılandırma hatası, ağ hatası ya da bozuk yanıt ``{"error": …}`` olarak rapora yazılır)."""
    if rt.is_fake or rt.dry_run:
        return None
    try:
        exporter = zotero.exporter_from_env(os.environ if env is None else env)
        if exporter is None:
            return None
        return exporter.export([c for c in res.checked if c.kept])
    except (AdapterError, ValueError, httpx.HTTPError) as exc:
        return {"error": _error_text(exc)}


RERUNNABLE = ("queued", "failed", "blocked_quota")


def run_request(rt: Runtime, request_id: str, **kwargs: Any) -> QueueResult:
    row = load_request(rt, request_id)
    if row.get("status") not in RERUNNABLE:
        raise KitapError(f"OGR-KITAP-002 istek durumu '{row.get('status')}'; yalnız {', '.join(RERUNNABLE)} "
                         "çalıştırılır")
    return process_row(rt, row, **kwargs)


def queued_rows(rt: Runtime, limit: int) -> list[dict]:
    return rt.db.select("research_requests", where={"status": "queued"}, order="created_at", limit=limit)


def run_queued(rt: Runtime, *, limit: int = 5, **kwargs: Any) -> list[QueueResult]:
    """Kuyruk tüketicisi. ``research_enabled=false`` → ``GateBlocked('disabled')`` (CLI "SKIP" yazar)."""
    if not gate.research_enabled(rt.db):
        raise GateBlocked("disabled", "research disabled (runtime_flags.research_enabled=false)")
    results = []
    for row in queued_rows(rt, limit):
        res = process_row(rt, row, **kwargs)
        results.append(res)
        if res.status == "queued":   # geçici harcama engeli: kalan satırlar da beklesin
            break
    return results


# --- verify --------------------------------------------------------------------------------------


@dataclass
class VerifyResult:
    output_id: str
    checked: int
    removed: list[dict]
    paragraphs_dropped: int
    output: dict
    alert: bool = False


def verify_output(rt: Runtime, output_id: str) -> VerifyResult:
    """Kayıtlı çıktının ``verified`` atıflarını Crossref'te yeniden denetler (LLM yok). Düşen atıf ``removed``
    olur; ona işaret eden paragraf çıkar; BibTeX/APA'dan yalnız düşen kayıtlar silinir (kalan kayıtların türü ve
    anahtarı aynen kalır). Paragraf kalmazsa eğitmene ``instructor_alerts(kind='ops')`` açılır (``batch_worker``
    çıktı durumunu değiştiremez)."""
    rows = rt.db.select("research_outputs", where={"id": output_id}, limit=1)
    if not rows:
        raise KitapError(f"OGR-KITAP-008 araştırma çıktısı bulunamadı: {output_id}")
    record = rows[0]
    output = dict(record["output"])
    cits = rt.db.select("citations", where={"output_id": output_id}, order="ordinal")
    now_iso = iso(rt.clock())
    removed_ordinals: set[int] = set()
    removed_rows: list[dict] = []
    checked = 0
    for c in cits:
        if c.get("status") != "kept" or c.get("crossref_status") != "verified" or not c.get("doi"):
            continue
        checked += 1
        status, reason, sim = V.recheck(rt.doi, doi=c["doi"], title=c["title"])
        if status == "verified":
            update_minimal(rt.db, "citations", {"verified_at": now_iso, "title_similarity": sim},
                           where={"id": c["id"]})
            continue
        removed_ordinals.add(int(c["ordinal"]))
        removed_rows.append({"ordinal": c["ordinal"], "reason": reason, "title": c["title"], "doi": c["doi"]})
        update_minimal(rt.db, "citations", {"crossref_status": status, "status": "removed", "removed_reason": reason,
                                            "title_similarity": sim, "verified_at": now_iso}, where={"id": c["id"]})
    dropped = 0
    alert = False
    if removed_ordinals:
        before = list(output.get("synthesis") or [])
        output["synthesis"] = [p for p in before if not set(p.get("cites") or []) & removed_ordinals]
        dropped = len(before) - len(output["synthesis"])
        old_cits = list(output.get("citations") or [])
        output["citations"] = [c for c in old_cits if c["ordinal"] not in removed_ordinals]
        output["matrix"] = [m for m in output.get("matrix") or [] if m["ordinal"] not in removed_ordinals]
        output["removed"] = list(output.get("removed") or []) + [
            {"doi_or_title": removed_label_for(r["reason"], r["doi"], r["title"]), "reason": r["reason"]}
            for r in removed_rows]
        output["bibtex"], output["apa"] = _drop_entries(output, old_cits, removed_ordinals, cits)
        if output["synthesis"]:
            errs = contracts.errors(OUTPUT_SCHEMA, output)
            if errs:
                raise KitapError("OGR-KITAP-006 yeniden denetim sonrası çıktı sözleşmeye aykırı: "
                                 + "; ".join(f"{e.path or '/'} {e.message}" for e in errs[:5]))
            update_minimal(rt.db, "research_outputs", {"output": output, "bibtex": output["bibtex"],
                                                       "apa": "\n".join(output["apa"])}, where={"id": output_id})
        else:
            alert = True
            open_ops_alert(rt, output_id, now_iso)
    report_rows = [{k: r[k] for k in ("ordinal", "reason", "title")} for r in removed_rows]   # DOI rapora yazılmaz
    return VerifyResult(output_id=output_id, checked=checked, removed=report_rows, paragraphs_dropped=dropped,
                        output=output, alert=alert)


def _drop_entries(output: Mapping[str, Any], old_cits: Sequence[Mapping[str, Any]], removed: set[int],
                  rows: Sequence[Mapping[str, Any]]) -> tuple[str, list[str]]:
    """Kayıtlı BibTeX/APA'dan düşen atıfların kayıtlarını siler. ``bibtex()``/``apa()`` tutulan atıflar sırasıyla
    (``citations[]`` sırası) yazıldığından kayıtlar sırayla eşlenir. Kayıt sayısı tutmazsa (elle düzenlenmiş eski
    çıktı) kalan ``citations`` satırlarından yeniden üretilir; bu yolda Crossref türü satırda olmadığından tür
    ``article``/``misc``'e düşer."""
    entries = bib.split_entries(str(output.get("bibtex") or ""))
    apa_lines = list(output.get("apa") or [])
    ordinals = [int(c["ordinal"]) for c in old_cits]
    if len(entries) == len(ordinals) == len(apa_lines):
        keep = [i for i, o in enumerate(ordinals) if o not in removed]
        text = "".join(entries[i] for i in keep)
        if keep:
            bib.validate_bibtex(text, expected=len(keep))
        return text, [apa_lines[i] for i in keep]
    kept_rows = [c for c in rows if c.get("status") == "kept" and int(c["ordinal"]) not in removed]
    rebuilt = [_checked_from_row(c) for c in kept_rows]
    return (bib.bibtex(rebuilt) if rebuilt else ""), bib.apa(rebuilt)


def ops_alert_row(output_id: str, now_iso: str) -> dict:
    """``instructor_alerts`` satırı. ``detail``'in ilk 24 karakteri çıktı kimliğini taşır: ``alerts_dedup``
    (tür + öğrenci + ``ref`` anahtarı + ``left(detail, 24)``) farklı çıktıların alarmlarını ayırır; sözleşmenin
    ``ref`` anahtarlarında ``output_id`` olmadığından ``ref`` boştur."""
    return {"kind": "ops", "severity": "warning",
            "detail": (f"Araştırma {output_id[:8]}: doğrulanmış paragraf kalmadı; çıktıyı reddet ya da isteği "
                       "yeniden kuyruğa al.")[:240],
            "ref": {}, "since": now_iso}


def alert_contract_view(row: Mapping[str, Any]) -> dict:
    return {"schema_version": "1.0", "kind": row["kind"], "severity": row["severity"], "student_ref": None,
            "staff_ref": None, "detail": row["detail"], "since": row["since"], "ref": dict(row.get("ref") or {})}


def open_ops_alert(rt: Runtime, output_id: str, now_iso: str) -> bool:
    """Sözleşmeden geçirip yazar; aynı çıktı için açık alarm varsa yazmaz (``alerts_dedup`` çakışması olmasın).
    Dönüş: yeni satır yazıldı mı."""
    row = ops_alert_row(output_id, now_iso)
    view = alert_contract_view(row)
    contracts.validate("instructor-alert", view)
    hit = contracts.find_forbidden_word(row["detail"],
                                        list(contracts.schema("instructor-alert").get("x-forbidden-words") or []))
    if hit:
        raise KitapError(f"OGR-KITAP-006 alarm metninde yasaklı kelime: {hit}")
    for a in rt.db.select("instructor_alerts", where={"kind": "ops", "status": "open"}):
        if (a.get("student_id") is None and not any((a.get("ref") or {}).get(k) is not None for k in ALERT_REF_KEYS)
                and str(a.get("detail") or "")[:24] == row["detail"][:24]):
            return False
    insert_minimal(rt.db, "instructor_alerts", row)
    return True


ALERT_REF_KEYS = ("message_id", "fact_id", "escalation_id", "chat_id", "lesson_id", "source_id", "staff_id")
"""``alerts_dedup`` dizinindeki ``coalesce`` anahtarları (0007_kulaklik.sql)."""


def _checked_from_row(row: Mapping[str, Any]) -> Checked:
    authors = [V.split_name(a) for a in (row.get("authors") or "").split(";") if a.strip()]
    cand = search.Candidate(title=row["title"], authors=tuple(), year=row.get("year"), doi=row.get("doi"),
                            venue=row.get("venue"), cited_by=0, sources=["crossref"],
                            oa_pdf_url=row.get("oa_pdf_url"))
    if row.get("oa_pdf_url") and "arxiv.org/pdf/" in str(row["oa_pdf_url"]):
        cand.external_ids.append("arXiv:" + str(row["oa_pdf_url"]).rsplit("/pdf/", 1)[-1])
    return Checked(cand=cand, crossref_status=row["crossref_status"], kept=True, title=row["title"], authors=authors,
                   venue=row.get("venue"), year=row.get("year"), title_similarity=row.get("title_similarity"),
                   verified_at=row.get("verified_at"), oa_pdf_url=row.get("oa_pdf_url"), ordinal=int(row["ordinal"]))


__all__ = ["QueueResult", "ResearchResult", "VerifyResult", "citation_json", "citation_row", "load_request",
           "open_ops_alert", "ops_alert_row", "process_row", "query_request_id", "removed_label", "research",
           "run_queued", "run_request", "store", "transient_block", "verify_output"]
