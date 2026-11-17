"""Şablon stoku: ``register_template_question`` RPC'si üzerinden kayıt ve ``--fill --min-stock`` (§6.1, #53).

Kurallar:

* Veritabanına **yalnız** ``register_template_question(p_item, p_key, p_figure)`` RPC'si ile yazılır; ``questions``,
  ``figures`` ve ``secure.answer_keys`` tablolarına doğrudan yazım yoktur (``batch_worker`` onaylı soru ve
  doğrulanmış şekil sütunlarını zaten yazamaz). Okuma: ``question_templates`` (enabled) ve ``questions``
  (``template_id``, ``status``, ``content_hash``).
* Stok = şablonun ``status='approved'`` soru sayısı. Stok ``min_stock``'un altındaysa fark kadar yeni varyant
  kaydedilir; stok yetiyorsa şablon atlanır (``status='full'``).
* ``content_hash`` çakışmaları atlanır: veritabanında aynı şablonun aynı hash'li sorusu varsa varyant RPC'ye hiç
  gitmez; RPC ``null`` dönerse (başka kaynaktan aynı hash) de atlanır. İkisi de ``skipped_hash_collision``'a yazılır.
* Şablon başına rastgele akış ``random.Random(f"{seed}:{template_id}")``: aynı tohum ve aynı veritabanı → aynı
  sonuç. Ertesi gece aynı akış baştan okunur, kayıtlı varyantlar hash ile atlanır ve stok kaldığı yerden dolar.
* Şekil nesneleri içerik adreslidir (``figures/<code_hash>.png``): her nesne en çok bir kez yüklenir. Önce bu
  çalışmada yüklenenler, sonra ``storage.exists`` (HEAD) bakılır; nesne varsa yükleme atlanır (aynı kod → aynı bayt).
  ``figures`` kovasında ``batch_worker``'ın yalnız INSERT politikası vardır (0017_storage.sql); var olan nesnenin
  üstüne yazmak reddedilir, doğrulanmış şeklin dosyası da yeniden yazılmaz.
* Hata yalıtımı: bir şablonda RPC/şablon/depolama/okuma hatası (``OgrError``; depodan kaçan ``httpx.HTTPError``
  ``OGR-STO-001``'e çevrilir) o şablonu ``status='error'`` yapar, diğer şablonlar sürer.
* LLM çağrısı yoktur; ``template_fill.json`` ``llm_calls: 0`` yazar.
"""

from __future__ import annotations

import random
from collections.abc import Iterable, Iterator
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

import httpx
from ogrenmen_common.errors import OgrError, StorageError

from . import templates as T

RPC_NAME = "register_template_question"
FILL_MIN_ATTEMPTS = 100
"""Eksik her soru için en çok ``templates.ATTEMPTS_PER_VARIANT`` varyant denenir; şablon başına en az bu kadar."""

RECOVERABLE = (OgrError, httpx.HTTPError)
"""Şablon başına yakalanan hatalar: o şablon ``error`` olur, çalışma sürer."""


@dataclass
class TemplateResult:
    """Bir şablonun kayıt özeti (``template_fill.json`` satırı)."""

    template_id: str
    skill_id: str | None = None
    has_figure: bool | None = None
    stock_before: int = 0
    target: int = 0
    deficit: int = 0
    registered: int = 0
    skipped_hash_collision: int = 0
    attempts: int = 0
    stock_after: int = 0
    status: str = "pending"
    """``filled`` | ``full`` (stok yeterli, atlandı) | ``exhausted`` (yeterli farklı varyant çıkmadı) |
    ``unknown_template`` (kayıtta yok, atlandı) | ``partial`` (``--auto-approve``: bazı varyantlar zaten vardı) |
    ``error`` (RPC/şablon/depolama/okuma hatası ya da ``question_templates`` satırı modülle uyuşmuyor)."""
    question_ids: list[str] = field(default_factory=list)
    figures: list[str] = field(default_factory=list)
    figures_uploaded: int = 0
    figures_reused: int = 0
    warnings: list[str] = field(default_factory=list)
    error: str | None = None


def approved_stock(db: Any, template_id: str) -> int:
    rows = db.select("questions", where={"template_id": template_id, "status": "approved"}, columns=["id"])
    return len(rows)


def existing_hashes(db: Any, template_id: str) -> set[str]:
    rows = db.select("questions", where={"template_id": template_id}, columns=["content_hash"])
    return {r["content_hash"] for r in rows if r.get("content_hash")}


def enabled_templates(db: Any) -> list[dict[str, Any]]:
    rows = db.select("question_templates", where={"enabled": True},
                     columns=["id", "skill_id", "module_path", "has_figure", "enabled"], order="id")
    return rows


class FigureUploader:
    """``figures`` kovasına içerik adresli yükleme: her ``<code_hash>.png`` en çok bir kez yüklenir.

    ``ensure`` önce bu çalışmada görülen adlara, sonra ``storage.exists`` (HEAD; kova herkese açık okunur) sonucuna
    bakar; nesne varsa yükleme yapılmaz (aynı şekil kodu aynı baytı verir, üstüne yazmak politikada yoktur).
    Depodan kaçan ağ hataları (``httpx.HTTPError``) ``StorageError('OGR-STO-001 …')`` olur.
    """

    def __init__(self, storage: Any):
        self.storage = storage
        self.present: set[str] = set()
        self.uploaded: list[str] = []
        self.reused: list[str] = []

    def ensure(self, name: str, data_path: Path) -> bool:
        """Nesneyi gerekirse yükler; yüklendiyse ``True``, zaten varsa ``False``."""
        if name in self.present:
            self.reused.append(name)
            return False
        try:
            if self.storage.exists(T.FIGURE_BUCKET, name):
                self.present.add(name)
                self.reused.append(name)
                return False
            self.storage.upload(T.FIGURE_BUCKET, name, Path(data_path).read_bytes(), content_type="image/png")
        except httpx.HTTPError as exc:
            raise StorageError(f"OGR-STO-001 depoya ulaşılamadı ({T.FIGURE_BUCKET}/{name}): {exc}") from exc
        self.present.add(name)
        self.uploaded.append(name)
        return True


def register_variant(db: Any, uploader: FigureUploader, variant: T.Variant, figures_dir: Path,
                     result: TemplateResult | None = None) -> str | None:
    """Şekli çizer ve (yoksa) depoya yükler, sonra tek RPC çağrısı yapar; yeni soru kimliği ya da çakışmada
    ``None``."""
    if variant.figure is not None:
        if variant.render_info is None:
            variant.render(figures_dir)
        fresh = uploader.ensure(variant.png_name, Path(figures_dir) / variant.png_name)
        if result is not None:
            if fresh:
                result.figures_uploaded += 1
            else:
                result.figures_reused += 1
    result_id = db.rpc(RPC_NAME, variant.rpc_params())
    if isinstance(result_id, list):  # PostgREST bazı sürümlerde skaler dönüşü diziyle sarar
        result_id = result_id[0] if result_id else None
    return str(result_id) if result_id else None


Sink = list[tuple[str, T.Variant]] | None
"""Kaydedilen ``(soru_id, varyant)`` çiftlerinin toplandığı isteğe bağlı liste (gerçek kipte questions.jsonl için)."""


def _register_stream(db: Any, uploader: FigureUploader, result: TemplateResult, stream: Iterable[T.Variant],
                     need: int, skip: set[str], figures_dir: Path, sink: Sink = None) -> None:
    for variant in stream:
        if result.registered >= need:
            break
        result.attempts += 1
        if variant.content_hash in skip:
            result.skipped_hash_collision += 1
            continue
        skip.add(variant.content_hash)
        qid = register_variant(db, uploader, variant, figures_dir, result)
        if qid is None:
            result.skipped_hash_collision += 1
            continue
        result.registered += 1
        result.question_ids.append(qid)
        if sink is not None:
            sink.append((qid, variant))
        if variant.png_name:
            result.figures.append(variant.png_name)


def _error_message(exc: BaseException) -> str:
    if isinstance(exc, OgrError):
        return exc.message
    return f"OGR-STO-001 beklenmeyen ağ hatası: {exc}"


def _finish_stock(db: Any, result: TemplateResult) -> None:
    """Hata yolunda son stoku okumayı dener; okunamazsa tahmini yazar ve uyarır (özet yine yazılır)."""
    try:
        result.stock_after = approved_stock(db, result.template_id)
    except RECOVERABLE as exc:
        result.stock_after = result.stock_before + result.registered
        result.warnings.append(f"son stok okunamadı, tahmin yazıldı: {_error_message(exc)}")


def check_template_row(row: dict[str, Any], result: TemplateResult) -> str | None:
    """``question_templates`` satırını içerik modülüyle karşılaştırır; skip gerektiren uyuşmazlıkta mesaj döner.

    * ``has_figure`` modülün ``HAS_FIGURE``'ından farklıysa → hata (şekil kapısı yanlış işler).
    * ``skill_id`` modülün ürettiği kazanımlarda (``covered_skills``) yoksa → hata: RPC soruyu ``p_item.skill_ids``
      altına yazar, satır başka bir kazanımı söyler.
    * ``skill_id`` ikincil kazanımsa (§10.4 çift kazanımlı şablon) → uyarı.
    * ``module_path`` beklenenden farklıysa → uyarı (kod yine içerik kaydından yüklenir).
    """
    tid = row["id"]
    module = T.load_template(tid)
    expected = T.module_path(tid)
    if row.get("module_path") and row["module_path"] != expected:
        result.warnings.append(f"module_path {row['module_path']} beklenen {expected} değil; "
                               "içerik kaydındaki modül kullanıldı")
    if "has_figure" in row and row["has_figure"] is not None and bool(row["has_figure"]) != bool(module.HAS_FIGURE):
        return (f"OGR-TPL-005 {tid}: question_templates.has_figure={row['has_figure']} ama şablon modülü "
                f"HAS_FIGURE={module.HAS_FIGURE}; şablon atlandı")
    skill = row.get("skill_id")
    if skill and skill != module.SKILL_ID:
        covered = T.covered_skills(tid)
        if skill not in covered:
            return (f"OGR-TPL-004 {tid}: question_templates.skill_id={skill} şablonun ürettiği kazanımlarda yok "
                    f"({', '.join(sorted(covered))}); şablon atlandı")
        result.warnings.append(f"question_templates.skill_id={skill} şablonun ana kazanımı {module.SKILL_ID} değil "
                               "(ikincil kazanım); sorular maddedeki skill_ids altına yazılır")
    return None


def fill_template(db: Any, uploader: FigureUploader, row: dict[str, Any], *, min_stock: int, seed: int,
                  figures_dir: Path, sink: Sink = None) -> TemplateResult:
    tid = row["id"]
    result = TemplateResult(template_id=tid, skill_id=row.get("skill_id"), has_figure=row.get("has_figure"),
                            target=min_stock)
    if tid not in T.template_ids():
        result.status = "unknown_template"
        result.warnings.append(f"{tid} içerik şablon kaydında yok; atlandı")
        return result
    try:
        mismatch = check_template_row(row, result)
        if mismatch is not None:
            result.status = "error"
            result.error = mismatch
            return result
        result.stock_before = approved_stock(db, tid)
        result.deficit = max(0, min_stock - result.stock_before)
        if result.deficit == 0:
            result.status = "full"
            result.stock_after = result.stock_before
            return result
        rng = random.Random(f"{seed}:{tid}")
        attempts = max(FILL_MIN_ATTEMPTS, result.deficit * T.ATTEMPTS_PER_VARIANT)
        stream = T.iter_variants(tid, rng, max_attempts=attempts)
        _register_stream(db, uploader, result, stream, result.deficit, existing_hashes(db, tid), figures_dir, sink)
        result.stock_after = approved_stock(db, tid)
    except RECOVERABLE as exc:
        result.status = "error"
        result.error = _error_message(exc)
        _finish_stock(db, result)
        return result
    result.status = "filled" if result.registered >= result.deficit else "exhausted"
    if result.status == "exhausted":
        result.warnings.append(f"{result.attempts} denemede yalnız {result.registered}/{result.deficit} farklı "
                               "varyant çıktı")
    return result


def summarize(results: list[TemplateResult], **meta: Any) -> dict[str, Any]:
    totals = {
        "templates": len(results),
        "filled": sum(1 for r in results if r.status == "filled"),
        "partial": sum(1 for r in results if r.status == "partial"),
        "full": sum(1 for r in results if r.status == "full"),
        "exhausted": sum(1 for r in results if r.status == "exhausted"),
        "unknown_template": sum(1 for r in results if r.status == "unknown_template"),
        "errors": sum(1 for r in results if r.status == "error"),
        "registered": sum(r.registered for r in results),
        "skipped_hash_collision": sum(r.skipped_hash_collision for r in results),
        "figures_uploaded": sum(r.figures_uploaded for r in results),
        "figures_reused": sum(r.figures_reused for r in results),
        "rpc": RPC_NAME,
    }
    return {**meta, "llm_calls": 0, "totals": totals, "templates": [asdict(r) for r in results]}


def iter_fill(db: Any, storage: Any, *, min_stock: int, seed: int, figures_dir: Path,
              only: str | None = None, sink: Sink = None) -> Iterator[TemplateResult]:
    """Her ``enabled`` şablon için stoku ``min_stock``'a tamamlar; sonuçları şablon şablon verir.

    Tek bir ``FigureUploader`` tüm şablonlarda paylaşılır (aynı şekil nesnesi çalışma boyunca bir kez yüklenir).
    """
    if min_stock < 1:
        raise T.TemplateError("OGR-TPL-006 --min-stock en az 1 olmalı")
    rows = enabled_templates(db)
    if only is not None:
        rows = [r for r in rows if r["id"] == only]
        if not rows:
            raise T.TemplateError(f"OGR-TPL-002 şablon yok ya da kapalı: {only}")
    uploader = FigureUploader(storage)
    for row in rows:
        yield fill_template(db, uploader, row, min_stock=min_stock, seed=seed, figures_dir=figures_dir, sink=sink)


def fill_stock(db: Any, storage: Any, *, min_stock: int, seed: int, figures_dir: Path,
               only: str | None = None, sink: Sink = None) -> list[TemplateResult]:
    """``iter_fill``'in liste hâli (``only`` verilirse yalnız o şablon)."""
    return list(iter_fill(db, storage, min_stock=min_stock, seed=seed, figures_dir=figures_dir, only=only,
                          sink=sink))


def auto_approve(db: Any, storage: Any, variants: list[T.Variant], *, figures_dir: Path,
                 sink: Sink = None) -> TemplateResult:
    """``template --id … --auto-approve``: üretilen varyantları RPC ile kaydeder; çakışanları atlar."""
    first = variants[0]
    result = TemplateResult(template_id=first.template_id, skill_id=first.skill_id,
                            has_figure=first.figure is not None, target=len(variants), deficit=len(variants))
    uploader = FigureUploader(storage)
    try:
        result.stock_before = approved_stock(db, first.template_id)
        _register_stream(db, uploader, result, variants, len(variants), existing_hashes(db, first.template_id),
                         figures_dir, sink)
        result.stock_after = approved_stock(db, first.template_id)
    except RECOVERABLE as exc:
        result.status = "error"
        result.error = _error_message(exc)
        _finish_stock(db, result)
        return result
    result.status = "filled" if result.registered == len(variants) else "partial"
    return result
