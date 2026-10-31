"""``kalem ingest`` — sınav PDF'i → sayfa PNG → ``ocr`` zinciri → ``exam-item`` listesi → ``exam_items`` (§6.4).

Üç giriş, tek gövde (``process_source``):

* ``--pdf <yol> --course … --year … --term … --legal-basis … [--instructor-alias hoca-X]`` — yerel PDF; PDF
  ``exams/<id>.pdf``'e yüklenir ve ``exam_sources`` satırını bu komut açar (kimlik deterministik: ders + yıl +
  dönem + PDF sha256'sı; aynı PDF ikinci kez yeni satır açmaz).
* ``--source <uuid>`` — paneldeki "Arşiv yükle" formunun açtığı satır; PDF ``Storage`` adaptöründen indirilir.
* ``--queue [--limit 10]`` — ``exam_sources where status='uploaded' order by created_at`` (gece işi); satır
  yoksa ``SKIP: no uploaded sources``.

``instructor_alias``, ``year``, ``term`` ve ``source_id`` **kaynaktan** yazılır (modelin değeri ezilir; kaynakta
takma ad yoksa maddede de yoktur). ``ocr_text`` saklanmadan önce ``scrub_for_llm``'den geçer ("öğrenci kendi
kopyası" sayfalarındaki el yazısı adlar ``--name-hashes`` ile temizlenir). Yeniden OCR'da artık gelmeyen maddeler
emekliye ayrılır (``ocr_text``, ``embedding``, ``cluster_id`` boşaltılır; silme yetkisi yok) ve kümeleme/plan
onları saymaz (``course_items``). Başarıda ``exam_sources.status='ocr_done'``; hata → ``status='failed'``,
``error`` ve ``instructor_alerts(kind='ops', 'Sınav arşivi OCR tamamlanamadı: <yıl>/<dönem>', ref={source_id})``
(açık aynı alarm varsa ikincisi açılmaz). Beklenmeyen her hata da (bellek, pdfium, görüntü) aynı ``failed`` yoluna
düşer (``OGR-KALEM-011 beklenmeyen hata``): tek bozuk kaynak kuyruğu durduramaz.

**Harcama tavanı bir OCR hatası değildir:** ``CostLedger`` ``OGR-LLM-002`` (tavan/ücretli kapalı) yükseltirse kaynak
``uploaded`` kalır (``error='cap_blocked: …'``), alarm açılmaz, sonuç ``deferred`` olur ve ``--queue`` o gece kalan
kaynakları da çağrı yapmadan erteler; ertesi gece yeniden denenir.

Dry-run'da PDF ``LocalDirStorage`` ile ``<fixtures>/exam-<yıl>.pdf``'e eşlenir; OCR ``FakeLLM`` ile
``fixtures/llm/ocr/*exam-<yıl>*.json``'u döndürür (``fixture_hint``). ``replay_ocr_fixtures`` yalnız sahte
kipte, maddesi olmayan kaynaklar için ``<fixtures>/ocr-*.json`` sözleşme örneklerini OCR çıktısı olarak yeniden
oynatır (``plan --dry-run`` uçtan uca örneği; model çağrısı yok).
"""

from __future__ import annotations

import json
import re
import sys
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import ogrenmen_contracts as contracts
from ogrenmen_common.adapters.media import LLMOCR, ocr_request
from ogrenmen_common.errors import LedgerError, OgrError
from ogrenmen_common.fakes import LocalDirStorage
from ogrenmen_common.pii import scrub_for_llm

from .common import (
    KalemError,
    course_by_code,
    course_by_id,
    curriculum_skills,
    insert_minimal,
    is_retired,
    now_iso,
    select_in,
    sha256_hex,
    stable_uuid,
    update_minimal,
)
from .kinds import normalize_exam_kind
from .pdf import inspect_pdf, render_pages

TERMS = ("vize", "final", "but", "deneme", "osym", "diger")
LEGAL_BASES = ("öğrenci kendi kopyası", "kamuya açık ÖSYM yayını — yalnız istatistik", "eğitmenin kendi sınavı")
ALIAS_RE = re.compile(r"^hoca-[A-Z]$")
EXAMS_BUCKET = "exams"
ALERT_PREFIX = "Sınav arşivi OCR tamamlanamadı"
"""§6.4 metni "OCR başarısız" der; ``instructor-alert`` şemasının ``x-forbidden-words`` listesi "başarısız"ı
reddettiği için (alarm metni yargı kelimesi taşımaz) aynı anlam bu sözcükle yazılır."""
DEFAULT_QUEUE_LIMIT = 10
CAP_CODE = "OGR-LLM-002"
CAP_PREFIX = "cap_blocked"
SOURCE_META_KEYS = ("source_id", "year", "term", "instructor_alias")


@dataclass
class IngestResult:
    source_id: str
    status: str
    items: int = 0
    error: str | None = None
    year: int | None = None
    term: str | None = None
    warnings: list[str] = field(default_factory=list)

    def as_dict(self) -> dict[str, Any]:
        return {"source_id": self.source_id, "status": self.status, "items": self.items, "error": self.error,
                "year": self.year, "term": self.term, "warnings": list(self.warnings)}


# --- yardımcılar -----------------------------------------------------------------------------------


def split_storage_path(storage_path: str) -> tuple[str, str]:
    """``exams/<id>.pdf`` → (``exams``, ``<id>.pdf``)."""
    path = str(storage_path).lstrip("/")
    bucket, _, rest = path.partition("/")
    if bucket != EXAMS_BUCKET or not rest:
        raise KalemError(f"OGR-KALEM-011 exam_sources.storage_path exams/<id>.pdf biçiminde olmalı: {storage_path}")
    return bucket, rest


def source_meta(source: Mapping[str, Any]) -> dict[str, Any]:
    """OCR isteğinin ve her maddenin kaynak alanları (+ sahte LLM için ``fixture_hint``)."""
    return {"source_id": str(source["id"]), "year": int(source["year"]), "term": source.get("term"),
            "instructor_alias": source.get("instructor_alias"), "fixture_hint": f"exam-{int(source['year'])}"}


def apply_source_meta(items: Sequence[Mapping[str, Any]], meta: Mapping[str, Any]) -> list[dict]:
    """Kaynak alanlarını her maddeye yazar — kaynakta ``None`` olsa da (modelin takma adı kalmaz)."""
    out = []
    for item in items:
        row = dict(item)
        for key in SOURCE_META_KEYS:
            row[key] = meta.get(key)
        row.setdefault("schema_version", "1.0")
        out.append(row)
    return out


def validate_items(items: Sequence[Mapping[str, Any]]) -> list[dict]:
    """Her madde ``exam-item`` sözleşmesinden geçer; aynı ``item_no`` ikinci kez gelirse ilk kayıt kalır."""
    if not items:
        raise KalemError("OGR-KALEM-008 OCR çıktısında madde yok")
    seen: set[int] = set()
    out: list[dict] = []
    for item in items:
        try:
            contracts.validate("exam-item", dict(item))
        except contracts.ContractValidationError as exc:
            raise KalemError(f"OGR-KALEM-008 OCR maddesi sözleşmeden geçmedi: {exc}") from exc
        no = int(item["item_no"])
        if no in seen:
            continue
        seen.add(no)
        out.append(dict(item))
    return out


def _fixture_pdf_alias(rt: Any, source: Mapping[str, Any]) -> None:
    """Sahte kipte ``exams/<id>.pdf`` → ``<fixtures>/exam-<yıl>.pdf`` (§2.3 ``LocalDirStorage`` eşlemesi)."""
    storage = rt.storage
    if not (rt.is_fake and isinstance(storage, LocalDirStorage) and rt.fixtures is not None):
        return
    bucket, path = split_storage_path(source["storage_path"])
    if storage.exists(bucket, path):
        return
    candidate = Path(rt.fixtures) / f"exam-{int(source['year'])}.pdf"
    if candidate.is_file():
        storage.aliases[f"{bucket}/{path}"] = candidate


def ocr_extract(rt: Any, pages: Sequence[bytes], meta: Mapping[str, Any], *,
                name_hashes: Sequence[str] = ()) -> list[dict]:
    """``ocr`` zinciri: istek metni ``scrub_for_llm``'den geçer, çağrı ``CostLedger``'dan (``llm_calls``, tavan)."""
    if isinstance(rt.ocr, LLMOCR):
        req = ocr_request(pages, meta=meta)
        req = req.with_prompt(scrub_for_llm(req.prompt, list(name_hashes)).text)
        result = rt.ledger.call("ocr", req, chain=rt.ocr.chain, ref_table="exam_sources",
                                ref_id=str(meta["source_id"]))
        data = result.data
    else:  # model olmayan OCR adaptörü (metin dışarı gitmez)
        data = rt.ocr.extract_items(list(pages), meta=meta)
    if not isinstance(data, list):
        raise KalemError("OGR-KALEM-008 OCR çıktısı madde dizisi değil")
    return validate_items(apply_source_meta(data, meta))


def store_items(rt: Any, source: Mapping[str, Any], course: Mapping[str, Any], items: Sequence[Mapping[str, Any]],
                *, name_hashes: Sequence[str] = ()) -> tuple[int, list[str]]:
    """``exam-item`` → ``exam_items`` (kimlik ``uuid5(source_id, item_no)``); var olan madde güncellenir,
    metni değiştiyse gömme ve küme bağı sıfırlanır. ``ocr_text`` ``scrub_for_llm``'den geçmiş hâliyle saklanır.
    Müfredatta olmayan ``skill_id`` yazılmaz (FK) ve uyarılır. Bu OCR'da gelmeyen eski maddeler emekliye ayrılır
    (``ocr_text=None``, gömme ve küme bağı boş)."""
    db = rt.db
    curriculum_id = course.get("curriculum_id")
    skills = curriculum_skills(db, str(curriculum_id)) if curriculum_id else {}
    existing = {int(r["item_no"]): r for r in db.select("exam_items", where={"source_id": str(source["id"])},
                                                          columns=("id", "item_no", "ocr_text", "cluster_id",
                                                                   "embedding"))}
    warnings: list[str] = []
    written = 0
    seen: set[int] = set()
    for item in items:
        skill = item.get("skill_id")
        if skill and skill not in skills:
            warnings.append(f"madde {item['item_no']}: kazanım müfredatta yok, boş bırakıldı ({skill})")
            skill = None
        text = item.get("ocr_text")
        if text is not None:
            text = scrub_for_llm(str(text), list(name_hashes)).text
        values = {"topic": item.get("topic"), "kind": normalize_exam_kind(item.get("kind")),
                  "points": item.get("points"), "curriculum_id": str(curriculum_id) if curriculum_id else None,
                  "skill_id": skill, "ocr_text": text}
        no = int(item["item_no"])
        seen.add(no)
        prev = existing.get(no)
        if prev is None:
            row = {"id": stable_uuid("exam_item", source["id"], no), "source_id": str(source["id"]), "item_no": no,
                   **values}
            insert_minimal(db, "exam_items", row)
        else:
            if prev.get("ocr_text") != values["ocr_text"]:
                values.update({"embedding": None, "cluster_id": None})
            update_minimal(db, "exam_items", values, where={"id": prev["id"]})
        written += 1
    retired = sorted(no for no, prev in existing.items() if no not in seen and not is_retired(prev))
    for no in retired:
        update_minimal(db, "exam_items", {"ocr_text": None, "embedding": None, "cluster_id": None},
                       where={"id": existing[no]["id"]})
    if retired:
        warnings.append(f"yeniden OCR'da gelmeyen {len(retired)} madde emekliye ayrıldı (madde "
                        f"{', '.join(str(n) for n in retired)})")
    return written, warnings


def _is_duplicate_alert(db: Any, source_id: str, detail: str) -> bool:
    for row in db.select("instructor_alerts", where={"kind": "ops", "status": "open"}, columns=("ref", "detail")):
        ref = row.get("ref") or {}
        if isinstance(ref, str):
            ref = json.loads(ref)
        if str(ref.get("source_id")) == source_id and str(row.get("detail") or "")[:24] == detail[:24]:
            return True
    return False


def mark_failed(rt: Any, source: Mapping[str, Any], error: str) -> None:
    """``status='failed'`` + ``error`` + ops alarmı (tekil) + kurucuya bildirim."""
    sid = str(source["id"])
    update_minimal(rt.db, "exam_sources", {"status": "failed", "error": error[:500]}, where={"id": sid})
    detail = f"{ALERT_PREFIX}: {int(source['year'])}/{source.get('term')}"
    alert = {"schema_version": "1.0", "kind": "ops", "severity": "warning", "student_ref": None, "detail": detail,
             "since": now_iso(rt.clock), "ref": {"source_id": sid}}
    contracts.validate("instructor-alert", alert)
    if not _is_duplicate_alert(rt.db, sid, detail):
        insert_minimal(rt.db, "instructor_alerts", {
            "kind": "ops", "severity": "warning", "detail": detail, "since": alert["since"], "ref": alert["ref"],
            "staff_id": source.get("uploaded_by"), "student_id": None})
    rt.notifier.notify(f"{detail} (kaynak {sid})", level="warning")


# --- ortak gövde -----------------------------------------------------------------------------------


def _is_cap_block(exc: BaseException) -> bool:
    return isinstance(exc, LedgerError) and str(getattr(exc, "message", None) or exc).startswith(CAP_CODE)


def defer_source(rt: Any, source: Mapping[str, Any], message: str) -> None:
    """Tavan engeli: ``status`` ``uploaded`` kalır, ``error`` nedeni taşır; alarm/bildirim yok."""
    update_minimal(rt.db, "exam_sources", {"error": f"{CAP_PREFIX}: {message}"[:500]},
                   where={"id": str(source["id"])})


def process_source(rt: Any, source: Mapping[str, Any], *, pdf_bytes: bytes | None = None,
                   name_hashes: Sequence[str] = ()) -> IngestResult:
    """Tek kaynak: PDF → PNG → OCR → ``exam_items`` → ``ocr_done``; hata → ``failed`` + alarm; tavan →
    ``deferred`` (``uploaded`` kalır)."""
    sid = str(source["id"])
    result = IngestResult(source_id=sid, status="failed", year=int(source["year"]), term=source.get("term"))
    try:
        course = course_by_id(rt.db, str(source["course_id"]))
        if pdf_bytes is None:
            _fixture_pdf_alias(rt, source)
            bucket, path = split_storage_path(source["storage_path"])
            pdf_bytes = rt.storage.download(bucket, path)
        rendered = render_pages(pdf_bytes)
        items = ocr_extract(rt, rendered.pages, source_meta(source), name_hashes=name_hashes)
        count, warnings = store_items(rt, source, course, items, name_hashes=name_hashes)
    except (OgrError, ValueError) as exc:
        message = getattr(exc, "message", None) or str(exc)
        if _is_cap_block(exc):
            defer_source(rt, source, message)
            result.status, result.error = "deferred", message
            return result
        mark_failed(rt, source, message)
        result.error = message
        return result
    except Exception as exc:  # noqa: BLE001 - son kemer: tek bozuk kaynak kuyruğu durduramaz
        message = f"OGR-KALEM-011 beklenmeyen hata: {type(exc).__name__}"
        mark_failed(rt, source, message)
        result.error = message
        return result
    update_minimal(rt.db, "exam_sources", {"status": "ocr_done", "error": None}, where={"id": sid})
    result.status, result.items, result.warnings = "ocr_done", count, warnings
    return result


def ingest_source(rt: Any, source_id: str, *, name_hashes: Sequence[str] = ()) -> IngestResult:
    rows = rt.db.select("exam_sources", where={"id": source_id}, limit=1)
    if not rows:
        raise KalemError(f"OGR-KALEM-002 sınav kaynağı bulunamadı: {source_id}")
    return process_source(rt, rows[0], name_hashes=name_hashes)


def ingest_queue(rt: Any, *, limit: int = DEFAULT_QUEUE_LIMIT, name_hashes: Sequence[str] = ()) -> list[IngestResult]:
    """``status='uploaded'`` kaynaklar ``created_at`` sırasıyla; biri tavana takılırsa kalanlar çağrı yapılmadan
    ertelenir (aynı gece tavan açılmaz)."""
    rows = rt.db.select("exam_sources", where={"status": "uploaded"}, order=["created_at", "id"], limit=limit)
    results: list[IngestResult] = []
    blocked: str | None = None
    for row in rows:
        if blocked is not None:
            results.append(IngestResult(source_id=str(row["id"]), status="deferred", year=int(row["year"]),
                                        term=row.get("term"), error=f"önceki kaynak tavana takıldı ({blocked})"))
            continue
        res = process_source(rt, row, name_hashes=name_hashes)
        if res.status == "deferred":
            blocked = res.error
        results.append(res)
    return results


def ingest_pdf(rt: Any, pdf: Path, *, course_code: str, year: int, term: str, legal_basis: str,
               instructor_alias: str | None = None, uploaded_by: str | None = None,
               name_hashes: Sequence[str] = ()) -> IngestResult:
    """Yerel PDF: ``exams/<id>.pdf``'e yükle, ``exam_sources`` satırını aç, ortak gövdeyi çalıştır."""
    if term not in TERMS:
        raise KalemError(f"OGR-KALEM-011 dönem {', '.join(TERMS)} değerlerinden biri olmalı: {term}")
    if legal_basis not in LEGAL_BASES:
        raise KalemError("OGR-KALEM-011 hukuki dayanak şu üçünden biri olmalı: " + " | ".join(LEGAL_BASES))
    if instructor_alias is not None and not ALIAS_RE.match(instructor_alias):
        raise KalemError("OGR-KALEM-011 eğitmen takma adı hoca-A … hoca-Z biçiminde olmalı (gerçek ad girilmez)")
    path = Path(pdf)
    if not path.is_file():
        raise KalemError(f"OGR-KALEM-011 PDF dosyası yok: {path}")
    data = path.read_bytes()
    inspect_pdf(data)  # bozuk/çok büyük PDF için satır açılmadan dur (render yok; render ortak gövdede bir kez)
    course = course_by_code(rt.db, course_code)
    sid = stable_uuid("exam_source", course["id"], int(year), term, sha256_hex(data))
    storage_path = f"{EXAMS_BUCKET}/{sid}.pdf"
    try:
        rt.storage.upload(EXAMS_BUCKET, f"{sid}.pdf", data, content_type="application/pdf")
    except OgrError as exc:
        raise KalemError("OGR-KALEM-011 PDF exams kovasına yüklenemedi (" + exc.message + "); PDF'i panel /oncelik "
                         "'Arşiv yükle' ile yükle ve 'kalem ingest --source <uuid>' çalıştır") from exc
    existing = rt.db.select("exam_sources", where={"id": sid}, limit=1)
    if existing:
        source = existing[0]
    else:
        source = {"id": sid, "course_id": str(course["id"]), "year": int(year), "term": term,
                  "instructor_alias": instructor_alias, "storage_path": storage_path, "legal_basis": legal_basis,
                  "uploaded_by": uploaded_by, "status": "uploaded"}
        insert_minimal(rt.db, "exam_sources", source)
    return process_source(rt, source, pdf_bytes=data, name_hashes=name_hashes)


# --- dry-run: OCR çıktısını yeniden oynatma -------------------------------------------------------


def replay_ocr_fixtures(rt: Any, course: Mapping[str, Any], sources: Sequence[Mapping[str, Any]]) -> int:
    """Yalnız sahte kipte: maddesi olmayan kaynaklar için ``<fixtures>/ocr-*.json`` (``exam-item`` dizisi,
    OCR zincirinin çıktısıyla aynı sözleşme) ``store_items`` ile yazılır; ``uploaded``/``failed`` kaynak
    ``ocr_done`` olur. Döner: yazılan madde sayısı."""
    if not (rt.is_fake and rt.fixtures is not None and Path(rt.fixtures).is_dir()):
        return 0
    by_id = {str(s["id"]): s for s in sources}
    with_items = {str(r["source_id"]) for r in select_in(rt.db, "exam_items", "source_id", list(by_id),
                                                         columns=("source_id",))}
    total = 0
    for path in sorted(Path(rt.fixtures).glob("ocr-*.json")):
        data = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(data, list):
            continue
        groups: dict[str, list[dict]] = {}
        for item in data:
            if isinstance(item, dict) and str(item.get("source_id")) in by_id:
                groups.setdefault(str(item["source_id"]), []).append(item)
        for sid, raw in sorted(groups.items()):
            if sid in with_items:
                continue
            source = by_id[sid]
            items = validate_items(apply_source_meta(raw, source_meta(source)))
            count, _ = store_items(rt, source, course, items)
            total += count
            with_items.add(sid)
            if source.get("status") in ("uploaded", "failed"):
                update_minimal(rt.db, "exam_sources", {"status": "ocr_done", "error": None}, where={"id": sid})
            print(f"dry-run: {path.name} OCR çıktısı olarak yeniden oynatıldı ({count} madde, "
                  f"{source['year']}/{source.get('term')})", file=sys.stderr)
    return total
