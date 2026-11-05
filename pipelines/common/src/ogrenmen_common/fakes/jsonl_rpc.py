"""JsonlDb RPC eşlenikleri — pipeline'ların (``service_role``) çağırdığı ``public`` fonksiyonların Python karşılığı.

İki küme vardır (adların listesi ``fakes/rpc-names.json``'dadır; test bunu ``RPCS`` ile eşler):

* ``v2``: ``supabase/migrations/0017_rpc.sql``'de bulunan fonksiyonlar (``check_spend``, ``set_runtime_flag``,
  ``log_llm_call``); gövdeler aynı hata kodlarını ve yan etkileri izler.
* ``legacy-v1``: v2 migration'larında karşılığı OLMAYAN ve kod yolları P3 (tablet doğrulama servisi) ile P5 (ders HTTP
  servisi) gelene dek ayakta tutulan eşlenikler (cevap anahtarı/şablon soruları, ders etiketleri,
  ``profile_for_prompt``, video silme onayı). RPC paritesi bunları atlar (WARN); canlı DB'de bu çağrılar çalışmaz.
  ``register_lesson`` ve ``write_lesson_analysis`` P5'te v2'de doğdu (supabase 0040, farklı imza): v1 eşlenikleri ve
  pipelines/ders v1 çağrıları kaldırıldı; ders hattı apps/worker ``lesson.*`` işleri + pipelines/ders servisidir.

SQL'de tek işlem olan gövdelerde tüm denetimler yazımdan **önce** yapılır, böylece hata yarım yazım bırakmaz.
Dönüş biçimi PostgREST'in JSON'uyla aynıdır: ``returns table`` → satır listesi, ``jsonb`` → sözlük,
``uuid``/``int`` → değer, ``void`` → ``None``.
"""

from __future__ import annotations

import re
from collections.abc import Callable, Mapping
from typing import TYPE_CHECKING, Any

from ogrenmen_pii import name_token_hashes

from ..clock import iso, istanbul_date, month_start, parse_ts
from ..errors import DbError, RpcError

if TYPE_CHECKING:  # pragma: no cover
    from .jsonl_db import JsonlDb

RPCS: dict[str, Callable[..., Any]] = {}



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
    """Worker (``service_role``) ve imtiyazlı roller (legacy ``batch_worker`` adı da kabul)."""
    if db.role not in ("batch_worker", "service_role", "postgres"):
        raise RpcError(code)


def _require_batch_worker(db: JsonlDb, code: str) -> None:
    """Anahtar RPC'leri (legacy-v1): yalnız worker rolü (``service_role``; eski ``batch_worker`` adı da);
    ``postgres`` ve uygulama rolleri reddedilir (v1 gövdesindeki ``jwt_role`` kapısıyla aynı davranış)."""
    if db.role not in ("batch_worker", "service_role"):
        raise RpcError(f"{code} anahtar yalnız worker (service_role) rolüyle yazılır")


def _band(p: float) -> str:
    return "düşük" if p < 0.4 else "orta" if p < 0.7 else "yüksek"


def _active_enrollment(db: JsonlDb, student_id: str) -> dict | None:
    rows = [e for e in db._find("enrollments", student_id=student_id, status="active")]
    rows.sort(key=lambda e: str(e.get("started_at") or ""), reverse=True)
    return rows[0] if rows else None


def _open_alert(db: JsonlDb, row: Mapping[str, Any]) -> dict | None:
    """``alerts_dedup`` benzersiz indeksi: (kind, student, ref anahtarı, detail[:24]) açıkken tek satır."""
    def ref_key(ref: Mapping[str, Any]) -> str:
        for k in ("message_id", "fact_id", "escalation_id", "lesson_id", "source_id"):
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


# --- harcama ve bayraklar (v2) ------------------------------------------------------------------


@rpc
def check_spend(db: JsonlDb, p_purpose: str, p_student_ref: str | None = None) -> list[dict]:
    """Yumuşak harcama tavanı (0017_rpc.sql): günlük/aylık kuruluş toplamı (``spend_ledger``, Istanbul günü) ve öğrenci
    başına aylık toplam (``llm_calls.student_ref``); aşım engellemez, ``downgrade = true`` verir.
    ``cap_excluded_purposes`` listesindeki amaçlar tavana takılmaz."""
    today = db.today()
    first = month_start(today)
    d = m = 0.0
    for row in db._all("spend_ledger"):
        day = parse_ts(row["day"]).date()
        if day >= first:
            cost = float(row.get("cost_usd") or 0)
            m += cost
            if day == today:
                d += cost
    stu = 0.0
    if p_student_ref:
        for c in db._all("llm_calls"):
            created = parse_ts(c.get("created_at") or db.now())
            if c.get("student_ref") == p_student_ref and istanbul_date(created) >= first:
                stu += float(c.get("cost_usd") or 0)
    excluded = list(_flag(db, "cap_excluded_purposes", []) or [])
    skip = p_purpose in excluded
    paid = bool(_flag(db, "paid_llm_enabled", False))
    deg = bool(_flag(db, "degraded_mode", False))
    dc = float(_flag(db, "daily_cap_usd", 0) or 0)
    mc = float(_flag(db, "monthly_cap_usd", 0) or 0)
    sc = float(_flag(db, "student_monthly_cap_usd", 0) or 0)
    thresholds = _flag(db, "alert_thresholds", []) or []
    alert = max([float(t) for t in thresholds
                 if (dc > 0 and d >= float(t) * dc) or (mc > 0 and m >= float(t) * mc)] or [0.0])
    over = not skip and ((dc > 0 and d >= dc) or (mc > 0 and m >= mc))
    stu_over = not skip and bool(p_student_ref) and sc > 0 and stu >= sc
    if not paid:
        state = "disabled"
    elif deg:
        state = "degraded"
    elif stu_over:
        state = "student_cap"
    elif over:
        state = "soft_cap"
    else:
        state = "normal"
    return [{
        "paid_allowed": paid and not deg, "degraded": deg, "downgrade": over or stu_over, "state": state,
        "day_usd": round(d, 6), "month_usd": round(m, 6), "daily_cap": dc, "monthly_cap": mc,
        "student_month_usd": round(stu, 6), "student_cap": sc, "alert_level": alert,
    }]


@rpc
def set_runtime_flag(db: JsonlDb, p_key: str, p_value: Any) -> None:
    """``runtime_flags`` upsert (yalnız admin ve worker; 0017_rpc.sql); denetim izine yazılır."""
    if db.role not in ("service_role", "postgres", "admin"):
        raise RpcError("OGR-AUTH-002 çalışma bayrağını yalnız admin değiştirir")
    if not str(p_key or "").strip() or p_value is None:
        raise RpcError("OGR-FLAG-001 anahtar ve değer gerekli")
    row = db._one("runtime_flags", key=p_key)
    values = {"value": p_value, "updated_at": iso(db.now()), "updated_by": "worker"}
    if row is None:
        db._insert_internal("runtime_flags", {"key": p_key, **values})
    else:
        db._update_internal("runtime_flags", row, values)
    _audit(db, "runtime_flag.set", "public.runtime_flags", p_key, {"value": p_value}, actor_id="worker")


@rpc
def log_llm_call(db: JsonlDb, p_call: Mapping[str, Any]) -> int:
    """``llm_calls`` satırı yazar (tetikleyici ``spend_ledger``'ı günceller); id döner (0017_rpc.sql)."""
    if db.role not in ("service_role", "postgres", "admin", "instructor"):
        raise RpcError("OGR-AUTH-002 LLM defterine yalnız worker ve personel yazar")
    if not isinstance(p_call, Mapping) or not all(p_call.get(k) for k in ("purpose", "model", "status")):
        raise RpcError("OGR-LLM-001 purpose, model, status gerekli")
    row = dict(p_call)
    got = db._insert_internal("llm_calls", row)
    return got["id"]



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
    _queue_proactive(db, {"student_id": sid, "recipient": "student",
                          "template_id": "video_deleted", "params": params, "scheduled_for": now})
    _queue_proactive(db, {"student_id": sid, "recipient": "guardian", "template_id": "video_deleted", "params": params,
                          "scheduled_for": now})
    _audit(db, "RPC:confirm_video_deleted", "lessons", p_lesson, actor_id="batch_worker:ders")


# --- saklama ve bakım ---------------------------------------------------------------------------

_COND = re.compile(r"^\s*([a-z_][a-z0-9_]*)\s*(=|is not|is)\s*(.+?)\s*$", re.I)
