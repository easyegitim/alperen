"""Kulaklık toplu işleri fixture'ları (fixtures/kulaklik/): günün mesajları, gece olgu çıktıları, haftalık bot
cevapları, soru inceleme örneklemi, grup sohbetleri, ders kaynaklı moral olguları ve aylık maliyet defteri."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any

import lesson
from content import sk
from fxlib import CURRICULUM_ID, ENROLL, GROUP_C, GROUP_C_TITLE, STAFF, STUDENTS, iso, uid

DAY = "2026-10-18"


def local_day(ts: str) -> str:
    return (datetime.fromisoformat(ts.replace("Z", "+00:00")) + timedelta(hours=3)).date().isoformat()


def messages_day(seed: dict[str, Any]) -> list[dict[str, Any]]:
    """batch_worker görünümü: text_raw sütunu YOK (sütun yetkisi yok); yalnız 18 Ekim (İstanbul) mesajları."""
    out = []
    for m in seed["messages"]:
        if local_day(m["sent_at"]) == DAY:
            out.append({k: v for k, v in m.items() if k != "text_raw"})
    return out


def nightly_outputs(by_text: dict[str, int]) -> list[dict[str, Any]]:
    """Günün LLM çıktısı (nightly-facts-output); mesaj numaraları messages-day.json'daki id'lerdir."""

    def mid(prefix: str) -> int:
        return next(i for t, i in by_text.items() if t.startswith(prefix))

    e, mt = STUDENTS["elif"]["ref"], STUDENTS["mert"]["ref"]
    elif_out = {
        "schema_version": "1.0", "day": DAY, "student_ref": e,
        "facts": [
            {"schema_version": "1.0", "student_ref": e, "kind": "deadline", "text": "Öğrencinin Cuma günü deneme sınavı var.",
             "source_message_ids": [mid("Cuma günü deneme")], "confidence": 0.85, "valid_until": "2026-10-23",
             "morale_signal": None, "requires_approval": False, "skill_id": None},
            {"schema_version": "1.0", "student_ref": e, "kind": "promise",
             "text": "Öğrenci ertesi akşam 10 soru çözeceğine söz verdi.", "source_message_ids": [mid("Bugün biraz yorgunum")],
             "confidence": 0.8, "valid_until": "2026-10-19", "morale_signal": None, "requires_approval": False,
             "skill_id": None},
            {"schema_version": "1.0", "student_ref": e, "kind": "morale",
             "text": "Öğrenci yorgun olduğunu söyledi ama çalışmaya devam etmek istiyor.",
             "source_message_ids": [mid("Bugün biraz yorgunum")], "confidence": 0.7, "valid_until": None,
             "morale_signal": -1, "requires_approval": False, "skill_id": None},
            {"schema_version": "1.0", "student_ref": e, "kind": "topic_asked",
             "text": "Öğrenci rasyonel sayılarda toplamayı sordu; payları ve paydaları ayrı topladı.",
             "source_message_ids": [mid("3/4 + 1/8 kaç oluyor"), mid("6/8 + 1/8")], "confidence": 0.9,
             "valid_until": None, "morale_signal": None, "requires_approval": False,
             "skill_id": sk("temel.rasyonel-sayilar")},
        ],
        "is_question_message_ids": [mid("3/4 + 1/8 kaç oluyor"), mid("6/8 + 1/8"), mid("@hoca mutlak")],
        "answered_question_message_ids": [mid("3/4 + 1/8 kaç oluyor"), mid("6/8 + 1/8"), mid("@hoca mutlak")],
        "preferences": {"modality": "verbal", "explanation_notes": "Kısa adımlarla ilerlemek işe yarıyor.",
                        "active_hours": [19, 20, 21]},
    }
    mert_out = {
        "schema_version": "1.0", "day": DAY, "student_ref": mt,
        "facts": [
            {"schema_version": "1.0", "student_ref": mt, "kind": "deadline",
             "text": "Öğrencinin matematik ödevini pazartesiye kadar teslim etmesi gerekiyor.",
             "source_message_ids": [mid("Matematik ödevini")], "confidence": 0.8, "valid_until": "2026-10-26",
             "morale_signal": None, "requires_approval": False, "skill_id": None},
            {"schema_version": "1.0", "student_ref": mt, "kind": "unanswered_question",
             "text": "Öğrenci deneme sınavının saatini sordu; henüz cevap verilmedi.",
             "source_message_ids": [mid("Yarın deneme sınavı")], "confidence": 0.75, "valid_until": None,
             "morale_signal": None, "requires_approval": False, "skill_id": None},
            {"schema_version": "1.0", "student_ref": mt, "kind": "morale",
             "text": "Öğrenci kesirlerde zorlandığını ve konunun oturmadığını söyledi.",
             "source_message_ids": [mid("Kesirlerde hâlâ")], "confidence": 0.7, "valid_until": None,
             "morale_signal": -1, "requires_approval": False, "skill_id": sk("temel.rasyonel-sayilar")},
            {"schema_version": "1.0", "student_ref": mt, "kind": "other",
             "text": "Öğrenci bu haftaki notunu sordu; soru eğitmene iletildi.",
             "source_message_ids": [mid("Bu hafta notum")], "confidence": 0.8, "valid_until": None,
             "morale_signal": None, "requires_approval": True, "skill_id": None},
        ],
        "is_question_message_ids": [mid("Yarın deneme sınavı"), mid("Bu hafta notum")],
        "answered_question_message_ids": [],
        "preferences": {"modality": "mixed", "active_hours": [21]},
    }
    elif_alt = {
        "schema_version": "1.0", "day": DAY, "student_ref": e,
        "facts": [
            {"schema_version": "1.0", "student_ref": e, "kind": "preference",
             "text": "Öğrenci soruları kendi denemesiyle birlikte paylaşmayı tercih ediyor.",
             "source_message_ids": [mid("3/4 + 1/8 kaç oluyor")], "confidence": 0.6, "valid_until": None,
             "morale_signal": None, "requires_approval": False, "skill_id": None},
            {"schema_version": "1.0", "student_ref": e, "kind": "topic_asked",
             "text": "Öğrenci mutlak değerde iki durumu anlamadığını grupta eğitmene sordu.",
             "source_message_ids": [mid("@hoca mutlak")], "confidence": 0.85, "valid_until": None,
             "morale_signal": None, "requires_approval": False, "skill_id": sk("cebir.mutlak-deger")},
        ],
        "is_question_message_ids": [mid("@hoca mutlak")],
        "answered_question_message_ids": [mid("@hoca mutlak")],
    }
    return [elif_out, mert_out, elif_alt]


def questions_review() -> list[dict[str, Any]]:
    """12 source='llm' soru: 8 approved, 3 rejected (review_note nedenli), 1 pending (question_accuracy 8/11)."""
    specs = [
        ("temel.rasyonel-sayilar", "`5/6 - 1/4` işleminin sonucu kaçtır?", "approved", None),
        ("temel.rasyonel-sayilar", "`2/5 + 1/10` işleminin sonucu kaçtır?", "approved", None),
        ("temel.ondalik", "`0,25` ondalık sayısının kesir karşılığı hangisidir?", "approved", None),
        ("cebir.oran-oranti", "3 yumurtaya 2 bardak un giderse 9 yumurtaya kaç bardak un gider?", "approved", None),
        ("problem.kesir", "Bir kitabın `1/4`'ü okunmuşsa kalanı kitabın kaçta kaçıdır?", "approved", None),
        ("problem.yuzde", "120 TL'lik ürüne %15 indirim yapılırsa fiyat kaç TL olur?", "approved", None),
        ("cebir.mutlak-deger", "`|x + 1| = 4` denkleminin çözüm kümesi hangisidir?", "approved", None),
        ("temel.uslu", "`5^3 · 5^(-1)` ifadesinin değeri kaçtır?", "approved", None),
        ("temel.koklu", "`√18 + √8` ifadesinin değeri kaçtır?", "rejected", "SymPy doğrulaması başarısız"),
        ("problem.hareket", "Saatte 80 km giden araç 90 dakikada kaç km gider?", "rejected",
         "Çeldirici iki şık aynı değeri veriyor"),
        ("cebir.esitsizlik", "Şekildeki sayı doğrusunda gösterilen aralık hangisidir?", "rejected",
         "Şekil kökle uyuşmuyor"),
        ("problem.isci", "İki işçi bir işi birlikte kaç günde bitirir?", "pending_review", None),
    ]
    rows = []
    for i, (skill, stem, status, note) in enumerate(specs, start=1):
        reviewed = status != "pending_review"
        rows.append({
            "id": uid("question", f"review-{i:02d}"), "curriculum_id": CURRICULUM_ID, "skill_ids": [sk(skill)],
            "kind": "mcq", "stem": stem, "source": "llm", "status": status, "difficulty": 0.5,
            "verification": {"schema": True, "sympy": "failed" if note and "SymPy" in note else "verified",
                             "render": "not_applicable", "vision": "mismatch" if note and "Şekil" in note else
                             "not_applicable", "attempts": 1},
            "model": "gemini-2.5-flash-lite", "cost_usd": 0.0003, "prompt_version": "question_gen.v1",
            "reviewed_by": STAFF["inst"]["id"] if reviewed else None,
            "reviewed_at": iso(datetime(2026, 10, 13, 9, tzinfo=UTC) + timedelta(hours=11 * i)) if reviewed else None,
            "review_note": note, "created_at": iso(datetime(2026, 10, 12, 22, tzinfo=UTC) + timedelta(hours=5 * i)),
        })
    return rows


def chats() -> list[dict[str, Any]]:
    """İki grup, ikisinde de bot yönetici değil → iki ayrı 'ops' alarmı (ref.chat_id farklı)."""
    base = {"kind": "supergroup", "bot_is_admin": False, "bot_can_pin": False, "recording_notice_msg_id": 3,
            "recording_notice_legal_id": uid("legal_text", "grup_kayit"), "privacy_mode_off_verified": True,
            "retention_days": 90, "recording_notice_days": 90, "group_auto_answer_min": 0}
    return [dict(base, chat_id=GROUP_C, title=GROUP_C_TITLE, created_at="2026-10-17T10:30:00Z"),
            dict(base, chat_id=-1001000000004, title="TYT Matematik · Pilot C", created_at="2026-10-18T08:00:00Z",
                 privacy_mode_off_verified=False)]


def lesson_morale() -> dict[str, list[dict[str, Any]]]:
    """Mert'in son 7 günde 3 dersi: talk.morale='low' claim'leri onaylı → memory_facts(kind='morale',
    morale_signal=-2) × 3 (embedding null: reembed --missing doldurur) → 1 'morale' warning alarmı."""
    lessons, analyses, claims, facts = [], [], [], []
    for i, (day, ratio) in enumerate([(14, 0.22), (16, 0.18), (18, 0.25)], start=1):
        lid = uid("lesson", f"mert-morale-{i}")
        aid = uid("lesson_analysis", f"mert-morale-{i}")
        cid = uid("lesson_claim", f"mert-morale-{i}")
        held = datetime(2026, 10, day, 15, 0, tzinfo=UTC)
        lessons.append({"id": lid, "enrollment_id": ENROLL["mert"], "staff_id": STAFF["inst"]["id"], "held_at": iso(held),
                        "duration_min": 60, "video_ref": f"local:mert-{day}.mp4", "video_deleted_at": None,
                        "deletion_notified_at": None, "transcript_path": f"transcripts/{lid}.jsonl", "frames_count": 24,
                        "status": "approved", "created_at": iso(held + timedelta(hours=2))})
        analysis = lesson.analysis_morale(lid, ratio, day)
        analyses.append({"id": aid, "lesson_id": lid, "version": 1, "seed_profile": lesson.seed_profile_morale(),
                         "analysis": analysis, "model": "gemini-2.5-pro",
                         "cost_usd": analysis["model_notes"]["cost_usd"], "status": "approved",
                         "approved_by": STAFF["inst"]["id"], "approved_at": iso(held + timedelta(hours=5)),
                         "created_at": iso(held + timedelta(hours=2))})
        talk = analysis["talk"]
        value = {k: talk[k] for k in ("student_ratio", "student_questions", "attention", "morale")}
        claims.append({"id": cid, "analysis_id": aid, "kind": "talk", "curriculum_id": CURRICULUM_ID, "skill_id": None,
                       "misconception_tag": None, "misconception_id": None, "value": value,
                       "quote": talk["notes"], "speaker": "EĞİTMEN", "t_start_sec": 0,
                       "t_end_sec": None, "status": "approved", "edited_value": None,
                       "decided_by": STAFF["inst"]["id"], "decided_at": iso(held + timedelta(hours=5))})
        facts.append({"id": 100 + i, "student_id": STUDENTS["mert"]["id"], "kind": "morale",
                      "text": f"Derste moral: düşük; konuşma oranı %{round(ratio * 100)}",
                      "source_message_ids": [], "source_lesson_claim_id": cid, "confidence": 0.8,
                      "requires_approval": False, "approved": False, "approved_by": None,
                      "valid_from": f"2026-10-{day}", "valid_until": None, "morale_signal": -2, "status": "active",
                      "embedding": None, "model": "gemini-2.5-pro", "cost_usd": 0,
                      "created_at": iso(held + timedelta(hours=5))})
    return {"lessons": lessons, "lesson_analyses": analyses, "lesson_claims": claims, "memory_facts": facts}


def llm_calls_month() -> list[dict[str, Any]]:
    """Ekim 2026: sohbet toplamı 3,00 $ (30 × 0,10 $), ders analizi 2 × 0,45 $ (cap_excluded)."""
    rows = []
    for i in range(30):
        rows.append({"id": i + 1, "purpose": "chat", "provider": "gemini-paid", "model": "gemini-2.5-flash-lite",
                     "tokens_in": 1800 * 400, "tokens_out": 160 * 400, "audio_sec": None, "images": None,
                     "batch": False, "status": "ok", "error_code": None, "latency_ms": 950, "cost_usd": 0.10,
                     "ref_table": "bot_responses", "ref_id": f"agg-{i + 1}",
                     "student_ref": [s["ref"] for s in STUDENTS.values()][i % 2], "created_at": f"2026-10-{1 + i % 19:02d}T17:00:00Z"})
    # lesson-morale.json'daki ilk iki dersin analiz çağrıları (cost-report testi: 2 ders × 0,45 $); 18 Ekim
    # dersi cost-report senaryosunun dışında tutulur (fixtures/README.md "Sapma notu").
    for j, (lesson_id, day) in enumerate([(uid("lesson", "mert-morale-1"), 14), (uid("lesson", "mert-morale-2"), 16)]):
        rows.append({"id": 31 + j, "purpose": "lesson_analysis", "provider": "gemini-paid", "model": "gemini-2.5-pro",
                     "tokens_in": 150000, "tokens_out": 26250, "audio_sec": None, "images": 24, "batch": False,
                     "status": "ok", "error_code": None, "latency_ms": 52000, "cost_usd": lesson.MORALE_LESSON_COST_USD, "ref_table": "lessons",
                     "ref_id": lesson_id, "student_ref": STUDENTS["mert"]["ref"],
                     "created_at": f"2026-10-{day:02d}T18:00:00Z"})
    return rows


def spend_ledger(calls: list[dict[str, Any]]) -> list[dict[str, Any]]:
    agg: dict[tuple[str, str, str], dict[str, Any]] = {}
    for c in calls:
        k = (local_day(c["created_at"]), c["purpose"], c["provider"])
        r = agg.setdefault(k, {"day": k[0], "purpose": k[1], "provider": k[2], "calls": 0, "tokens_in": 0,
                               "tokens_out": 0, "cost_usd": 0.0})
        r["calls"] += 1
        r["tokens_in"] += c["tokens_in"]
        r["tokens_out"] += c["tokens_out"]
        r["cost_usd"] = round(r["cost_usd"] + c["cost_usd"], 6)
    return sorted(agg.values(), key=lambda r: (r["day"], r["purpose"]))
