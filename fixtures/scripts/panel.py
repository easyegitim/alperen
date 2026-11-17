"""Panel mock verisi (fixtures/panel/*.json): dev-seed.json'dan türetilir; RPC/görünüm çıktılarının biçimindedir."""

from __future__ import annotations

from datetime import timedelta
from typing import Any

from fxlib import GROUP_A, LESSON_ID, NOW, STAFF, STUDENTS, iso

LABELS = {s["id"]: f"{s['first']} {s['last'][0]}." for s in STUDENTS.values()}
REFS = {s["id"]: s["ref"] for s in STUDENTS.values()}
SEVERITY_ORDER = {"danger": 0, "warning": 1, "neutral": 2}


def alert_contract(a: dict[str, Any]) -> dict[str, Any]:
    return {"schema_version": "1.0", "kind": a["kind"], "severity": a["severity"],
            "student_ref": REFS.get(a["student_id"]) if a["student_id"] else None,
            "staff_ref": a["staff_id"], "detail": a["detail"], "since": a["since"], "ref": a["ref"]}


def alerts(seed: dict[str, Any]) -> list[dict[str, Any]]:
    """Açık alarmlar: Acil → Dikkat → Bilgi, grup içinde en eski üstte (overview_orders_alerts_by_severity_then_age)."""
    rows = [a for a in seed["instructor_alerts"] if a["status"] == "open"]
    rows.sort(key=lambda a: (SEVERITY_ORDER[a["severity"]], a["since"]))
    return [dict(alert_contract(a), id=a["id"], status=a["status"],
                 student_label=LABELS.get(a["student_id"]) if a["student_id"] else None) for a in rows]


def overview(seed: dict[str, Any]) -> dict[str, Any]:
    open_alerts = [a for a in seed["instructor_alerts"] if a["status"] == "open"]
    series = []
    for i in range(14):
        day = (NOW - timedelta(days=13 - i)).date().isoformat()
        series.append({"day": day, "median_hours": [1.2, 0.8, None, 2.4, 1.6, 1.1, 0.9, 3.1, 1.4, None, 1.0, 2.2,
                                                    0.7, 1.5][i]})
    pilot = [{"metric": p["metric"], "period": p["period"], "value": p["value"]} for p in seed["pilot_metrics"]]
    ordered = sorted(open_alerts, key=lambda a: (SEVERITY_ORDER[a["severity"]], a["since"]))
    return {
        "tiles": {"unanswered": sum(1 for a in open_alerts if a["kind"] == "unanswered"),
                  "silent": sum(1 for a in open_alerts if a["kind"] == "silent"),
                  "deadlines": sum(1 for a in open_alerts if a["kind"] == "deadline"),
                  "response_hours": 1.4},
        "alerts": [alert_contract(a) for a in ordered],
        "response_series": series,
        "pilot": pilot,
    }


def lesson_analysis(seed: dict[str, Any]) -> dict[str, Any]:
    la = seed["lesson_analyses"][0]
    les = next(x for x in seed["lessons"] if x["id"] == LESSON_ID)
    return {"lesson": {k: v for k, v in les.items() if k != "video_ref"},
            "student_label": LABELS[STUDENTS["elif"]["id"]], "student_ref": STUDENTS["elif"]["ref"],
            "staff_name": STAFF["inst"]["full_name"], "analysis": la,
            "claims": [c for c in seed["lesson_claims"] if c["analysis_id"] == la["id"]],
            "cost_line": "Ders analizi: 0,41 $ (ayrı bütçe)"}


def bot_responses(seed: dict[str, Any]) -> list[dict[str, Any]]:
    out = []
    for r in seed["bot_responses"]:
        out.append(dict(r, student_label=LABELS.get(r["student_id"]) if r["student_id"] else None,
                        student_ref=REFS.get(r["student_id"]) if r["student_id"] else None,
                        memory_count=len(r["memory_fact_ids"])))
    return out


def queue(seed: dict[str, Any]) -> list[dict[str, Any]]:
    """v_review_queue satırları: (kind, ref_id, created_at, reason, student_ref, staff_hint)."""
    rows: list[dict[str, Any]] = []
    for q in seed["questions"]:
        if q["status"] == "pending_review":
            rows.append({"kind": "question", "ref_id": q["id"], "created_at": q["created_at"],
                         "reason": "Şekil incelemesi bekliyor" if q["figure_id"] else "Yeni LLM sorusu onay bekliyor",
                         "student_ref": None, "staff_hint": q["source"]})
    for f in seed["figures"]:
        if f["review_status"] == "pending":
            rows.append({"kind": "figure", "ref_id": f["id"], "created_at": f["created_at"],
                         "reason": "Şekil doğrulanmadı", "student_ref": None, "staff_hint": f["tool"]})
    for m in seed["misconceptions"]:
        if m["status"] == "pending_review":
            rows.append({"kind": "misconception", "ref_id": m["id"], "created_at": m["first_seen"],
                         "reason": m["text_instructor"], "student_ref": REFS[STUDENTS["mert"]["id"]],
                         "staff_hint": m["tag"]})
    for p in seed["content_pool"]:
        if p["status"] == "pending_review":
            rows.append({"kind": "pool", "ref_id": p["id"], "created_at": p["created_at"],
                         "reason": "Havuz açıklaması onay bekliyor", "student_ref": None, "staff_hint": p["kind"]})
    for la in seed["lesson_analyses"]:
        if la["status"] == "draft":
            rows.append({"kind": "lesson_analysis", "ref_id": la["id"], "created_at": la["created_at"],
                         "reason": "Ders raporu onay bekliyor", "student_ref": STUDENTS["elif"]["ref"],
                         "staff_hint": STAFF["inst"]["full_name"]})
    for r in seed["bot_responses"]:
        if r["flagged"]:
            rows.append({"kind": "flagged_response", "ref_id": str(r["id"]), "created_at": r["created_at"],
                         "reason": r["flag_reason"], "student_ref": REFS.get(r["student_id"]),
                         "staff_hint": STAFF["inst"]["full_name"]})
    for p in seed["exam_priority_plans"]:
        if p["status"] == "pending_review":
            rows.append({"kind": "priority_plan", "ref_id": p["id"], "created_at": p["created_at"],
                         "reason": "Öncelik planı onay bekliyor", "student_ref": None, "staff_hint": "TYT-MAT"})
    for o in seed["research_outputs"]:
        if o["status"] == "pending_review":
            rows.append({"kind": "research", "ref_id": o["id"], "created_at": o["created_at"],
                         "reason": "Araştırma çıktısı inceleme bekliyor", "student_ref": STUDENTS["elif"]["ref"],
                         "staff_hint": f"{len(o['output']['citations'])} atıf"})
    rows.sort(key=lambda r: r["created_at"])
    return rows


def consents(seed: dict[str, Any]) -> list[dict[str, Any]]:
    out = []
    for s in seed["students"]:
        given = [c for c in seed["consents"] if c["student_id"] == s["id"] and c["status"] == "given"]
        kinds = {c["kind"] for c in given}
        out.append({"student_id": s["id"], "public_ref": s["public_ref"], "label": LABELS[s["id"]],
                    "is_minor": s["is_minor"], "status": s["status"],
                    "consent_ok": "kvkk_aydinlatma" in kinds and (not s["is_minor"] or "veli_onayi" in kinds),
                    "missing": [k for k in (["kvkk_aydinlatma"] + (["veli_onayi"] if s["is_minor"] else []))
                                if k not in kinds],
                    "consents": given,
                    "guardian_code_open": any(g["student_id"] == s["id"] and g["used_at"] is None
                                              for g in seed["secure.guardian_codes"])})
    return out


def students(seed: dict[str, Any]) -> list[dict[str, Any]]:
    min_ev = next(r["value"] for r in seed["settings"] if r["key"] == "min_evidence")
    names = {s["id"]: s["name"] for s in seed["skills"]}
    out = []
    for s in seed["students"]:
        enr = next(e for e in seed["enrollments"] if e["student_id"] == s["id"])
        mastery = [{"skill_id": m["skill_id"], "skill_name": names[m["skill_id"]], "p": m["p"],
                    "evidence_count": m["evidence_count"], "is_reliable": m["evidence_count"] >= min_ev,
                    "band": "düşük" if m["p"] < 0.4 else "orta" if m["p"] < 0.7 else "yüksek",
                    "last_evidence_at": m["last_evidence_at"]}
                   for m in seed["mastery"] if m["enrollment_id"] == enr["id"]]
        mis = [m for m in seed["misconceptions"] if m["enrollment_id"] == enr["id"] and m["status"] in ("open", "resolved")]
        weekly = next((w for w in seed["weekly_summaries"] if w["student_id"] == s["id"]), None)
        quota = [q for q in seed["quota_usage"] if q["student_id"] == s["id"]]
        attempts = [a for a in seed["attempts"] if a["enrollment_id"] == enr["id"]][-5:]
        out.append({"student_id": s["id"], "public_ref": s["public_ref"], "label": LABELS[s["id"]],
                    "status": s["status"], "is_minor": s["is_minor"], "tier": s["tier"], "enrollment_id": enr["id"],
                    "period": enr["period_label"], "mastery": mastery, "open_misconceptions": mis,
                    "weekly_summary": weekly, "quota": quota, "recent_attempts": attempts,
                    "assigned_staff": [x["staff_id"] for x in seed["staff_students"] if x["student_id"] == s["id"]]})
    return out


def priority_plans(seed: dict[str, Any]) -> list[dict[str, Any]]:
    course = seed["courses"][0]
    return [dict(p, course_code=course["code"]) for p in sorted(seed["exam_priority_plans"],
                                                                 key=lambda p: p["created_at"], reverse=True)]


def chats(seed: dict[str, Any]) -> list[dict[str, Any]]:
    out = []
    for c in seed["tg_chats"]:
        if c["kind"] == "private":
            continue
        members = []
        for r in seed["chat_roles"]:
            if r["chat_id"] != c["chat_id"]:
                continue
            label = LABELS.get(r["student_id"]) if r["student_id"] else None
            if r["staff_id"]:
                label = next(s["full_name"] for s in STAFF.values() if s["id"] == r["staff_id"])
            members.append({"telegram_user_id": r["telegram_user_id"], "role": r["role"], "label": label,
                            "mention_handle": r["mention_handle"], "joined_at": r["joined_at"],
                            "consent_ok": bool(r["student_id"]) and r["student_id"] != STUDENTS["zeynep"]["id"]})
        out.append(dict(c, members=members))
    # yönetici olmayan ikinci grup (Notice warning "Bot yönetici değil")
    out.append({"chat_id": -1001000000003, "kind": "supergroup", "title": "Hafta sonu etüt grubu",
                "bot_is_admin": False, "bot_can_pin": False, "recording_notice_msg_id": 3,
                "recording_notice_legal_id": seed["tg_chats"][-1]["recording_notice_legal_id"],
                "privacy_mode_off_verified": False, "retention_days": 90, "recording_notice_days": 90,
                "group_auto_answer_min": 0, "created_at": "2026-10-17T10:30:00Z", "members": []})
    assert out[0]["chat_id"] == GROUP_A
    return out


def pilot(seed: dict[str, Any]) -> dict[str, Any]:
    """pilot_gate_matches_thresholds: question_accuracy n=11 < 30 → NO_DATA ⇒ Kapı KAPALI."""
    gate = next(r["value"] for r in seed["settings"] if r["key"] == "pilot_gate")
    metrics = seed["pilot_metrics"]
    expected = []
    for name, rule in gate.items():
        if isinstance(rule, str):
            expected.append({"metric": name, "verdict": "NO_DATA", "required": True, "value": None})
            continue
        m = next((x for x in metrics if x["metric"] == name), None)
        required = rule.get("required", True)
        value = m["value"] if m else None
        n = (m["detail"].get("n") or m["detail"].get("n_rated")) if m else None
        if value is None or ("n_min" in rule and (n or 0) < rule["n_min"]):
            verdict = "NO_DATA"
        elif "min" in rule:
            verdict = "PASS" if value >= rule["min"] else "FAIL"
        else:
            limit = rule.get("max", rule.get("max_usd"))
            verdict = "PASS" if value <= limit else "FAIL"
        expected.append({"metric": name, "verdict": verdict, "required": required, "value": value})
    gate_open = all(e["verdict"] == "PASS" for e in expected if e["required"])
    return {"pilot_gate": gate, "pilot_metrics": metrics, "expected": expected,
            "gate": "AÇIK" if gate_open else "KAPALI", "computed_at": iso(NOW)}

