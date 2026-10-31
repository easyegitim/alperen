"""JsonlDb RPC eşlenikleri — ``batch_worker``'ın çağırabildiği ``public`` fonksiyonların Python karşılığı.

Gövdeler BLUEPRINT §3.9/§3.10'daki SQL'i izler (aynı hata kodları, aynı yan etkiler); SQL'de tek
işlem olan gövdelerde tüm denetimler yazımdan **önce** yapılır, böylece hata yarım yazım bırakmaz.
Dönüş biçimi PostgREST'in JSON'uyla aynıdır: ``returns table`` → satır listesi, ``jsonb`` → sözlük,
``uuid``/``int`` → değer, ``void`` → ``None``.

Adların tam listesi ``fakes/rpc-names.json``'dadır (test bunu ``RPCS`` ile eşler).
"""

from __future__ import annotations

import json
import re
from collections.abc import Callable, Mapping
from datetime import timedelta
from typing import TYPE_CHECKING, Any

from ogrenmen_pii import name_token_hashes

from ..clock import hms_seconds, iso, istanbul_date, month_start, parse_ts
from ..errors import DbError, RpcError
from ..ids import STUDENT_REF

if TYPE_CHECKING:  # pragma: no cover
    from .jsonl_db import JsonlDb

RPCS: dict[str, Callable[..., Any]] = {}

FLAG_KEYS_BATCH = ("alerts_sent", "degraded_mode", "facts_lag_days", "storage_pressure")
MB = 1024 * 1024


def rpc(fn: Callable[..., Any]) -> Callable[..., Any]:
    RPCS[fn.__name__] = fn
    return fn


# --- yardımcılar -------------------------------------------------------------------------------


def _setting(db: JsonlDb, key: str, default: Any = None) -> Any:
    row = db._one("settings", key=key)
    return row["value"] if row is not None else default


def _flag(db: JsonlDb, key: str, default: Any = None) -> Any:
    row = db._one("runtime_flags", key=key)
    return row["value"] if row is not None else default


def _audit(db: JsonlDb, action: str, table_name: str, row_id: Any, diff: Any = None, *,
           actor_id: str = "batch_worker") -> None:
    db._insert_internal("audit.events", {"actor_role": db.role, "actor_id": actor_id, "action": action,
                                         "table_name": table_name, "row_id": None if row_id is None else str(row_id),
                                         "diff": diff})


def _require_role(db: JsonlDb, code: str) -> None:
    """SQL gövdesi ``batch_worker``'ı ve imtiyazlı rolleri kabul eden RPC'ler (grant'a dayanan kapı)."""
    if db.role not in ("batch_worker", "service_role", "postgres"):
        raise RpcError(code)


def _require_batch_worker(db: JsonlDb, code: str) -> None:
    """Anahtar RPC'leri: SQL ``if app.jwt_role() <> 'batch_worker' then raise 'OGR-KEY-001'`` — tam olarak
    ``batch_worker``; ``postgres``/``service_role`` da reddedilir (üretimdeki gövdeyle aynı)."""
    if db.role != "batch_worker":
        raise RpcError(f"{code} anahtar yalnız batch_worker rolüyle yazılır")


def _band(p: float) -> str:
    return "düşük" if p < 0.4 else "orta" if p < 0.7 else "yüksek"


def _active_enrollment(db: JsonlDb, student_id: str) -> dict | None:
    rows = [e for e in db._find("enrollments", student_id=student_id, status="active")]
    rows.sort(key=lambda e: str(e.get("started_at") or ""), reverse=True)
    return rows[0] if rows else None


def _private_chat(db: JsonlDb, student_id: str) -> int | None:
    kinds = {c["chat_id"]: c.get("kind") for c in db._all("tg_chats")}
    for role in db._find("chat_roles", student_id=student_id):
        if kinds.get(role["chat_id"]) == "private":
            return role["chat_id"]
    return None


def _open_alert(db: JsonlDb, row: Mapping[str, Any]) -> dict | None:
    """``alerts_dedup`` benzersiz indeksi: (kind, student, ref anahtarı, detail[:24]) açıkken tek satır."""
    def ref_key(ref: Mapping[str, Any]) -> str:
        for k in ("message_id", "fact_id", "escalation_id", "chat_id", "lesson_id", "source_id"):
            if ref.get(k) is not None:
                return str(ref[k])
        return ""

    key = (row["kind"], str(row.get("student_id") or ""), ref_key(row.get("ref") or {}), row["detail"][:24])
    for a in db._find("instructor_alerts", status="open"):
        if (a["kind"], str(a.get("student_id") or ""), ref_key(a.get("ref") or {}), a["detail"][:24]) == key:
            return None
    return db._insert_internal("instructor_alerts", row)


def _queue_proactive(db: JsonlDb, row: Mapping[str, Any]) -> dict | None:
    """``proactive_one_per_day``: öğrenci × alıcı × Istanbul günü başına tek satır (on conflict do nothing)."""
    day = istanbul_date(row["scheduled_for"])
    for p in db._find("proactive_messages", student_id=row["student_id"]):
        if p.get("recipient", "student") == row.get("recipient", "student") and istanbul_date(
                p["scheduled_for"]) == day:
            return None
    return db._insert_internal("proactive_messages", row)


# --- harcama ve bayraklar ----------------------------------------------------------------------


@rpc
def check_spend(db: JsonlDb, p_purpose: str) -> list[dict]:
    """İki bütçe (§3.9): sohbet/toplu (cap_excluded_purposes hariç) ve ders (yalnız hariç amaçlar)."""
    excluded = list(_flag(db, "cap_excluded_purposes", []) or [])
    is_lesson = p_purpose in excluded
    today = db.today()
    first = month_start(today)
    d = m = ml = 0.0
    for row in db._all("spend_ledger"):
        day = parse_ts(row["day"]).date()
        cost = float(row.get("cost_usd") or 0)
        lesson = row.get("purpose") in excluded
        if day >= first and lesson:
            ml += cost
        if not lesson:
            if day == today:
                d += cost
            if day >= first:
                m += cost
    dc = float(_flag(db, "daily_cap_usd", 0) or 0)
    mc = float(_flag(db, "monthly_cap_usd", 0) or 0)
    lc_raw = _flag(db, "lesson_monthly_cap_usd", None)
    lc = 30.0 if lc_raw is None else float(lc_raw)
    paid = bool(_flag(db, "paid_llm_enabled", False))
    deg = bool(_flag(db, "degraded_mode", False))
    chat_ok = paid and d < dc and m < mc
    return [{
        "paid_allowed": (paid and ml < lc) if is_lesson else chat_ok,
        "degraded": deg,
        "day_usd": round(d, 6),
        "month_usd": round(m, 6),
        "daily_cap": dc,
        "monthly_cap": mc,
        "state": "degraded" if deg else ("normal" if chat_ok else "free_only"),
        "lesson_month_usd": round(ml, 6),
        "lesson_cap": lc,
    }]


@rpc
def set_runtime_flag(db: JsonlDb, p_key: str, p_value: Any) -> None:
    """batch_worker yalnız dört anahtarı ve ``paid_llm_enabled``'ı yalnız ``false`` yapabilir (tek yönlü)."""
    if db.role == "batch_worker" and p_key not in FLAG_KEYS_BATCH and not (
            p_key == "paid_llm_enabled" and p_value is False):
        raise RpcError("OGR-AUTH-003 bu bayrak batch_worker ile değiştirilemez")
    row = db._one("runtime_flags", key=p_key)
    values = {"value": p_value, "updated_at": iso(db.now()), "updated_by": f"{db.role}:"}
    if row is None:
        db._insert_internal("runtime_flags", {"key": p_key, **values})
    else:
        db._update_internal("runtime_flags", row, values)
    _audit(db, "RPC:set_runtime_flag", "runtime_flags", p_key, p_value, actor_id=None)


@rpc
def rollup_spend(db: JsonlDb) -> int:
    """``spend_ledger``'ı ``llm_calls``'tan yeniden hesaplar (llm_calls'ı olan anahtarlar); değişen satır sayısı."""
    totals: dict[tuple, dict] = {}
    for c in db._all("llm_calls"):
        key = (istanbul_date(c.get("created_at") or db.now()).isoformat(), c["purpose"], c["provider"])
        t = totals.setdefault(key, {"calls": 0, "tokens_in": 0, "tokens_out": 0, "cost_usd": 0.0})
        t["calls"] += 1
        t["tokens_in"] += int(c.get("tokens_in") or 0)
        t["tokens_out"] += int(c.get("tokens_out") or 0)
        t["cost_usd"] += float(c.get("cost_usd") or 0)
    changed = 0
    for (day, purpose, provider), t in sorted(totals.items()):
        t["cost_usd"] = round(t["cost_usd"], 6)
        row = db._one("spend_ledger", day=day, purpose=purpose, provider=provider)
        if row is None:
            db._insert_internal("spend_ledger", {"day": day, "purpose": purpose, "provider": provider, **t})
            changed += 1
        elif any(row.get(k) != v for k, v in t.items()):
            db._update_internal("spend_ledger", row, t)
            changed += 1
    return changed


# --- cevap anahtarı ve şablon soruları ---------------------------------------------------------


def _approve_guard(db: JsonlDb, q: Mapping[str, Any], key: Mapping[str, Any] | None,
                   figure: Mapping[str, Any] | None) -> None:
    """``app.questions_approve_guard`` (approved'a geçiş): şekil verified/yok, anahtar, şık kuralı."""
    if q.get("figure_id") is not None and (figure is None or figure.get("review_status") != "verified"):
        raise RpcError("OGR-Q-001 şekil doğrulanmadan soru onaylanamaz")
    if key is None or key.get("sympy_status") not in ("verified", "not_applicable"):
        raise RpcError("OGR-Q-001 doğrulanmış cevap anahtarı yok")
    if q.get("kind") == "mcq":
        opts = q.get("options") or []
        nulls = sum(1 for o in opts if o.get("misconception_tag") is None)
        if len(opts) != int(_setting(db, "max_options", 4)) or nulls < 2:
            raise RpcError("OGR-Q-002 şık kuralı: tam 4 şık ve en az iki etiketsiz şık")
    if key.get("sympy_status") == "not_applicable":
        raise RpcError("OGR-Q-003 anahtar görülmeden onay yok")


@rpc
def register_answer_key(db: JsonlDb, p_question: str, p_key: Mapping[str, Any]) -> None:
    """LLM yolunun anahtar yazabildiği tek kapı (§3.9); kilit kuralları satır durumuna bağlıdır."""
    _require_batch_worker(db, "OGR-KEY-001")
    status = (p_key or {}).get("sympy_status")
    if status not in ("verified", "failed", "not_applicable"):
        raise RpcError("OGR-KEY-002 sympy_status geçersiz")
    q = db._one("questions", id=p_question)
    if q is None:
        raise RpcError("OGR-KEY-004 soru yok")
    if q.get("source") not in ("llm", "template") or q.get("status") not in ("draft", "pending_review", "rejected"):
        raise RpcError("OGR-KEY-003 anahtar kilitli")
    old = db._one("secure.answer_keys", question_id=p_question)
    if old is not None and not str(old.get("written_by", "")).startswith("batch_worker:"):
        raise RpcError("OGR-KEY-003 anahtar kilitli")
    if not p_key.get("solution"):
        raise DbError("OGR-DB-002 null value in column \"solution\" of relation \"answer_keys\"")
    if status == "not_applicable" and not (
            q.get("kind") == "mcq" and p_key.get("canonical_expr") is None and p_key.get("numeric_value") is None):
        status = "failed"
    key_row = {
        "question_id": p_question,
        "correct_option": p_key.get("correct_option"),
        "numeric_value": p_key.get("numeric_value"),
        "numeric_tolerance": p_key.get("numeric_tolerance") or 0,
        "canonical_expr": p_key.get("canonical_expr"),
        "solution": p_key.get("solution"),
        "sympy_status": status,
        "sympy_report": p_key.get("sympy_report"),
        "written_by": "batch_worker:unverified" if status == "not_applicable" else "batch_worker:tablet",
        "verified_at": iso(db.now()) if status == "verified" else None,
        "created_at": (old or {}).get("created_at") or iso(db.now()),
    }
    if old is None:
        db._insert_internal("secure.answer_keys", key_row)
    else:
        db._update_internal("secure.answer_keys", old, key_row)
    verification = dict(q.get("verification") or {})
    verification["sympy"] = status
    changes: dict[str, Any] = {"verification": verification}
    if status == "failed":
        changes["status"] = "rejected"
        changes["review_note"] = "SymPy doğrulaması başarısız"
    elif q.get("status") == "draft":
        changes["status"] = "pending_review"
    db._update_internal("questions", q, changes)
    if status == "failed":
        db._delete_rows("secure.answer_keys", lambda r: r.get("question_id") == p_question)
    _audit(db, "RPC:register_answer_key", "questions", p_question,
           {"sympy_status": status, "had_key": old is not None}, actor_id="batch_worker:tablet")


@rpc
def register_template_question(db: JsonlDb, p_item: Mapping[str, Any], p_key: Mapping[str, Any],
                               p_figure: Mapping[str, Any] | None = None) -> str | None:
    """Şablon sorusu tek kapı: şekil verified, anahtar verified, soru approved (§3.9)."""
    _require_batch_worker(db, "OGR-KEY-001")
    if p_item.get("source") != "template":
        raise RpcError("OGR-TPL-001 yalnız source=template")
    tpl_id = (p_item.get("template") or {}).get("id")
    tpl = db._one("question_templates", id=tpl_id, enabled=True)
    if tpl is None:
        raise RpcError("OGR-TPL-002 şablon yok ya da kapalı")
    if (p_key or {}).get("sympy_status") != "verified":
        raise RpcError("OGR-TPL-003 şablon anahtarı SymPy ile doğrulanmış olmalı")
    cur = next((c for c in db._all("curricula") if f"{c['code']}@{c['version']}" == p_item.get("curriculum_code")),
               None)
    if cur is None or cur["id"] != tpl["curriculum_id"]:
        raise RpcError("OGR-TPL-004 müfredat uyuşmuyor")
    existing_fig = None
    if p_figure is not None:
        existing_fig = db._one("figures", code_hash=p_figure.get("code_hash"))
        fig_for_guard: Mapping[str, Any] | None = existing_fig or {"review_status": "verified"}
    elif tpl.get("has_figure"):
        raise RpcError("OGR-TPL-005 şablon şekil bekliyor")
    else:
        fig_for_guard = None
    if db._one("questions", content_hash=p_item.get("content_hash")) is not None:
        return None
    skills = {(s["curriculum_id"], s["id"]) for s in db._all("skills")}
    for sid in p_item.get("skill_ids") or []:
        if (cur["id"], sid) not in skills:
            raise RpcError(f"OGR-CURR-001 kazanım müfredatta yok: {sid}")
    if not p_key.get("solution"):
        raise DbError("OGR-DB-002 null value in column \"solution\" of relation \"answer_keys\"")
    verification = dict(p_item.get("verification") or {})
    verification.pop("status", None)
    verification.update({"sympy": "verified", "render": "ok", "vision": "not_applicable"})
    q_row = {
        "curriculum_id": cur["id"],
        "skill_ids": list(p_item.get("skill_ids") or []),
        "kind": p_item.get("kind"),
        "stem": p_item.get("stem"),
        "stem_values": p_item.get("stem_values") or {},
        "options": p_item.get("options"),
        "difficulty": p_item.get("difficulty"),
        "source": "template",
        "template_id": tpl["id"],
        "template_params": (p_item.get("template") or {}).get("params"),
        "content_hash": p_item.get("content_hash"),
        "verification": verification,
        "status": "pending_review",
        "figure_id": existing_fig["id"] if existing_fig else ("pending" if p_figure is not None else None),
    }
    key_row = {"sympy_status": "verified"}
    _approve_guard(db, {**q_row, "figure_id": q_row["figure_id"]}, key_row, fig_for_guard)
    fig_id = None
    if p_figure is not None:
        if existing_fig is not None:
            db._update_internal("figures", existing_fig, {"png_path": p_figure.get("png_path")})
            fig_id = existing_fig["id"]
        else:
            fig = db._insert_internal("figures", {
                "tool": "template", "code": p_figure.get("code"), "code_hash": p_figure.get("code_hash"),
                "alt_text": p_figure.get("alt_text"), "png_path": p_figure.get("png_path"),
                "width_px": p_figure.get("width_px"), "height_px": p_figure.get("height_px"),
                "bytes": p_figure.get("bytes"), "render_status": "rendered", "vision_status": "not_applicable",
                "review_status": "verified", "reviewed_at": iso(db.now())})
            fig_id = fig["id"]
    q_row["figure_id"] = fig_id
    q = db._insert_internal("questions", q_row)
    db._insert_internal("secure.answer_keys", {
        "question_id": q["id"], "correct_option": p_key.get("correct_option"),
        "numeric_value": p_key.get("numeric_value"), "numeric_tolerance": p_key.get("numeric_tolerance") or 0,
        "canonical_expr": p_key.get("canonical_expr"), "solution": p_key.get("solution"),
        "sympy_status": "verified", "sympy_report": p_key.get("sympy_report"),
        "written_by": "batch_worker:template", "verified_at": iso(db.now()), "created_at": iso(db.now())})
    stored = db._one("questions", id=q["id"])
    db._update_internal("questions", stored, {"status": "approved", "reviewed_at": iso(db.now()),
                                              "review_note": "şablon: otomatik onay"})
    _audit(db, "RPC:register_template_question", "questions", q["id"], {"template_id": tpl["id"]},
           actor_id="batch_worker:tablet")
    return q["id"]


# --- ders --------------------------------------------------------------------------------------


@rpc
def register_lesson(db: JsonlDb, p_student_ref: str, p_staff_id: str, p_held_at: str, p_duration: int | None = None,
                    p_video_ref: str | None = None) -> str:
    """public_ref → aktif kayıt; ``lessons(status='uploaded')`` satırı (video Storage'a girmez)."""
    _require_role(db, "OGR-AUTH-002")
    if not isinstance(p_student_ref, str) or not STUDENT_REF.match(p_student_ref):
        raise RpcError("OGR-LESSON-002 öğrenci kimliği student_ref (s_…) olmalı")
    student = db._one("students", public_ref=p_student_ref)
    if student is None or student.get("status") == "deleted":
        raise RpcError("OGR-LESSON-002 öğrenci yok")
    enr = _active_enrollment(db, student["id"])
    if enr is None:
        raise RpcError("OGR-LESSON-002 aktif kayıt yok")
    staff = db._one("staff", id=p_staff_id, active=True)
    if staff is None:
        raise RpcError("OGR-LESSON-002 personel yok")
    row = db._insert_internal("lessons", {"enrollment_id": enr["id"], "staff_id": staff["id"],
                                          "held_at": iso(parse_ts(p_held_at)), "duration_min": p_duration,
                                          "video_ref": p_video_ref, "status": "uploaded"})
    _audit(db, "RPC:register_lesson", "lessons", row["id"], actor_id="batch_worker:ders")
    return row["id"]


@rpc
def resolve_lesson_labels(db: JsonlDb, p_lesson: str) -> list[dict]:
    """§3.9 ``table(hash, label)``: dersin öğrencisinin ('ÖĞRENCİ') ve eğitmeninin ('EĞİTMEN') ad-token hash'leri;
    düz ad dönmez. ``student_pii.name_token_hashes``'teki diğer tokenlar (ör. veli adı) da 'ÖĞRENCİ' etiketiyle
    döner — SQL'in döndürdüğü yalnız bu iki etikettir."""
    lesson = db._one("lessons", id=p_lesson)
    if lesson is None:
        raise RpcError("OGR-LESSON-002 ders yok")
    enr = db._one("enrollments", id=lesson["enrollment_id"])
    pii = db._one("secure.student_pii", student_id=enr["student_id"]) if enr else None
    out: list[dict] = []
    seen: set[str] = set()

    def add(hashes, label):
        for h in hashes:
            if h not in seen:
                seen.add(h)
                out.append({"hash": h, "label": label})

    if pii is None:
        rows = db._all("lesson_labels")
        if not rows:
            raise RpcError("OGR-LESSON-002 öğrenci kişisel verisi yok")
        add([r["hash"] for r in rows if r["label"] == "ÖĞRENCİ"], "ÖĞRENCİ")
        add([r["hash"] for r in rows if r["label"] == "EĞİTMEN"], "EĞİTMEN")
    else:
        own = name_token_hashes(pii["display_name"]) if pii.get("display_name") else []
        add(own, "ÖĞRENCİ")
        staff = db._one("staff", id=lesson.get("staff_id")) if lesson.get("staff_id") else None
        if staff is not None:
            add(name_token_hashes(staff["full_name"]), "EĞİTMEN")
        add(pii.get("name_token_hashes") or [], "ÖĞRENCİ")
    _audit(db, "RPC:resolve_lesson_labels", "lessons", p_lesson, actor_id="batch_worker:ders")
    return out


def infer_prereq_gap(db: JsonlDb, enrollment_id: str, skill_id: str) -> str | None:
    """``app.infer_prereq_gap``: kazanım p<0.4 ∧ n≥5 ve ön koşulu p<0.5 ∧ n≥5 → ipucu metni."""
    m = db._one("mastery", enrollment_id=enrollment_id, skill_id=skill_id)
    if m is None or not (float(m["p"]) < 0.4 and int(m["evidence_count"]) >= 5):
        return None
    candidates = []
    for sp in db._find("skill_prerequisites", skill_id=skill_id, curriculum_id=m["curriculum_id"]):
        pm = db._one("mastery", enrollment_id=enrollment_id, skill_id=sp["prereq_id"])
        if pm is not None and float(pm["p"]) < 0.5 and int(pm["evidence_count"]) >= 5:
            sk = db._one("skills", id=sp["prereq_id"], curriculum_id=sp["curriculum_id"])
            if sk is not None:
                candidates.append((float(pm["p"]), sk["name"]))
    if not candidates:
        return None
    candidates.sort()
    return "Asıl sorun alt konuda olabilir: " + candidates[0][1]


@rpc
def profile_for_prompt(db: JsonlDb, p_enrollment: str) -> dict | None:
    """En zayıf 3 güvenilir kazanım (bant; yüzde ve p yok), açık yanılgılar, ön koşul ipucu, notlar, haftalık satır."""
    enr = db._one("enrollments", id=p_enrollment)
    if enr is None:
        return None
    min_ev = int(_setting(db, "min_evidence", 5))
    rows = [m for m in db._find("mastery", enrollment_id=p_enrollment) if int(m["evidence_count"]) >= min_ev]
    rows.sort(key=lambda m: (float(m["p"]), m["skill_id"]))
    weak = []
    for m in rows[:3]:
        sk = db._one("skills", id=m["skill_id"], curriculum_id=enr["curriculum_id"])
        weak.append({"skill_id": m["skill_id"], "name": sk["name"] if sk else m["skill_id"],
                     "band": _band(float(m["p"]))})
    mis = [x for x in db._find("misconceptions", enrollment_id=p_enrollment, status="open")]
    mis.sort(key=lambda x: str(x.get("last_seen") or ""), reverse=True)
    prefs = db._one("preferences", student_id=enr["student_id"]) or {}
    summaries = sorted(db._find("weekly_summaries", student_id=enr["student_id"]), key=lambda w: str(w["week_start"]))
    weekly_line = None
    if summaries:
        lines = [ln.strip() for ln in str(summaries[-1]["body"]).splitlines() if ln.strip()]
        weekly_line = lines[-1] if lines else None
    return {
        "weak": weak,
        "misconceptions": [x["text_student"] for x in mis],
        "prereq_hint": infer_prereq_gap(db, p_enrollment, rows[0]["skill_id"]) if rows else None,
        "explanation_notes": prefs.get("explanation_notes"),
        "weekly_line": weekly_line,
    }


def _claims_from_analysis(analysis: Mapping[str, Any]) -> list[dict]:
    """``write_lesson_analysis``'in iddia türetimi (§3.9 yorum satırları)."""
    claims: list[dict] = []
    for s in analysis.get("skills") or []:
        ev = (s.get("evidence") or [{}])[0]
        claims.append({"kind": "skill_mastery", "skill_id": s["skill_id"],
                       "value": {"mastery": s["mastery_estimate"], "confidence": s["confidence"]},
                       "quote": ev.get("quote") or "", "speaker": ev.get("speaker") or "ÖĞRENCİ",
                       "t_start_sec": hms_seconds(ev.get("t")),
                       "t_end_sec": hms_seconds(ev.get("t_end")) if ev.get("t_end") else None})
    for mc in analysis.get("misconceptions") or []:
        ev = (mc.get("evidence") or [{}])[0]
        claims.append({"kind": "misconception", "skill_id": mc["skill_id"], "misconception_tag": mc.get("tag"),
                       "value": {"text": mc["text_instructor"], "text_student": mc["text_student"],
                                 "resolved_in_lesson": bool(mc.get("resolved_in_lesson", False))},
                       "quote": ev.get("quote") or mc["text_instructor"], "speaker": ev.get("speaker") or "ÖĞRENCİ",
                       "t_start_sec": hms_seconds(ev.get("t")),
                       "t_end_sec": hms_seconds(ev.get("t_end")) if ev.get("t_end") else None})
    for q in analysis.get("questions") or []:
        claims.append({"kind": "question", "skill_id": q.get("skill_id"),
                       "value": {"text": q["quote"], "answered": q.get("answered")},
                       "quote": q["quote"], "speaker": "ÖĞRENCİ", "t_start_sec": hms_seconds(q["t"])})
    for h in analysis.get("hesitations") or []:
        claims.append({"kind": "hesitation", "skill_id": h.get("skill_id"), "value": {"kind": h["kind"]},
                       "quote": h.get("quote") or h["kind"], "speaker": "ÖĞRENCİ", "t_start_sec": hms_seconds(h["t"])})
    for c in analysis.get("commitments") or []:
        claims.append({"kind": c["kind"], "value": {"text": c["text"], "due": c.get("due"), "who": c["who"]},
                       "quote": c["text"], "speaker": c["who"], "t_start_sec": hms_seconds(c["t"])})
    for f in analysis.get("previous_profile_check") or []:
        ev = (f.get("evidence") or [{}])[0]
        claims.append({"kind": "followup", "misconception_id": f["misconception_id"], "value": {"status": f["status"]},
                       "quote": ev.get("quote") or "Önceki yanılgı denetimi", "speaker": ev.get("speaker") or "EĞİTMEN",
                       "t_start_sec": hms_seconds(ev.get("t"))})
    ns = analysis.get("next_step")
    if ns:
        claims.append({"kind": "next_step", "value": dict(ns), "quote": ns["for_instructor"], "speaker": "EĞİTMEN",
                       "t_start_sec": 0})
    talk = analysis.get("talk")
    if talk:
        claims.append({"kind": "talk",
                       "value": {k: talk[k] for k in ("student_ratio", "student_questions", "attention", "morale")},
                       "quote": talk.get("notes") or "Konuşma oranı özeti", "speaker": "EĞİTMEN", "t_start_sec": 0})
    return claims


@rpc
def write_lesson_analysis(db: JsonlDb, p_lesson: str, p_seed_profile: Mapping[str, Any], p_analysis: Mapping[str, Any],
                          p_model: str, p_cost: float = 0) -> str:
    """``lesson_analyses(draft)`` + ``lesson_claims(pending)``; observations YAZILMAZ; ops alarmı."""
    _require_role(db, "OGR-AUTH-002")
    lesson = db._one("lessons", id=p_lesson)
    if lesson is None:
        raise RpcError("OGR-LESSON-002 ders yok")
    enr = db._one("enrollments", id=lesson["enrollment_id"])
    cur = enr["curriculum_id"]
    claims = _claims_from_analysis(p_analysis)
    skills = {s["id"] for s in db._find("skills", curriculum_id=cur)}
    tags = {t["tag"] for t in db._all("misconception_tags")}
    for c in claims:
        if c.get("skill_id") is not None and c["skill_id"] not in skills:
            raise RpcError(f"OGR-CURR-001 kazanım müfredatta yok: {c['skill_id']}")
        if c.get("misconception_tag") is not None and c["misconception_tag"] not in tags:
            raise RpcError(f"OGR-CURR-001 yanılgı etiketi katalogda yok: {c['misconception_tag']}")
    versions = [int(a.get("version") or 1) for a in db._find("lesson_analyses", lesson_id=p_lesson)]
    analysis = db._insert_internal("lesson_analyses", {
        "lesson_id": p_lesson, "version": (max(versions) + 1) if versions else 1, "seed_profile": dict(p_seed_profile),
        "analysis": dict(p_analysis), "model": p_model, "cost_usd": round(float(p_cost or 0), 6), "status": "draft"})
    for c in claims:
        db._insert_internal("lesson_claims", {"analysis_id": analysis["id"], "curriculum_id": cur, **c})
    db._update_internal("lessons", db._one("lessons", id=p_lesson), {"status": "analyzed"})
    _open_alert(db, {"kind": "ops", "severity": "neutral", "student_id": None, "staff_id": lesson.get("staff_id"),
                     "detail": "Ders raporu onay bekliyor", "since": iso(db.now()), "ref": {"lesson_id": p_lesson}})
    _audit(db, "RPC:write_lesson_analysis", "lesson_analyses", analysis["id"], {"claims": len(claims)},
           actor_id="batch_worker:ders")
    return analysis["id"]


@rpc
def confirm_video_deleted(db: JsonlDb, p_lesson: str) -> None:
    """``ders purge`` sonrası: ``video_deleted_at``; öğrenciye ve veliye ``video_deleted`` bildirimi."""
    _require_role(db, "OGR-AUTH-002")
    lesson = db._one("lessons", id=p_lesson)
    if lesson is None:
        raise RpcError("OGR-LESSON-002 ders yok")
    now = iso(db.now())
    db._update_internal("lessons", lesson, {"video_deleted_at": now})
    enr = db._one("enrollments", id=lesson["enrollment_id"])
    sid = enr["student_id"]
    params = {"lesson_id": p_lesson}
    _queue_proactive(db, {"student_id": sid, "chat_id": _private_chat(db, sid), "recipient": "student",
                          "template_id": "video_deleted", "params": params, "scheduled_for": now})
    _queue_proactive(db, {"student_id": sid, "chat_id": None, "recipient": "guardian", "template_id": "video_deleted",
                          "params": params, "scheduled_for": now})
    _audit(db, "RPC:confirm_video_deleted", "lessons", p_lesson, actor_id="batch_worker:ders")


# --- saklama ve bakım ---------------------------------------------------------------------------

_COND = re.compile(r"^\s*([a-z_][a-z0-9_]*)\s*(=|is not|is)\s*(.+?)\s*$", re.I)


def _literal(text: str) -> Any:
    t = text.strip()
    low = t.lower()
    if low == "true":
        return True
    if low == "false":
        return False
    if low == "null":
        return None
    if t.startswith("'") and t.endswith("'"):
        return t[1:-1].replace("''", "'")
    try:
        return float(t) if "." in t else int(t)
    except ValueError as exc:
        raise DbError(f"OGR-DB-002 desteklenmeyen condition_sql değeri: {text}") from exc


def compile_condition(sql: str | None) -> Callable[[Mapping[str, Any]], bool]:
    """``retention_policies.condition_sql`` alt kümesi: ``a = lit``, ``a is [not] null``, ``and`` ile."""
    if not sql:
        return lambda row: True
    preds = []
    for part in re.split(r"\s+and\s+", sql.strip(), flags=re.I):
        m = _COND.match(part)
        if not m:
            raise DbError(f"OGR-DB-002 desteklenmeyen condition_sql: {sql}")
        col, op, lit = m.group(1), m.group(2).lower(), _literal(m.group(3))
        if op == "=":
            preds.append(lambda r, c=col, v=lit: r.get(c) is not None and r.get(c) == v)
        elif op == "is":
            preds.append(lambda r, c=col, v=lit: r.get(c) is v)
        else:
            preds.append(lambda r, c=col, v=lit: r.get(c) is not v)
    return lambda row: all(p(row) for p in preds)


def _older(row: Mapping[str, Any], col: str, cutoff) -> bool:
    v = row.get(col)
    return v is not None and parse_ts(v) < cutoff


def _closed_enrollments(db: JsonlDb, cutoff) -> list[dict]:
    return [e for e in db._find("enrollments", status="closed") if _older(e, "ended_at", cutoff)]


def _h_students_anonymize(db: JsonlDb, days: int) -> int:
    cutoff = db.now() - timedelta(days=days)
    victims = [s["id"] for s in db._all("students") if _older(s, "deleted_at", cutoff)]
    for sid in victims:
        for table in ("secure.student_pii", "secure.telegram_identities", "secure.auth_links", "secure.guardian_codes"):
            db._delete_rows(table, lambda r, s=sid: r.get("student_id") == s)
        for m in db._find("messages", student_id=sid):
            db._update_internal("messages", m, {"text_raw": None, "text_llm": None})
        db._delete_rows("memory_facts", lambda r, s=sid: r.get("student_id") == s)
        db._delete_rows("weekly_summaries", lambda r, s=sid: r.get("student_id") == s)
        for b in db._find("bot_responses", student_id=sid):
            db._update_internal("bot_responses", b, {"prompt_text": None})
    return len(victims)


def _h_lessons_video(db: JsonlDb, days: int) -> int:
    cutoff = db.now() - timedelta(days=days)
    pending = [x for x in db._all("lessons")
               if _older(x, "held_at", cutoff) and x.get("video_deleted_at") is None and x.get("video_ref")]
    for lesson in pending:
        _open_alert(db, {"kind": "ops", "severity": "warning", "student_id": None, "staff_id": None,
                         "detail": f"Ders videosu silinmeyi bekliyor: {len(pending)}", "since": iso(db.now()),
                         "ref": {"lesson_id": lesson["id"]}})
    return len(pending)


def _h_lessons_transcript(db: JsonlDb, days: int) -> int:
    closed = {e["id"] for e in _closed_enrollments(db, db.now() - timedelta(days=days))}
    n = 0
    for lesson in db._all("lessons"):
        if lesson.get("transcript_path") and lesson.get("enrollment_id") in closed:
            db._insert_internal("storage_deletions", {"bucket": "transcripts", "path": lesson["transcript_path"]})
            db._update_internal("lessons", lesson, {"transcript_path": None})
            n += 1
    return n


def _h_enrollments_learning_data(db: JsonlDb, days: int) -> int:
    closed = _closed_enrollments(db, db.now() - timedelta(days=days))
    ids = {e["id"] for e in closed}
    for o in db._all("observations"):
        if o.get("enrollment_id") in ids and o.get("quote") is not None:
            db._update_internal("observations", o, {"quote": None})
    for a in db._all("attempts"):
        if a.get("enrollment_id") in ids and a.get("chosen") != {}:
            db._update_internal("attempts", a, {"chosen": {}})
    return len(ids)


def _h_enrollments_closed(db: JsonlDb, days: int) -> int:
    closed = _closed_enrollments(db, db.now() - timedelta(days=days))
    students = {e["student_id"] for e in closed}
    for sid in students:
        db._delete_rows("memory_facts", lambda r, s=sid: r.get("student_id") == s)
    return len(closed)


RETENTION_HANDLERS: dict[str, Callable[[JsonlDb, int], int]] = {
    "app.retention_students_anonymize": _h_students_anonymize,
    "app.retention_lessons_video": _h_lessons_video,
    "app.retention_lessons_transcript": _h_lessons_transcript,
    "app.retention_enrollments_learning_data": _h_enrollments_learning_data,
    "app.retention_enrollments_closed": _h_enrollments_closed,
}
"""``mode='custom'`` işleyicileri (§3.0 tablosu, ``0015_audit_retention.sql``)."""


@rpc
def run_retention(db: JsonlDb) -> list[dict]:
    """``retention_policies where enabled``: delete / null_columns / expire / custom; her satır ``retention_runs``."""
    out = []
    for pol in db._all("retention_policies"):
        if not pol.get("enabled", True):
            continue
        days = int(pol["days"])
        mode = pol["mode"]
        if mode == "custom":
            handler = RETENTION_HANDLERS.get(pol.get("handler") or "")
            if handler is None:
                raise DbError(f"OGR-DB-002 saklama işleyicisi yok: {pol.get('handler')}")
            affected = handler(db, days)
        else:
            table = pol["table_name"] if pol.get("schema_name", "public") == "public" else (
                f"{pol['schema_name']}.{pol['table_name']}")
            cutoff = db.now() - timedelta(days=days)
            cond = compile_condition(pol.get("condition_sql"))

            def hit(r, col=pol["ts_column"], cutoff=cutoff, cond=cond):
                return _older(r, col, cutoff) and cond(r)

            if mode == "delete":
                affected = db._delete_rows(table, hit)
            elif mode == "null_columns":
                affected = 0
                for r in db._all(table):
                    if hit(r) and any(r.get(c) is not None for c in pol.get("columns") or []):
                        db._update_internal(table, r, {c: None for c in pol.get("columns") or []})
                        affected += 1
            elif mode == "expire":
                affected = 0
                for r in db._all(table):
                    if hit(r) and r.get("status") != "expired":
                        db._update_internal(table, r, {"status": "expired"})
                        affected += 1
            else:
                raise DbError(f"OGR-DB-002 bilinmeyen saklama modu: {mode}")
        db._insert_internal("retention_runs", {"policy_id": pol["id"], "affected_rows": affected,
                                               "detail": {"mode": mode, "days": days}})
        out.append({"policy_id": pol["id"], "affected_rows": affected})
    return out


@rpc
def anonymize_students(db: JsonlDb) -> int:
    """Silme talebinden ``students.anonymize`` politikasının günü (30) sonra anonimleştirme."""
    pol = db._one("retention_policies", id="students.anonymize")
    return _h_students_anonymize(db, int(pol["days"]) if pol else 30)


@rpc
def recompute_is_minor(db: JsonlDb) -> int:
    """``students.is_minor`` = doğum yılı yok ya da (bu yıl − doğum yılı) < 18; değişen satır sayısı."""
    year = db.today().year
    changed = 0
    for pii in db._all("secure.student_pii"):
        student = db._one("students", id=pii["student_id"])
        if student is None:
            continue
        by = pii.get("birth_year")
        minor = by is None or (year - int(by) < 18)
        if bool(student.get("is_minor")) != minor:
            db._update_internal("students", student, {"is_minor": minor})
            changed += 1
    return changed


@rpc
def cap_memory_facts(db: JsonlDb) -> int:
    """Öğrenci başına en çok 300 (``storage_pressure`` iken 200) aktif olgu; en eskiler ``merged``."""
    cap = 200 if _flag(db, "storage_pressure", False) else 300
    by_student: dict[str, list[dict]] = {}
    for f in db._find("memory_facts", status="active"):
        by_student.setdefault(f["student_id"], []).append(f)
    n = 0
    for facts in by_student.values():
        if len(facts) > cap:
            facts.sort(key=lambda f: (str(f.get("created_at") or ""), f["id"]))
            for f in facts[: len(facts) - cap]:
                db._update_internal("memory_facts", f, {"status": "merged"})
                n += 1
    return n


@rpc
def cron_idle_sessions(db: JsonlDb) -> int:
    """``last_activity_at < now − session_idle_hours`` → ``idle``, ``direct_once=false``, ``hint_level=0``."""
    cutoff = db.now() - timedelta(hours=int(_setting(db, "session_idle_hours", 6)))
    n = 0
    for s in db._all("sessions"):
        if _older(s, "last_activity_at", cutoff) and (s.get("state") != "idle" or s.get("direct_once")
                                                      or s.get("hint_level")):
            db._update_internal("sessions", s, {"state": "idle", "direct_once": False, "hint_level": 0})
            n += 1
    return n


@rpc
def compute_table_sizes(db: JsonlDb) -> int:
    """Tablo boyutları → ``table_sizes_daily``; > 350 MB ops uyarısı; > 450 MB ``storage_pressure`` ve saklama 60 gün.

    Sahte boyut JSON uzunluğudur; ``db.size_overrides`` (tablo → bayt) testte gerçek boyutu taklit eder.
    """
    overrides = getattr(db, "size_overrides", {}) or {}
    day = db.today().isoformat()
    total = 0
    for table in sorted(db.tables):
        if table.startswith("secure.") or table == "lesson_labels":
            continue
        rows = db._all(table)
        size = int(overrides.get(table, len(json.dumps(rows, ensure_ascii=False).encode("utf-8"))))
        total += size
        existing = db._one("table_sizes_daily", day=day, table_name=table)
        values = {"total_bytes": size, "row_estimate": len(rows)}
        if existing is None:
            db._insert_internal("table_sizes_daily", {"day": day, "table_name": table, **values})
        else:
            db._update_internal("table_sizes_daily", existing, values)
    if total > 350 * MB:
        _open_alert(db, {"kind": "ops", "severity": "warning", "student_id": None, "staff_id": None,
                         "detail": f"Veritabanı boyutu {total // MB} MB; 500 MB sınırına yaklaşıyor",
                         "since": iso(db.now()), "ref": {}})
    if total > 450 * MB:
        flag = db._one("runtime_flags", key="storage_pressure")
        if flag is None:
            db._insert_internal("runtime_flags", {"key": "storage_pressure", "value": True})
        elif flag.get("value") is not True:
            db._update_internal("runtime_flags", flag, {"value": True, "updated_at": iso(db.now())})
        for chat in db._all("tg_chats"):
            if chat.get("retention_days") != 60:
                db._update_internal("tg_chats", chat, {"retention_days": 60})
    return total
