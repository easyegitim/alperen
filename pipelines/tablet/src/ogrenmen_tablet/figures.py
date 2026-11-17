"""LLM şekilleri: kayıt (``figures`` + Storage), vision denetimi, ``render --queue|--fixtures`` ve ``vision --queue``.

* Kimlik içerik adreslidir: ``figures.code_hash = sha256(code)``, ``figures.id = uuid5(NAMESPACE_OGRENMEN,
  "llm-figure:<code_hash>")``; PNG Storage'da ``figures/<id>.png`` (§3.4 sütun yorumu), SVG varsa ``figures/<id>.svg``.
* ``batch_worker`` ``figures`` tablosunda ``review_status``/``reviewed_*`` yazamaz (§3.8): bu modül yalnız render ve
  vision sütunlarını yazar; ``review_status`` varsayılan ``pending`` kalır (eğitmen kuyruğu).
* Vision (§6.1): zincir ``vision_check`` (``Runtime.vision`` → ``CostLedger``); PNG + kök + ``stem_values`` →
  ``figure-render-report``. ``mismatch`` → ``attempts + 1`` ve LLM'e "kodu düzelt" (``question_gen`` zinciri) ile yeni
  şekil; 2 denemeden sonra eğitmen kuyruğu. Tavan engeli → ``vision_status='pending'`` (``vision --queue`` sonra dener).
* ``vision --queue`` yalnız ``draft``/``pending_review`` sorunun şeklini düzeltir; ``approved``/``retired``/``rejected``
  soruda yalnız ``figures.vision_status``/``vision_report`` yazılır (LLM'e düzeltme istenmez, soru değişmez).
  Düzeltmede eski şekil satırı yerinde kalır (``batch_worker`` ``review_status`` yazamaz); sonuçta
  ``superseded_figure_id`` olarak raporlanır ve hiçbir soruya bağlı olmadığı için kuyruk sayımına girmez.
"""

from __future__ import annotations

import hashlib
import json
import uuid
from collections.abc import Mapping
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import ogrenmen_contracts as contracts
from ogrenmen_common.adapters.base import LLMRequest, insert_minimal, update_minimal
from ogrenmen_common.clock import iso
from ogrenmen_common.errors import LedgerError, OgrError, StorageError

from . import prompts as P
from . import sandbox as S
from . import verify as V
from .shared import MAX_ATTEMPTS, NAMESPACE_OGRENMEN

FIGURE_BUCKET = "figures"
EDITABLE_STATUSES = ("draft", "pending_review")
"""``batch_worker``'ın (RLS ``questions_batch_u``, OGR-Q-006) düzenleyebildiği soru durumları."""
RENDER_SUFFIXES = {".py": "matplotlib", ".svg": "svg", ".tex": "tikz", ".dot": "graphviz", ".vl.json": "vega-lite"}


def code_hash(code: str) -> str:
    return hashlib.sha256(code.encode("utf-8")).hexdigest()


def figure_id_for(chash: str) -> str:
    return str(uuid.uuid5(NAMESPACE_OGRENMEN, f"llm-figure:{chash}"))


def storage_name(path: str | None) -> str | None:
    """``figures/<id>.png`` → kova içindeki ad (``<id>.png``)."""
    if not path:
        return None
    return path.split("/", 1)[1] if path.startswith(f"{FIGURE_BUCKET}/") else path


@dataclass
class VisionOutcome:
    status: str
    """``match`` | ``mismatch`` | ``pending`` (çağrı yapılamadı) | ``skipped`` (render yok)"""
    report: dict[str, Any] | None = None
    error: str | None = None

    @property
    def mismatches(self) -> list[Any]:
        return list((self.report or {}).get("mismatches") or [])


def vision_check(rt: Any, render: S.RenderResult, item: Mapping[str, Any]) -> VisionOutcome:
    """Render edilmiş şekli vision zincirine sorar; tavan/ sağlayıcı hatası ``pending`` döner (iş durmaz)."""
    if not render.ok or render.png is None:
        return VisionOutcome("skipped")
    figure = item.get("figure") or {}
    try:
        data = rt.vision.check_figure(render.png, stem=P.scrub(str(item.get("stem", ""))),
                                      stem_values=dict(item.get("stem_values") or {}),
                                      alt_text=P.scrub(str(figure.get("alt_text", ""))))
    except LedgerError as exc:
        return VisionOutcome("pending", error=exc.message)
    report = dict(data)
    report["render"] = render.report()
    status = report.get("status") or ("match" if report.get("matches_stem") else "mismatch")
    report["status"] = status
    problems = contracts.errors("figure-render-report", report)
    if problems:
        return VisionOutcome("pending", error="vision raporu şemaya uymuyor: " + problems[0].message)
    return VisionOutcome(status, report=report)


def upload_render(storage: Any, fid: str, render: S.RenderResult) -> tuple[str | None, str | None]:
    """PNG (ve varsa SVG) ``figures`` kovasına; ``(png_path, svg_path)``. Nesne zaten varsa yeniden yüklenmez."""
    png_path = svg_path = None
    try:
        if render.png is not None and render.ok:
            name = f"{fid}.png"
            if not storage.exists(FIGURE_BUCKET, name):
                storage.upload(FIGURE_BUCKET, name, render.png, content_type="image/png")
            png_path = f"{FIGURE_BUCKET}/{name}"
        if render.svg is not None:
            name = f"{fid}.svg"
            if not storage.exists(FIGURE_BUCKET, name):
                storage.upload(FIGURE_BUCKET, name, render.svg, content_type="image/svg+xml")
            svg_path = f"{FIGURE_BUCKET}/{name}"
    except OgrError:
        raise
    except Exception as exc:  # noqa: BLE001 - httpx/OSError → tek tip depolama hatası
        raise StorageError(f"OGR-STO-001 şekil deposuna yüklenemedi ({fid}): {exc}") from exc
    return png_path, svg_path


def figure_row(fid: str, figure: Mapping[str, Any], render: S.RenderResult | None, vision: VisionOutcome | None,
               attempts: int, png_path: str | None, svg_path: str | None) -> dict[str, Any]:
    """``figures`` satırı (yalnız ``batch_worker``'ın INSERT yetkisindeki sütunlar)."""
    code = str(figure["code"])
    row: dict[str, Any] = {
        "id": fid, "tool": figure["tool"], "code": code, "code_hash": code_hash(code),
        "alt_text": figure["alt_text"], "png_path": png_path, "svg_path": svg_path,
        "width_px": render.width_px if render else None, "height_px": render.height_px if render else None,
        "bytes": render.bytes if render else None,
        "render_status": render.render_status if render else "pending",
        "vision_status": (vision.status if vision and vision.status in ("match", "mismatch") else
                          ("skipped" if render is not None and not render.ok else "pending")),
        "vision_report": vision.report if vision else None,
        "attempts": int(attempts),
        "render_log": (render.log[-4000:] if render and render.log else None),
    }
    return row


def store_figure(rt: Any, figure: Mapping[str, Any], render: S.RenderResult | None, vision: VisionOutcome | None,
                 attempts: int) -> str:
    """Şekil satırını yazar (ya da aynı ``code_hash``'li satırı yeniden kullanır); ``figures.id`` döner."""
    chash = code_hash(str(figure["code"]))
    existing = rt.db.select("figures", where={"code_hash": chash}, columns=["id"])
    if existing:
        return str(existing[0]["id"])
    fid = figure_id_for(chash)
    png_path, svg_path = upload_render(rt.storage, fid, render) if render is not None else (None, None)
    insert_minimal(rt.db, "figures", figure_row(fid, figure, render, vision, attempts, png_path, svg_path))
    return fid


# --- render --queue / --fixtures ----------------------------------------------------------------------


@dataclass
class QueueResult:
    figure_id: str
    status: str
    detail: str | None = None
    attempts: int = 0
    question_id: str | None = None
    extra: dict[str, Any] = field(default_factory=dict)


def render_queue(rt: Any, *, limit: int | None = None) -> list[QueueResult]:
    """``figures.render_status='pending'`` satırlarını sandbox'ta çizer, PNG'yi yükler, sütunları günceller."""
    rows = rt.db.select("figures", where={"render_status": "pending"}, order="created_at", limit=limit)
    results: list[QueueResult] = []
    for row in rows:
        fid = str(row["id"])
        if row.get("tool") == "template":
            results.append(QueueResult(fid, "skipped", "şablon şekli bu kuyruğa girmez"))
            continue
        render = S.render(str(row["tool"]), str(row["code"]))
        attempts = int(row.get("attempts") or 0) + 1
        try:
            png_path, svg_path = upload_render(rt.storage, fid, render)
        except OgrError as exc:
            results.append(QueueResult(fid, "error", exc.message, attempts))
            continue
        values = {"render_status": render.render_status, "png_path": png_path, "svg_path": svg_path,
                  "width_px": render.width_px, "height_px": render.height_px, "bytes": render.bytes,
                  "render_log": render.log[-4000:] or None, "vision_status": render.vision_default,
                  "attempts": attempts}
        update_minimal(rt.db, "figures", values, where={"id": fid})
        results.append(QueueResult(fid, render.status, render.log.splitlines()[0] if render.log else None, attempts))
    return results


def tool_for(path: Path) -> str | None:
    name = path.name.lower()
    for suffix, tool in sorted(RENDER_SUFFIXES.items(), key=lambda kv: -len(kv[0])):
        if name.endswith(suffix):
            return tool
    return None


def render_fixtures(folder: Path, out: Path) -> list[dict[str, Any]]:
    """Dizindeki her şekil kaynağını (``.py``, ``.svg``, ``.tex``, ``.dot``, ``.vl.json``) çizer ve raporlar;
    geçen PNG'ler ``out/render/<ad>.png``'ye yazılır."""
    folder = Path(folder)
    if not folder.is_dir():
        raise OgrError(f"OGR-ADP-002 şekil dizini yok: {folder}")
    target = out / "render"
    target.mkdir(parents=True, exist_ok=True)
    report: list[dict[str, Any]] = []
    for path in sorted(folder.iterdir()):
        tool = tool_for(path)
        if tool is None or not path.is_file():
            continue
        render = S.render(tool, path.read_text(encoding="utf-8"))
        entry = {"file": path.name, "tool": tool, "status": render.status, "render_status": render.render_status,
                 "vision": render.vision_default, "report": render.report()}
        if render.ok and render.png is not None:
            png = target / (path.name.split(".")[0] + ".png")
            png.write_bytes(render.png)
            entry["png"] = str(png)
        report.append(entry)
    return report


# --- vision --queue --------------------------------------------------------------------------------


def _question_for(db: Any, fid: str) -> dict[str, Any] | None:
    """Şekle bağlı soru; birden çoksa düzenlenebilir (``draft``/``pending_review``) olan önce."""
    rows = [dict(r) for r in db.select("questions", where={"figure_id": fid},
                                       columns=["id", "stem", "stem_values", "kind", "options", "skill_ids", "status",
                                                "source", "verification", "curriculum_id", "content_hash"])]
    if not rows:
        return None
    return next((r for r in rows if r.get("status") in EDITABLE_STATUSES), rows[0])


def _item_view(question: Mapping[str, Any], figure: Mapping[str, Any]) -> dict[str, Any]:
    return {"stem": question.get("stem", ""), "stem_values": question.get("stem_values") or {},
            "figure": {"tool": figure.get("tool"), "code": figure.get("code"), "alt_text": figure.get("alt_text")}}


def _download_render(rt: Any, row: Mapping[str, Any]) -> S.RenderResult:
    name = storage_name(row.get("png_path"))
    if not name:
        return S.RenderResult(status="failed", tool=str(row.get("tool")), log="png_path yok")
    data = rt.storage.download(FIGURE_BUCKET, name)
    return S.apply_png_check(S.RenderResult(status=S.STATUS_OK, tool=str(row.get("tool")), png=data))


def _set_verification(rt: Any, question: Mapping[str, Any], **changes: Any) -> None:
    verification = dict(question.get("verification") or {})
    verification.update(changes)
    update_minimal(rt.db, "questions", {"verification": verification}, where={"id": question["id"]})


def request_fixed_figure(rt: Any, *, curriculum_code: str, question: Mapping[str, Any], figure: Mapping[str, Any],
                         mismatches: list[Any]) -> dict[str, Any] | None:
    """"Kodu düzelt": aynı soruyu düzeltilmiş şekil koduyla ister; geçerli yeni ``item.figure`` ya da ``None``."""
    prompt = P.figure_fix_prompt(curriculum_code=curriculum_code, item=_item_view(question, figure),
                                 code=str(figure.get("code", "")), mismatches=mismatches)
    req = LLMRequest(purpose="question_gen", model="", system=P.FIX_SYSTEM_PROMPT, prompt=prompt,
                     schema_id=V.ENVELOPE_SCHEMA, max_tokens=4096, temperature=0.2)
    try:
        result = rt.ledger.call("question_gen", req, ref_table="figures", ref_id=str(figure.get("id")))
    except LedgerError:
        return None
    new = (result.data or {}).get("item", {}).get("figure") if isinstance(result.data, Mapping) else None
    if not isinstance(new, Mapping) or not new.get("code") or new.get("code") == figure.get("code"):
        return None
    return dict(new)


def vision_queue(rt: Any, *, curriculum_code: str, limit: int | None = None) -> list[QueueResult]:
    """Render edilmiş, vision'ı bekleyen LLM şekilleri: denetim, uyuşmazlıkta düzeltme (en çok 2 deneme)."""
    rows = rt.db.select("figures", where={"render_status": "rendered", "vision_status": "pending"},
                        order="created_at", limit=limit)
    results: list[QueueResult] = []
    for row in rows:
        fid = str(row["id"])
        if row.get("tool") == "template":
            update_minimal(rt.db, "figures", {"vision_status": "not_applicable"}, where={"id": fid})
            results.append(QueueResult(fid, "not_applicable", "şablon şekli (deterministik kod)"))
            continue
        question = _question_for(rt.db, fid)
        if question is None:
            results.append(QueueResult(fid, "skipped", "şekle bağlı soru yok"))
            continue
        results.append(_vision_one(rt, dict(row), question, curriculum_code=curriculum_code))
    return results


def _vision_one(rt: Any, row: dict[str, Any], question: dict[str, Any], *, curriculum_code: str) -> QueueResult:
    fid = str(row["id"])
    attempts = int(row.get("attempts") or 0)
    try:
        render = _download_render(rt, row)
    except Exception as exc:  # noqa: BLE001 - depo hatası o şekli etkiler, kuyruk sürer
        return QueueResult(fid, "error", f"OGR-STO-001 PNG indirilemedi: {exc}", attempts, question["id"])
    outcome = vision_check(rt, render, _item_view(question, row))
    if outcome.status == "pending":
        return QueueResult(fid, "pending", outcome.error, attempts, question["id"])
    if question.get("status") not in EDITABLE_STATUSES:
        return _vision_record_only(rt, fid, outcome, render, attempts, question)
    if outcome.status == "skipped":
        update_minimal(rt.db, "figures", {"vision_status": "skipped", "render_log": render.log or None},
                       where={"id": fid})
        _set_verification(rt, question, vision="skipped")
        return QueueResult(fid, "skipped", render.log, attempts, question["id"])
    if outcome.status == "match":
        update_minimal(rt.db, "figures", {"vision_status": "match", "vision_report": outcome.report},
                       where={"id": fid})
        _set_verification(rt, question, vision="match")
        return QueueResult(fid, "match", None, attempts, question["id"])
    attempts += 1
    update_minimal(rt.db, "figures", {"vision_status": "mismatch", "vision_report": outcome.report,
                                      "attempts": attempts}, where={"id": fid})
    if attempts >= MAX_ATTEMPTS or question.get("source") != "llm":
        note = f"Şekil {attempts} denemede kökle uyuşmadı; eğitmen incelemesi gerekli"
        _set_verification(rt, question, vision="mismatch", attempts=min(3, attempts), review_note=note)
        return QueueResult(fid, "mismatch", note, attempts, question["id"])
    fixed = request_fixed_figure(rt, curriculum_code=curriculum_code, question=question, figure=row,
                                 mismatches=outcome.mismatches)
    if fixed is None:
        _set_verification(rt, question, vision="mismatch", attempts=min(3, attempts),
                          review_note="Şekil kökle uyuşmadı; düzeltilmiş kod alınamadı")
        return QueueResult(fid, "mismatch", "düzeltilmiş kod alınamadı", attempts, question["id"])
    new_render = S.render(str(fixed.get("tool", "matplotlib")), str(fixed["code"]),
                          expected_px=fixed.get("expected_px"))
    new_vision = vision_check(rt, new_render, {**_item_view(question, fixed)})
    try:
        new_fid = store_figure(rt, {"tool": fixed.get("tool", "matplotlib"), "code": fixed["code"],
                                    "alt_text": fixed.get("alt_text") or row.get("alt_text")},
                               new_render, new_vision, attempts)
    except OgrError as exc:
        return QueueResult(fid, "error", exc.message, attempts, question["id"])
    update_minimal(rt.db, "questions", {"figure_id": new_fid}, where={"id": question["id"]})
    linked = rt.db.select("questions", where={"id": question["id"]}, columns=["id", "figure_id"])
    if not linked or str(linked[0].get("figure_id")) != new_fid:  # RLS/OGR-Q-006: 0 satır güncellendi
        return QueueResult(fid, "error", "soru yeni şekle bağlanamadı (güncelleme satıra ulaşmadı)", attempts,
                           question["id"], extra={"orphan_figure_id": new_fid})
    final = new_vision.status if new_render.ok else "render_failed"
    note = None if final == "match" else f"Düzeltilmiş şekil: {final}; eğitmen incelemesi gerekli"
    _set_verification(rt, question, render=new_render.verification_render,
                      vision=new_vision.status if new_vision.status in ("match", "mismatch", "skipped") else "pending",
                      attempts=min(3, attempts + 1), review_note=note)
    return QueueResult(fid, "fixed" if final == "match" else final, note, attempts + 1, question["id"],
                       extra={"new_figure_id": new_fid, "superseded_figure_id": fid, "at": iso(rt.clock())})


def _vision_record_only(rt: Any, fid: str, outcome: VisionOutcome, render: S.RenderResult, attempts: int,
                        question: Mapping[str, Any]) -> QueueResult:
    """Düzenlenemeyen (onaylı/emekli) soru: yalnız şekil satırına vision sonucu; düzeltme ve soru yazımı yok."""
    values: dict[str, Any] = {"vision_status": outcome.status}
    if outcome.status == "skipped":
        values["render_log"] = render.log or None
    else:
        values["vision_report"] = outcome.report
    update_minimal(rt.db, "figures", values, where={"id": fid})
    detail = (f"soru {question.get('status')} durumunda; yalnız vision sonucu yazıldı, düzeltme istenmedi"
              if outcome.status == "mismatch" else None)
    return QueueResult(fid, outcome.status, detail, attempts, str(question["id"]))


def queue_summary(results: list[QueueResult]) -> dict[str, Any]:
    counts: dict[str, int] = {}
    for r in results:
        counts[r.status] = counts.get(r.status, 0) + 1
    return {"total": len(results), "by_status": dict(sorted(counts.items())),
            "items": [json.loads(json.dumps(r.__dict__, ensure_ascii=False, default=str)) for r in results]}
