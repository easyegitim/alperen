"""Ders boru hattı adımları (BLUEPRINT §6.3): ``register``, ``analyze``, ``transcribe-only``, ``frames-only``,
``purge``.

Kurallar:

* Kimlik: pipeline ``students.id`` ya da ad kullanmaz; öğrenci ``student_ref`` (``s_…``) ile, eğitmen
  ``public.staff.id`` ile anılır; ``public_ref → enrollment`` eşlemesi ``register_lesson`` RPC'sinin içindedir.
* Ham video Storage'a girmez; ``lessons.video_ref`` yalnız ``OGRENMEN_VIDEO_DIR``'e göreli yolu (``local:…``) ya da
  Drive kimliğini taşır. Mutlak yol ``public`` şemasına yazılmaz (klasör adları çoğu zaman öğrenci adıdır).
* Ad temizliği kapalı başarısızdır: dersin öğrencisine ait ``ÖĞRENCİ`` hash'i yoksa hiçbir model çağrısı yapılmaz.
* ``analyze`` ``observations`` YAZMAZ: ``write_lesson_analysis`` RPC'si ``lesson_analyses(draft)`` +
  ``lesson_claims(pending)`` yazar, onay panelden ``approve_lesson_analysis`` ile gelir.
* Maliyet: ``transcribe``, ``diarize``, ``lesson_analysis`` çağrıları ``CostLedger``'dan geçer (``llm_calls``,
  ``ref_table='lessons'``); bu amaçlar ``cap_excluded_purposes``'tadır, kapı ``check_spend(<amaç>)``'ın ders
  bütçesidir — sohbet tavanını doldurmaz ve ondan etkilenmez.
* Hata: ders ``status='failed'`` olur ve koordinatöre ``instructor_alerts(kind='ops')`` açılır; ses dosyası her
  durumda silinir (adım 7). Başarılı yeniden çalışma aynı dersin açık başarısızlık alarmını kapatır.
* Durum koruması: ``processing``, ``approved`` ya da ``corrected`` derste ``analyze`` ``--force`` olmadan reddedilir.
"""

from __future__ import annotations

import json
import re
import shutil
import tempfile
import uuid
from collections.abc import Mapping
from dataclasses import asdict, dataclass, field
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

from ogrenmen_common.adapters.base import insert_minimal, is_null, update_minimal
from ogrenmen_common.cli_base import warn, write_json
from ogrenmen_common.clock import ISTANBUL, iso, parse_ts
from ogrenmen_common.errors import DbError, OgrError
from ogrenmen_common.pii import name_leaks
from ogrenmen_common.runtime import Runtime

from . import analysis as A
from . import media as M
from . import transcript as T
from .errors import DersError

TRANSCRIPT_BUCKET = "transcripts"
LOCAL_PREFIX = "local:"
DRIVE_PREFIX = "drive:"
FAIL_DETAIL = "Ders analizi başarısız"
GUARDED_STATUSES = ("processing", "approved", "corrected")
"""Bu durumlardaki ders ``--force`` olmadan yeniden analiz edilmez (eşzamanlı çalışma ya da onaylı raporun geri
düşmesi)."""
UNEXPECTED = "beklenmeyen hata"
FAIL_REASONS = {
    "OGR-LLM-001": "model yanıtı alınamadı ya da şemaya uymadı",
    "OGR-LLM-002": "ders bütçesi tavanı ya da kapalı kip analizi durdurdu",
    "OGR-DERS-001": "girdi dosyası okunamadı",
    "OGR-DERS-003": "ad temizliği doğrulanamadı, istek gönderilmedi",
    "OGR-DERS-004": "ses ya da kare çıkarımı başarısız",
    "OGR-DERS-005": "analiz çıktısı ders bağlamına uymadı",
    "OGR-DERS-006": "yerel transkript motoru başarısız",
}


# --- yardımcılar --------------------------------------------------------------------------------


def parse_held_at(value: str) -> str:
    """``2026-10-20T18:00`` (saat dilimsiz) Europe/Istanbul yerel saati sayılır; çıktı UTC ISO (``…Z``)."""
    text = value.strip()
    try:
        parsed = datetime.fromisoformat(text[:-1] + "+00:00" if text.endswith(("Z", "z")) else text)
    except ValueError as exc:
        raise DersError(f"OGR-DERS-007 --held-at ISO biçiminde olmalı: {value}") from exc
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=ISTANBUL)
    return iso(parsed)


def parse_older_than(value: str) -> timedelta:
    m = re.fullmatch(r"\s*(\d+)\s*([dh])\s*", value or "")
    if not m:
        raise DersError(f"OGR-DERS-007 --older-than '<N>d' ya da '<N>h' olmalı: {value}")
    n = int(m.group(1))
    return timedelta(days=n) if m.group(2) == "d" else timedelta(hours=n)


def check_uuid(value: str, what: str) -> str:
    try:
        return str(uuid.UUID(str(value)))
    except ValueError as exc:
        raise DersError(f"OGR-DERS-007 {what} uuid olmalı: {value}") from exc


def video_ref_for(video: str, video_dir: Path | None) -> str:
    """``lessons.video_ref``: ``drive:<id>`` aynen; yerel dosya yalnız ``local:<video-dir'e göreli yol>``.

    Mutlak yol kaydedilmez: kurucunun klasör adları (``/Dersler/<öğrenci adı>/…``) ``public`` şemasına ve RPC
    kayıtlarına düz ad taşırdı (ilke 8). Dosya yüklenmez."""
    if video.startswith(DRIVE_PREFIX):
        if len(video) <= len(DRIVE_PREFIX):
            raise DersError("OGR-DERS-007 drive: kimliği boş")
        return video
    if video_dir is None:
        raise DersError("OGR-DERS-007 yerel video için --video-dir ya da OGRENMEN_VIDEO_DIR gerekli")
    base = Path(video_dir).expanduser()
    if not base.is_dir():
        raise DersError(f"OGR-DERS-001 video dizini yok: {base.name}")
    path = Path(video).expanduser()
    if not path.is_file():
        raise DersError(f"OGR-DERS-001 video dosyası yok: {path.name}")
    path, base = path.resolve(), base.resolve()
    if not path.is_relative_to(base):
        raise DersError("OGR-DERS-007 video --video-dir dışında; dosyayı video dizinine taşı (mutlak yol kaydedilmez)")
    return LOCAL_PREFIX + path.relative_to(base).as_posix()


def ref_name_leaks(video_ref: str, name_hashes: list[str]) -> list[str]:
    """``video_ref`` yol parçalarındaki ad tokenları (``elif_kaya/ders.mp4`` → ``elif``, ``kaya``)."""
    return name_leaks(re.sub(r"[\\/_.\-]+", " ", video_ref), name_hashes)


def resolve_video_ref(ref: str | None, video_dir: Path | None) -> Path | None:
    """``local:`` kaydını dosya yoluna çevirir; Drive ya da boş kayıt → ``None``."""
    if not ref or not ref.startswith(LOCAL_PREFIX):
        return None
    raw = ref[len(LOCAL_PREFIX):]
    path = Path(raw)
    if path.is_absolute():
        return path
    return (Path(video_dir).expanduser() / path) if video_dir is not None else None


def fixture_hint(video: Path) -> tuple[str, str | None]:
    """Sahte LLM'in dosya seçimi için ipucu (gerçek sağlayıcı yok sayar, istemde yer almaz): ``lesson-01`` →
    transkript ``01-lesson-01.json``, analiz ``01-analysis-01.json`` (``fixtures/ders`` adlandırması); diğer adlarda
    gövdenin kendisi (``mert`` → ``02-mert.json``). Eşleşme yoksa §2.3 hash kuralı geçerlidir."""
    stem = Path(video).stem
    return stem, (re.sub(r"^lesson-", "analysis-", stem) if stem.startswith("lesson-") else stem)


def get_lesson(rt: Runtime, lesson_id: str) -> dict:
    rows = rt.db.select("lessons", where={"id": check_uuid(lesson_id, "--lesson")}, limit=1)
    if not rows:
        raise DersError(f"OGR-DERS-002 ders bulunamadı: {lesson_id}")
    return rows[0]


def set_lesson(rt: Runtime, lesson_id: str, values: Mapping[str, Any]) -> None:
    """``batch_worker`` yalnız ``status, transcript_path, frames_count, video_deleted_at`` güncelleyebilir."""
    update_minimal(rt.db, "lessons", dict(values), where={"id": lesson_id})


def open_failure_alert(rt: Runtime, lesson: Mapping[str, Any], code: str | None) -> None:
    """Koordinatöre ops alarmı; aynı derste açık aynı alarm varsa yenisi açılmaz (``alerts_dedup``)."""
    reason = FAIL_REASONS.get(code or "", UNEXPECTED)
    detail = f"{FAIL_DETAIL}: {reason}"[:240]
    lesson_id = str(lesson["id"])
    try:
        existing = rt.db.select("instructor_alerts", where={"kind": "ops", "status": "open"})
    except DbError:
        existing = []
    for row in existing:
        if (row.get("ref") or {}).get("lesson_id") == lesson_id and str(row.get("detail", ""))[:24] == detail[:24]:
            return
    try:
        insert_minimal(rt.db, "instructor_alerts", {
            "kind": "ops", "severity": "warning", "student_id": None, "staff_id": None, "detail": detail,
            "since": iso(rt.clock()), "ref": {"lesson_id": lesson_id}})
    except DbError:
        return  # eşzamanlı açılmış aynı alarm (unique) — kayıp yok


# --- register -----------------------------------------------------------------------------------


def register(rt: Runtime, *, student_ref: str, staff_id: str, held_at: str, duration: int | None, video: str,
             video_dir: Path | None = None) -> str:
    """``register_lesson`` RPC → yeni ders uuid'si (``lessons(status='uploaded')``)."""
    if duration is not None and duration < 1:
        raise DersError("OGR-DERS-007 --duration en az 1 dakika")
    params = {"p_student_ref": student_ref, "p_staff_id": check_uuid(staff_id, "--staff-id"),
              "p_held_at": parse_held_at(held_at), "p_duration": duration,
              "p_video_ref": video_ref_for(video, video_dir)}
    lesson_id = check_uuid(str(rt.db.rpc("register_lesson", params)), "register_lesson yanıtı")
    if params["p_video_ref"].startswith(LOCAL_PREFIX):
        _, hashes = T.lesson_labels(rt, lesson_id)
        leaks = ref_name_leaks(params["p_video_ref"], hashes)
        if leaks:
            warn(f"video yolu {len(leaks)} ad tokenı içeriyor; ders kaydedildi, dosya ve klasör adlarını tarih ve ders "
                 "numarasıyla yeniden adlandır (ör. 2026-10-20-ders-01.mp4)")
    return lesson_id


# --- analyze ------------------------------------------------------------------------------------


@dataclass
class AnalyzeResult:
    lesson_id: str
    analysis_id: str | None = None
    status: str = "failed"
    frames: int = 0
    frame_method: str = "none"
    transcript_path: str | None = None
    segments: int = 0
    pii_replacements: int = 0
    lesson_cost_usd: float = 0.0
    error: str | None = None
    llm_purposes: list[str] = field(default_factory=list)

    def as_dict(self) -> dict:
        return asdict(self)


def _frames(rt: Runtime, video: Path, work: Path, fixtures: Path | None) -> M.FrameSelection:
    selection = M.extract_frames(video, work / "frames")
    if not selection.frames and rt.dry_run and fixtures is not None and (Path(fixtures) / "frames").is_dir():
        frames = M.fixture_frames(Path(fixtures) / "frames")
        return M.FrameSelection(frames=frames, method="fixtures", duration_sec=selection.duration_sec)
    return selection


def _transcribe(rt: Runtime, *, lesson: Mapping[str, Any], audio: Path, student_ref: str, labels: list[dict],
                name_hashes: list[str], payloads: T.PayloadLog, engine: str, hint: str | None) -> tuple[dict, int]:
    raw = T.transcribe_audio(rt, audio, lesson_id=str(lesson["id"]), student_ref=student_ref, labels=labels,
                             name_hashes=name_hashes, payloads=payloads, engine=engine, hint=hint)
    return T.clean_transcript(raw, labels, name_hashes)


def _store_transcript(rt: Runtime, lesson_id: str, transcript: Mapping[str, Any]) -> str:
    key = f"{lesson_id}.jsonl"
    rt.storage.upload(TRANSCRIPT_BUCKET, key, T.transcript_jsonl(transcript), content_type="application/x-ndjson")
    return f"{TRANSCRIPT_BUCKET}/{key}"


def _lesson_cost(rt: Runtime, lesson_id: str, start: int) -> tuple[float, list[str]]:
    calls = [c for c in rt.ledger.calls[start:] if c.get("ref_table") == "lessons" and c.get("ref_id") == lesson_id]
    return round(sum(float(c["cost_usd"]) for c in calls), 6), sorted({c["purpose"] for c in calls})


def _duration_min(lesson: Mapping[str, Any], seconds: float) -> int | None:
    if lesson.get("duration_min"):
        return int(lesson["duration_min"])
    return max(1, int(-(-seconds // 60))) if seconds > 0 else None


def resolve_failure_alerts(rt: Runtime, lesson_id: str) -> int:
    """Başarılı yeniden çalışmadan sonra aynı dersin açık ``Ders analizi başarısız`` ops alarmlarını kapatır
    (``batch_worker``: ``status, resolved_at`` güncellemesi)."""
    rows = rt.db.select("instructor_alerts", where={"kind": "ops", "status": "open"})
    done = 0
    for row in rows:
        if (row.get("ref") or {}).get("lesson_id") == lesson_id and str(row.get("detail", "")).startswith(FAIL_DETAIL):
            update_minimal(rt.db, "instructor_alerts", {"status": "done", "resolved_at": iso(rt.clock())},
                           where={"id": row["id"]})
            done += 1
    return done


def _mark_failed(rt: Runtime, lesson: Mapping[str, Any], code: str | None) -> None:
    """Hata kaydı; kendi hatası özgün hatayı gizlemesin diye ``DbError`` yutulur (uyarı yazılır)."""
    lid = str(lesson["id"])
    try:
        set_lesson(rt, lid, {"status": "failed"})
    except DbError as exc:
        warn(f"ders durumu 'failed' yazılamadı: {exc.message}")
    try:
        open_failure_alert(rt, lesson, code)
    except DbError as exc:
        warn(f"ops alarmı açılamadı: {exc.message}")


def analyze(rt: Runtime, *, lesson_id: str, video: Path, engine: str = "chain", fixtures: Path | None = None,
            out: Path | None = None, keep_work: bool = False, force: bool = False) -> AnalyzeResult:
    """§6.3 adım 1–7. Başarıda ``AnalyzeResult(status='analyzed')``; hatada ders ``failed`` + ops alarmı ve özgün
    hata yeniden yükselir (``ValueError`` → ``OGR-DERS-005``; ``result`` hata ayrıntısıyla
    ``out/ders_result.json``'a yazılır)."""
    lesson = get_lesson(rt, lesson_id)
    lid = str(lesson["id"])
    video = Path(video)
    if not video.is_file():
        raise DersError(f"OGR-DERS-001 video dosyası yok: {video.name}")
    if lesson.get("status") in GUARDED_STATUSES and not force:
        raise DersError(f"OGR-DERS-007 ders durumu '{lesson['status']}'; yeniden analiz için --force gerekli")
    ctx = A.load_context(rt, lesson)
    result = AnalyzeResult(lesson_id=lid)
    payloads = T.PayloadLog()
    start = len(rt.ledger.calls)
    work = Path(tempfile.mkdtemp(prefix="ogrenmen-ders-"))
    try:
        set_lesson(rt, lid, {"status": "processing"})
        labels, name_hashes = T.lesson_labels(rt, lid)
        T.require_student_labels(labels)                                        # kapalı başarısızlık (§9.1)
        transcript_hint, analysis_hint = fixture_hint(video)
        audio = M.extract_audio(video, work / "ders.wav")                       # (1)
        selection = _frames(rt, video, work, fixtures)                          # (2)
        result.frames, result.frame_method = len(selection.frames), selection.method
        transcript, replaced = _transcribe(rt, lesson=lesson, audio=audio, student_ref=ctx.student_ref,   # (3)
                                           labels=labels, name_hashes=name_hashes, payloads=payloads,
                                           engine=engine, hint=transcript_hint)
        result.segments, result.pii_replacements = len(transcript["segments"]), replaced
        result.transcript_path = _store_transcript(rt, lid, transcript)
        set_lesson(rt, lid, {"transcript_path": result.transcript_path, "frames_count": len(selection.frames)})
        seed = A.build_seed_profile(rt, ctx, labels=labels, name_hashes=name_hashes)            # (4)
        duration = _duration_min(lesson, selection.duration_sec or M.probe(audio).duration_sec)
        text = T.transcript_text(transcript)
        req = A.build_request(ctx, transcript_text=text, seed_profile=seed, frames=selection.frames,
                              duration_min=duration, fixture_hint=analysis_hint)
        T.assert_no_names(req.system + "\n" + req.prompt, name_hashes, what="analiz istemi")
        check = T.scrubbing_validator(ctx.validator(duration_min=duration, frames=len(selection.frames),
                                                    transcript_text=text, name_hashes=name_hashes),
                                      labels, name_hashes)
        with payloads.sending(rt, chain="lesson_analysis", name_hashes=name_hashes, what="analiz istemi"):
            call = rt.ledger.call("lesson_analysis", req, chain="lesson_analysis", ref_table="lessons",  # (5)
                                  ref_id=lid, student_ref=ctx.student_ref, validator=check)
        final = ctx.finalize(call.data, duration_min=duration, frames=len(selection.frames), model=call.model,
                             cost_usd=call.cost_usd, tokens_in=call.tokens_in, tokens_out=call.tokens_out,
                             transcript_text=text, name_hashes=name_hashes)
        # Kareler temizlenmeden gider (görüntüdeki ad kutucukları); modelin oradan okuduğu ad buraya düşer.
        T.assert_no_names(json.dumps(final, ensure_ascii=False), name_hashes, what="analiz çıktısı")
        result.lesson_cost_usd, result.llm_purposes = _lesson_cost(rt, lid, start)
        result.analysis_id = str(rt.db.rpc("write_lesson_analysis", {                               # (6)
            "p_lesson": lid, "p_seed_profile": seed, "p_analysis": final, "p_model": call.model,
            "p_cost": result.lesson_cost_usd}))
        result.status = "analyzed"
        try:
            resolve_failure_alerts(rt, lid)
        except DbError as exc:
            warn(f"eski başarısızlık alarmı kapatılamadı: {exc.message}")
        if out is not None:
            write_json(out, "lesson_analysis.json", final)
        return result
    except Exception as exc:
        if isinstance(exc, OgrError):
            code, result.error = exc.code, exc.message
        elif isinstance(exc, ValueError):
            code, result.error = "OGR-DERS-005", f"OGR-DERS-005 {exc}"
        else:
            code, result.error = None, f"{UNEXPECTED}: {type(exc).__name__}"
        result.lesson_cost_usd, result.llm_purposes = _lesson_cost(rt, lid, start)
        _mark_failed(rt, lesson, code)
        if isinstance(exc, ValueError):
            raise DersError(result.error) from exc
        raise
    finally:
        if out is not None:
            payloads.write(out, lid)
            write_json(out, "ders_result.json", result.as_dict())
        if not keep_work:
            shutil.rmtree(work, ignore_errors=True)                                                 # (7)


# --- transcribe-only / frames-only ---------------------------------------------------------------


def transcribe_only(rt: Runtime, *, lesson_id: str, video: Path, engine: str = "chain",
                    out: Path | None = None) -> dict:
    """Adım 1 + 3: isimsiz transkript Storage'a, ``lessons.transcript_path`` güncellenir; analiz yok."""
    lesson = get_lesson(rt, lesson_id)
    lid = str(lesson["id"])
    ctx = A.load_context(rt, lesson)
    labels, name_hashes = T.lesson_labels(rt, lid)
    T.require_student_labels(labels)
    payloads = T.PayloadLog()
    work = Path(tempfile.mkdtemp(prefix="ogrenmen-ders-"))
    try:
        audio = M.extract_audio(Path(video), work / "ders.wav")
        transcript, replaced = _transcribe(rt, lesson=lesson, audio=audio, student_ref=ctx.student_ref, labels=labels,
                                           name_hashes=name_hashes, payloads=payloads, engine=engine,
                                           hint=fixture_hint(Path(video))[0])
        path = _store_transcript(rt, lid, transcript)
        set_lesson(rt, lid, {"transcript_path": path})
        if out is not None:
            write_json(out, "transcript.json", transcript)
        return {"lesson_id": lid, "transcript_path": path, "segments": len(transcript["segments"]),
                "pii_replacements": replaced}
    finally:
        if out is not None:
            payloads.write(out, lid)
        shutil.rmtree(work, ignore_errors=True)


def frames_only(rt: Runtime, *, video: Path, out: Path, lesson_id: str | None = None) -> dict:
    """Adım 2: kareler ``out/frames/`` altına; ``--lesson`` verilirse ``lessons.frames_count`` güncellenir."""
    target = Path(out) / "frames"
    if target.exists():
        shutil.rmtree(target)
    selection = M.extract_frames(Path(video), target)
    summary = selection.summary()
    if lesson_id is not None:
        lid = str(get_lesson(rt, lesson_id)["id"])
        set_lesson(rt, lid, {"frames_count": len(selection.frames)})
        summary["lesson_id"] = lid
    write_json(Path(out), "frames.json", summary)
    return summary


# --- purge --------------------------------------------------------------------------------------


@dataclass
class PurgeItem:
    lesson_id: str
    video_ref: str
    action: str
    """``deleted`` | ``would_delete`` | ``missing`` | ``skipped_drive`` | ``skipped_outside_video_dir`` | ``error``"""
    confirmed: bool = False
    detail: str | None = None


def purge(rt: Runtime, *, older_than: timedelta, video_dir: Path | None, delete_files: bool,
          confirm_missing: bool = False) -> list[PurgeItem]:
    """``held_at < şimdi − older_than``, ``video_deleted_at is null``, ``video_ref`` dolu dersler: ham video
    ``video_dir`` altındaysa silinir ve ``confirm_video_deleted`` (öğrenci + veli bildirimi) çağrılır.

    Güvenlik: yalnız ``video_dir`` içindeki dosyalar silinir (DB'deki yol oraya çözülmüyorsa dokunulmaz). Drive
    kayıtları elle silinir ve onaylanmaz. Dosya yerinde değilse (``missing``) **onaylanmaz**: yanlış ya da bağlı
    olmayan bir dizin aileye "kayıt silindi" bildirimi göndermesin (KVKK). Kurucu dosyayı elle sildiyse
    ``confirm_missing=True`` (``--confirm-missing``) ile onaylanır. ``delete_files=False`` (dry-run) dosyaya
    dokunmaz; sahte veritabanında onay zinciri yine sınanır."""
    if video_dir is None:
        raise DersError("OGR-DERS-007 purge için --video-dir ya da OGRENMEN_VIDEO_DIR gerekli")
    base = Path(video_dir).expanduser()
    if not base.is_dir():
        raise DersError(f"OGR-DERS-001 video dizini yok ya da dizin değil: {base}")
    base = base.resolve()
    cutoff = rt.clock() - older_than
    items: list[PurgeItem] = []
    rows = rt.db.select("lessons", where={"video_deleted_at": is_null()}, order="held_at")
    for lesson in rows:
        ref = lesson.get("video_ref")
        if not ref or parse_ts(str(lesson["held_at"])) >= cutoff:
            continue
        item = PurgeItem(lesson_id=str(lesson["id"]), video_ref=str(ref), action="error")
        items.append(item)
        if str(ref).startswith(DRIVE_PREFIX):
            item.action, item.detail = "skipped_drive", "Drive kaydı elle silinmeli"
            continue
        path = resolve_video_ref(str(ref), base)
        if path is None or not path.resolve().is_relative_to(base):
            item.action, item.detail = "skipped_outside_video_dir", "dosya --video-dir dışında; dokunulmadı"
            continue
        path = path.resolve()
        if not path.is_file():
            item.action = "missing"
            if not confirm_missing:
                item.detail = "dosya video dizininde yok; onaylanmadı (elle silindiyse --confirm-missing)"
                continue
            item.detail = "dosya yok; --confirm-missing ile onaylandı"
        elif not delete_files:
            item.action = "would_delete"
        else:
            try:
                path.unlink()
            except OSError as exc:
                item.action, item.detail = "error", f"silinemedi: {exc.strerror}"
                continue
            item.action = "deleted"
        rt.db.rpc("confirm_video_deleted", {"p_lesson": item.lesson_id})
        item.confirmed = True
    return items


__all__ = ["AnalyzeResult", "PurgeItem", "analyze", "frames_only", "parse_held_at",
           "parse_older_than", "purge", "register", "transcribe_only", "video_ref_for"]
