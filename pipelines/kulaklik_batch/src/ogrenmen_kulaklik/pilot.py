"""Pilot ölçütleri (``pilot_metrics``; LLM yok) ve çeldirici raporu — BLUEPRINT §6.2 ``metrics``.

Her ölçüt satırı ``(metric, period, value, detail)``'dir; ``period`` hesaplanan haftanın pazartesisidir,
``detail`` yalnız sayılar taşır (öğrenci, kayıt ya da personel kimliği ve ad YOK). Az veride ``value=null``
(panel "henüz ölçülmedi" yazar; kapı ``NO_DATA`` sayar):

* ``diagnostic_agreement`` — teşhis bitiminden 14 gün sonra (pencere hafta sonunda tamamlanmış olmalı),
  teşhiste ``p < 0.4`` çıkan kazanımlardan pratik sorularda doğruluğu < %50 olanların payı; ``n`` = pratik verisi
  olan düşük kazanım sayısı; ``n < 10`` → null.
* ``citation_relevance`` — ``citations.status='kept'`` ve ``relevance`` dolu olanlarda ``relevance = 2`` payı;
  ``n_rated < 10`` → null.
* ``priority_uplift`` — onaylı planların kazanımlarında onaydan sonraki 14 günün ortalama ``p_after − p_before``
  farkı eksi aynı öğrencilerin plan dışı kazanımlarındaki ortalama fark (pencere tamamlanmamış ya da plan yok → null).
* ``cost_per_student`` — ayın ``spend_ledger`` toplamı (``cap_excluded_purposes`` HARİÇ) / aktif öğrenci;
  ``detail.lesson_usd`` ders amaçlarının toplamıdır ve öğrenci başına maliyete dahil edilmez.
* ``flagged_response_share`` — haftanın ``bot_responses``'ında ``flagged=true`` payı.
* ``degraded_share`` — haftanın ``bot_responses``'ında ``purpose='degraded'`` veya ``schema_valid=false`` payı.
* ``question_accuracy`` — ``questions.source='llm'`` ve ``reviewed_at`` haftada olanlarda
  ``approved / (approved + rejected)``; ``by_reason`` ``review_note``'un ilk kelimesi; ``n < 10`` → null.
* ``distractor_unused_share`` — denenmiş onaylı sorulardaki etiketli çeldiricilerden hiç seçilmeyenlerin payı
  (M09 ``distractor-report`` ile aynı tanım; ayrıntı ``out/distractor_report.json``).
"""

from __future__ import annotations

from collections import Counter
from datetime import datetime, timedelta
from typing import Any

from ogrenmen_common.clock import iso, parse_ts
from ogrenmen_common.errors import DbError, DbPermissionError

from .common import (
    Students,
    Window,
    excluded_purposes,
    insert_minimal,
    is_duplicate,
    month_window,
    select_days,
    select_in,
    select_window,
)

MIN_N_VALUE = 10
"""``value`` yazılması için en az örnek (``question_accuracy``, ``diagnostic_agreement``, ``citation_relevance``)."""
METRICS = ("diagnostic_agreement", "citation_relevance", "priority_uplift", "cost_per_student",
           "distractor_unused_share", "flagged_response_share", "degraded_share", "question_accuracy")
"""``pilot_metrics.metric`` check kısıtındaki değerler (aynı sıra)."""


def _ratio(num: int, den: int, *, min_n: int = 1) -> float | None:
    if den <= 0 or den < min_n:
        return None
    return round(num / den, 4)


def _first_word(text: Any) -> str:
    words = str(text or "").strip().split()
    return words[0].strip(".,;:") if words else "belirtilmedi"


def _skill_of_questions(db: Any, ids: list[str]) -> dict[str, str]:
    out = {}
    for q in select_in(db, "questions", "id", ids, columns=("id", "skill_ids")):
        skills = q.get("skill_ids") or []
        if skills:
            out[str(q["id"])] = skills[0]
    return out


def diagnostic_agreement(db: Any, window: Window) -> dict[str, Any]:
    end = window.end_ts
    sessions = [s for s in db.select("diagnostic_sessions", where={"status": "finished"})
                if s.get("finished_at") and parse_ts(s["finished_at"]) + timedelta(days=14) <= end]
    low_pairs: list[tuple[dict, str]] = []
    for s in sessions:
        for row in (s.get("result") or {}).get("per_skill") or []:
            if row.get("p") is not None and float(row["p"]) < 0.4:
                low_pairs.append((s, row["skill_id"]))
    enrollments = sorted({str(s["enrollment_id"]) for s, _ in low_pairs})
    attempts = select_in(db, "attempts", "enrollment_id", enrollments, where={"context": "practice"},
                         columns=("enrollment_id", "question_id", "is_correct", "created_at"))
    skill_of = _skill_of_questions(db, sorted({str(a["question_id"]) for a in attempts}))
    num = den = 0
    for s, skill in low_pairs:
        start = parse_ts(s["finished_at"])
        stop = start + timedelta(days=14)
        graded = [a for a in attempts if str(a["enrollment_id"]) == str(s["enrollment_id"])
                  and skill_of.get(str(a["question_id"])) == skill and a.get("is_correct") is not None
                  and start < parse_ts(a["created_at"]) <= stop]
        if not graded:
            continue
        den += 1
        acc = sum(1 for a in graded if a["is_correct"]) / len(graded)
        if acc < 0.5:
            num += 1
    return {"value": _ratio(num, den, min_n=MIN_N_VALUE),
            "detail": {"n": den, "numerator": num, "denominator": den, "n_sessions": len(sessions)}}


def citation_relevance(db: Any, window: Window) -> dict[str, Any]:
    kept = db.select("citations", where={"status": "kept"}, columns=("relevance",))
    rated = [c for c in kept if c.get("relevance") is not None]
    supported = sum(1 for c in rated if int(c["relevance"]) == 2)
    return {"value": _ratio(supported, len(rated), min_n=MIN_N_VALUE),
            "detail": {"n_rated": len(rated), "n_total": len(kept), "n_supported": supported}}


def priority_uplift(db: Any, window: Window) -> dict[str, Any]:
    end = window.end_ts
    plans = db.select("exam_priority_plans", where={"status": "approved"})
    courses = {str(c["id"]): c for c in db.select("courses")}
    complete = [p for p in plans if p.get("approved_at") and parse_ts(p["approved_at"]) + timedelta(days=14) <= end]
    deltas_in: list[float] = []
    deltas_out: list[float] = []
    students: set[str] = set()
    for p in complete:
        course = courses.get(str(p["course_id"]))
        if course is None:
            continue
        skills = {r.get("skill_id") for r in (p.get("plan") or {}).get("rows") or [] if r.get("skill_id")}
        enrollments = [str(e["id"]) for e in db.select("enrollments", where={"curriculum_id": course["curriculum_id"]})]
        start = parse_ts(p["approved_at"])
        stop = start + timedelta(days=14)
        history = [h for h in select_in(db, "mastery_history", "enrollment_id", enrollments)
                   if start < parse_ts(h["created_at"]) <= stop]
        pairs: dict[tuple[str, str], list[dict]] = {}
        for h in sorted(history, key=lambda h: (parse_ts(h["created_at"]), int(h["id"]))):
            pairs.setdefault((str(h["enrollment_id"]), h["skill_id"]), []).append(h)
        for (enr, skill), rows in pairs.items():
            before = rows[0].get("p_before")
            before = float(before) if before is not None else float(rows[0]["p_after"])
            delta = float(rows[-1]["p_after"]) - before
            students.add(enr)
            (deltas_in if skill in skills else deltas_out).append(delta)
    d_in = round(sum(deltas_in) / len(deltas_in), 4) if deltas_in else None
    d_out = round(sum(deltas_out) / len(deltas_out), 4) if deltas_out else None
    value = round(d_in - d_out, 4) if d_in is not None and d_out is not None else None
    return {"value": value, "detail": {"plan_ids": sorted(str(p["id"]) for p in complete),
                                       "n_plans_pending": len(plans) - len(complete), "n_students": len(students),
                                       "delta_in": d_in, "delta_out": d_out}}


def month_spend(db: Any, month: Window) -> tuple[float, float]:
    """``(sohbet/toplu, ders)`` — ``spend_ledger`` ayı; ders amaçları ``cap_excluded_purposes``."""
    excluded = set(excluded_purposes(db))
    chat = lesson = 0.0
    for row in select_days(db, "spend_ledger", "day", month):
        cost = float(row.get("cost_usd") or 0)
        if row.get("purpose") in excluded:
            lesson += cost
        else:
            chat += cost
    return round(chat, 6), round(lesson, 6)


def cost_per_student(db: Any, window: Window) -> dict[str, Any]:
    last_day = window.end - timedelta(days=1)
    month = month_window(f"{last_day:%Y-%m}")
    chat, lesson = month_spend(db, month)
    active = len(Students.load(db).active_ids())
    value = round(chat / active, 4) if active else None
    return {"value": value, "detail": {"month": f"{last_day:%Y-%m}", "month_usd": round(chat, 4),
                                       "active_students": active, "lesson_usd": round(lesson, 4)}}


def week_responses(db: Any, window: Window) -> list[dict]:
    return select_window(db, "bot_responses", "created_at", window,
                         columns=("id", "purpose", "flagged", "flag_reason", "schema_valid", "provider_attempts"))


def flagged_response_share(db: Any, window: Window) -> dict[str, Any]:
    rows = week_responses(db, window)
    flagged = [r for r in rows if r.get("flagged")]
    reasons = Counter(_first_word(r.get("flag_reason")) for r in flagged)
    return {"value": _ratio(len(flagged), len(rows)),
            "detail": {"n": len(rows), "flagged": len(flagged), "by_reason": dict(sorted(reasons.items()))}}


def degraded_share(db: Any, window: Window) -> dict[str, Any]:
    rows = week_responses(db, window)
    degraded = sum(1 for r in rows if r.get("purpose") == "degraded")
    invalid = sum(1 for r in rows if r.get("schema_valid") is False)
    either = sum(1 for r in rows if r.get("purpose") == "degraded" or r.get("schema_valid") is False)
    repaired = sum(1 for r in rows if r.get("schema_valid") is True
                   and any(a.get("status") == "bad_output" for a in r.get("provider_attempts") or []))
    return {"value": _ratio(either, len(rows)),
            "detail": {"n": len(rows), "degraded": degraded, "schema_invalid": invalid, "repaired": repaired}}


def question_accuracy(db: Any, window: Window) -> dict[str, Any]:
    rows = select_window(db, "questions", "reviewed_at", window, where={"source": "llm"},
                         columns=("status", "review_note", "reviewed_at"))
    approved = sum(1 for r in rows if r.get("status") == "approved")
    rejected = [r for r in rows if r.get("status") == "rejected"]
    n = approved + len(rejected)
    reasons = Counter(_first_word(r.get("review_note")) for r in rejected)
    return {"value": _ratio(approved, n, min_n=MIN_N_VALUE),
            "detail": {"n": n, "approved": approved, "rejected": len(rejected), "by_reason": dict(reasons)}}


def distractor_report(db: Any) -> dict[str, Any]:
    """Etiket başına seçilme oranı ve hiç seçilmeyen çeldiriciler (yeniden yazım adayı)."""
    questions = [q for q in db.select("questions", where={"status": "approved"}, columns=("id", "options"))
                 if q.get("options")]
    attempts = select_in(db, "attempts", "question_id", [q["id"] for q in questions],
                         columns=("question_id", "chosen"))
    by_q: dict[str, Counter] = {}
    for a in attempts:
        key = (a.get("chosen") or {}).get("key")
        by_q.setdefault(str(a["question_id"]), Counter())[key] += 1
    tags: dict[str, dict[str, int]] = {}
    unused: list[dict] = []
    n = 0
    for q in questions:
        counts = by_q.get(str(q["id"]))
        if not counts:
            continue
        total = sum(counts.values())
        for opt in q["options"]:
            tag = opt.get("misconception_tag")
            if not tag:
                continue
            n += 1
            chosen = counts.get(opt.get("key"), 0)
            t = tags.setdefault(tag, {"offered": 0, "chosen": 0})
            t["offered"] += total
            t["chosen"] += chosen
            if chosen == 0:
                unused.append({"question_id": str(q["id"]), "key": opt.get("key"), "tag": tag})
    rates = {tag: {**v, "rate": round(v["chosen"] / v["offered"], 4) if v["offered"] else None}
             for tag, v in sorted(tags.items())}
    return {"n": n, "unused": len(unused), "value": _ratio(len(unused), n), "by_tag": rates,
            "rewrite_candidates": unused}


def distractor_unused_share(db: Any, window: Window) -> dict[str, Any]:
    rep = distractor_report(db)
    return {"value": rep["value"], "detail": {"n": rep["n"], "unused": rep["unused"]}}


CALCULATORS = {
    "diagnostic_agreement": diagnostic_agreement,
    "citation_relevance": citation_relevance,
    "priority_uplift": priority_uplift,
    "cost_per_student": cost_per_student,
    "distractor_unused_share": distractor_unused_share,
    "flagged_response_share": flagged_response_share,
    "degraded_share": degraded_share,
    "question_accuracy": question_accuracy,
}


def compute(db: Any, window: Window) -> list[dict]:
    """Sekiz ölçüt satırı (``period`` = haftanın pazartesisi); yazmaz."""
    rows = []
    for metric in METRICS:
        try:
            res = CALCULATORS[metric](db, window)
        except DbError:  # ör. kaynak tablo bu rolle okunamıyor: ölçülemedi (kapı NO_DATA sayar), iş durmaz
            res = {"value": None, "detail": {"n": 0, "unavailable": True}}
        rows.append({"metric": metric, "period": window.period.isoformat(), "value": res["value"],
                     "detail": res["detail"]})
    return rows


def write(db: Any, rows: list[dict], now: datetime) -> dict[str, Any]:
    """``pilot_metrics`` yazımı (PK ``metric, period``; ``batch_worker`` ``w u`` — SELECT yok).

    Yazım ``RETURNING`` olmadan yapılır (``insert_minimal``). Önce upsert (``on_conflict='merge'``) denenir;
    ``ON CONFLICT DO UPDATE`` çakışma sütunlarında SELECT ister ve ``batch_worker``'da bu yetki yoktur, o yüzden
    yetki hatasında satır başına düz eklemeye düşülür: aynı ``(metric, period)`` zaten varsa satır "zaten
    yazılmış" sayılır (değeri o haftanın ilk hesabında kalır). SELECT yetkisi verilince upsert kendiliğinden
    çalışır (README "Sapma notları")."""
    stamped = [dict(row, computed_at=iso(now)) for row in rows]
    result: dict[str, Any] = {"mode": "upsert", "written": 0, "already_written": [], "errors": {}}
    try:
        insert_minimal(db, "pilot_metrics", stamped, on_conflict="merge")
        result["written"] = len(stamped)
        return result
    except DbPermissionError as exc:
        result["mode"] = "insert"
        result["upsert_error"] = exc.message
    for row in stamped:
        try:
            insert_minimal(db, "pilot_metrics", row)
            result["written"] += 1
        except DbError as exc:
            if is_duplicate(exc):
                result["already_written"].append(row["metric"])
            else:
                result["errors"][row["metric"]] = exc.message
    return result
