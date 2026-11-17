"""fixtures/db/dev-seed.json üreticisi.

Biçim: üst düzey anahtarlar tablo adlarıdır (secure şeması `secure.<tablo>` önekiyle); her değer o tablonun
satır dizisidir; sütun adları §3 migration'larıyla birebir aynıdır. Worker FakeDb, panel mock ve
M02'nin `scripts/gen-dev-seed.py`'ı bu dosyayı okur.
"""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any

import content
import conversations
import lesson
from fxlib import (
    CURRICULUM_ID,
    ENROLL,
    GROUP_A,
    GROUP_A_TITLE,
    LESSON_ID,
    NOW,
    PERIOD,
    STAFF,
    STUDENTS,
    iso,
    name_token_hashes,
    sha256_hex,
    uid,
)

LEGAL_VERSION = "2026-10-v1"

COCUK_DILI = (
    "<!-- ogrenmen:cocuk-dili:start -->\n"
    "**Verilerin nasıl kullanılıyor?** Yazdıklarını sana daha iyi yardım etmek için saklıyoruz.\n"
    "Adını ve okulunu yapay zekâya göndermiyoruz; mesajların 90 gün sonra silinir.\n"
    "İstediğin zaman /sil yazarak verilerinin silinmesini isteyebilirsin.\n"
    "<!-- ogrenmen:cocuk-dili:end -->"
)


def legal_texts() -> list[dict[str, Any]]:
    bodies = {
        "kvkk_aydinlatma": (
            "# Aydınlatma metni\n\n> HUKUKİ İNCELEME GEREKLİ — taslak, avukat onayı olmadan yayımlanmaz\n\n"
            "Veri sorumlusu easy'dir. Öğrenmen; adını, doğum yılını ve Telegram kimliğini ayrı ve kapalı bir "
            "bölümde tutar. Yapay zekâ sağlayıcılarına yalnız temizlenmiş metin gider.\n\n"
            "Mesajlar 90 gün, bot cevaplarındaki tam istem metni 30 gün, hafıza olguları 180 gün, ders videoları "
            "30 gün saklanır.\n\nBu metni onaylamamış bir grup üyesinin mesajlarının içeriği saklanmaz; yalnız "
            "gönderim zamanı ve rolü kaydedilir, yapay zekâ bu mesajları okumaz.\n\n" + COCUK_DILI + "\n"),
        "veli_onayi": (
            "# Veli onay formu\n\n> HUKUKİ İNCELEME GEREKLİ — taslak, avukat onayı olmadan yayımlanmaz\n\n"
            "18 yaşından küçük öğrencinin sohbet kaydı, öğrenme profili ve ders kaydı analizi için veli ya da "
            "vasinin açık rızası gerekir. Onay, koordinatörün verdiği kodla ya da kâğıt formla alınır ve her zaman "
            "geri alınabilir.\n"),
        "grup_kayit": (
            "Bu gruptaki mesajlar Öğrenmen tarafından kaydedilir ve {days} gün sonra silinir. Öğrenmen bir yapay "
            "zekâ öğretmenidir; hocalar da bu grupta. Ayrıntı: /gizlilik\n\nBotla özel sohbette onay vermeyen "
            "üyelerin mesaj içeriği saklanmaz; yalnız zaman ve rol bilgisi tutulur. Onay için bota özelden /start "
            "yazın.\n"),
        "ders_kaydi": (
            "# Ders kaydı bildirimi\n\n> HUKUKİ İNCELEME GEREKLİ — taslak, avukat onayı olmadan yayımlanmaz\n\n"
            "Ders videosunun sesi ve birkaç karesi analiz edilir; isimler yapay zekâya gitmez. Video 30 gün sonra "
            "silinir ve öğrenciye ve veliye bildirilir; isimsiz transkript dönem bitiminden 730 gün sonra "
            "silinir.\n"),
        "kullanim_kosullari": (
            "# Kullanım koşulları\n\nÖğrenmen bir yapay zekâ öğretmenidir; not, devamsızlık ve ödeme konularında "
            "eğitmen adına konuşmaz.\n"),
    }
    return [{"id": uid("legal_text", k), "kind": k, "version": LEGAL_VERSION, "body_md": b,
             "effective_from": "2026-10-15"} for k, b in bodies.items()]


def settings() -> list[dict[str, Any]]:
    rows = [
        ("min_evidence", 5, "Yüzde göstermek için gereken en az kanıt sayısı"),
        ("misconception_open_evidence", 3, "Yanılgının açık sayılması için kanıt sayısı"),
        ("alert_unanswered_hours", 6, "Cevapsız soru uyarısı (saat)"),
        ("alert_unanswered_danger_hours", 24, "Cevapsız soru acil eşiği (saat)"),
        ("alert_silent_days", 3, "Sessiz öğrenci uyarısı (gün)"),
        ("alert_silent_danger_days", 7, "Sessiz öğrenci acil eşiği (gün)"),
        ("alert_deadline_days", 2, "Yaklaşan teslim uyarısı (gün)"),
        ("response_target_hours", 2, "Eğitmen yanıt süresi hedefi (saat)"),
        ("chat_max_tokens_out", 220, "Sohbet cevabı en çok çıkış tokenı"),
        ("chat_budget_tokens_in", 2200, "Sohbet turu en çok giriş tokenı"),
        ("memory_k", 5, "Prompt'a giren hafıza olgusu sayısı"),
        ("recent_messages", 6, "Prompt'a giren son mesaj sayısı"),
        ("burst_seconds", 3, "Patlama koruması (saniye)"),
        ("session_idle_hours", 6, "Oturumun boşa düşme süresi (saat)"),
        ("max_options", 4, "Çoktan seçmeli şık sayısı"),
        ("default_period", PERIOD, "İlk kayıtta enrollments.period_label"),
        ("pilot_gate", {
            "question_accuracy": {"min": 0.90, "n_min": 30},
            "diagnostic_agreement": {"min": 0.60, "n_min": 10},
            "citation_relevance": {"min": 0.80, "n_min": 10, "required": False},
            "priority_uplift": {"min": 0.0, "required": False},
            "cost_per_student": {"max_usd": 0.10},
            "flagged_response_share": {"max": 0.05},
            "degraded_share": {"max": 0.05},
            "isolation_tests": "pass", "key_leak_tests": "pass"}, "Pilot kapısı eşikleri (ADR-0013)"),
    ]
    return [{"key": k, "value": v, "description": d, "updated_at": "2026-10-01T00:00:00Z"} for k, v, d in rows]


def runtime_flags() -> list[dict[str, Any]]:
    rows = [
        ("paid_llm_enabled", True), ("degraded_mode", False), ("daily_cap_usd", 0.80), ("monthly_cap_usd", 24.00),
        ("cap_excluded_purposes", ["lesson_analysis", "transcribe", "diarize"]), ("lesson_monthly_cap_usd", 30.00),
        ("alert_thresholds", [0.5, 0.8, 1.0]), ("alerts_sent", {}), ("proactive_enabled", True),
        ("research_enabled", False), ("research_monthly_cap", 40), ("tablet_nightly_count", 10),
        ("cron_owner", "pg_cron"), ("storage_pressure", False), ("facts_lag_days", 0),
        ("prompt_version_chat", "socratic.v3"),
    ]
    return [{"key": k, "value": v, "updated_at": "2026-10-01T00:00:00Z", "updated_by": "seed"} for k, v in rows]


def retention_policies() -> list[dict[str, Any]]:
    R = [
        ("tg_updates.purge", "public", "tg_updates", "received_at", 2, "delete", None, None, None, None),
        ("messages.hard_delete", "public", "messages", "expires_at", 0, "delete", None, None, None,
         "Bu gruptaki mesajlar Öğrenmen tarafından kaydedilir ve {days} gün sonra silinir."),
        ("bot_responses.prompt_null", "public", "bot_responses", "created_at", 30, "null_columns", None,
         ["prompt_text"], None, "Bot cevaplarının tam istem metni {days} gün sonra silinir."),
        ("bot_responses.hard_delete", "public", "bot_responses", "created_at", 180, "delete", None, None,
         "flagged = false", "Bot cevap kayıtları {days} gün sonra silinir."),
        ("bot_responses.flagged_delete", "public", "bot_responses", "created_at", 365, "delete", None, None,
         "flagged = true", None),
        ("llm_calls.hard_delete", "public", "llm_calls", "created_at", 180, "delete", None, None, None, None),
        ("memory_facts.expire", "public", "memory_facts", "valid_until", 0, "expire", None, None, None, None),
        ("memory_facts.hard_delete", "public", "memory_facts", "created_at", 180, "delete", None, None,
         "status = 'expired'", None),
        ("memory_facts.stale", "public", "memory_facts", "created_at", 180, "expire", None, None,
         "valid_until is null and status = 'active'", "Hafıza olguları {days} gün sonra silinir."),
        ("lessons.video", "public", "lessons", "held_at", 30, "custom", "app.retention_lessons_video", None, None,
         "Ders kaydının videosu {days} gün sonra silinir; isimsiz transkript kalır."),
        ("lessons.transcript", "public", "enrollments", "ended_at", 730, "custom", "app.retention_lessons_transcript",
         None, None, "Transkript dönem bitiminden 2 yıl sonra silinir."),
        ("citations.unresolved", "public", "citations", "verified_at", 7, "delete", None, None,
         "crossref_status = 'unresolved'", None),
        ("quota_usage.purge", "public", "quota_usage", "day", 60, "delete", None, None, None, None),
        ("audit.events.purge", "audit", "events", "at", 730, "delete", None, None, None, None),
        ("students.anonymize", "public", "students", "deleted_at", 30, "custom", "app.retention_students_anonymize",
         None, None, "Silme talebinden {days} gün sonra kişisel verilerin silinir."),
        ("enrollments.closed_cleanup", "public", "enrollments", "ended_at", 365, "custom",
         "app.retention_enrollments_closed", None, "status = 'closed'", None),
        ("enrollments.learning_data", "public", "enrollments", "ended_at", 730, "custom",
         "app.retention_enrollments_learning_data", None, "status = 'closed'",
         "Öğrenme verisi dönem bitiminden 2 yıl sonra anonimleştirilir."),
    ]
    return [{"id": i, "schema_name": s, "table_name": t, "ts_column": c, "days": d, "mode": m, "handler": h,
             "columns": cols, "condition_sql": cond, "user_facing_text": txt, "enabled": True}
            for i, s, t, c, d, m, h, cols, cond, txt in R]


def bkt(p: float, correct: bool, g: float, s: float, t: float) -> float:
    if correct:
        po = p * (1 - s) / (p * (1 - s) + (1 - p) * g)
    else:
        po = p * s / (p * s + (1 - p) * (1 - g))
    return min(0.99, max(0.01, po + (1 - po) * t))


def blend(p: float, m: float, c: float | None) -> float:
    return min(0.99, max(0.01, p + 0.30 * (0.8 if c is None else c) * (m - p)))


class Gozluk:
    """apply_observation'ın (§3.7) küçük Python eşleniği: Mert'in teşhis/pratik geçmişini üretir."""

    def __init__(self, enrollment: str) -> None:
        self.enr = enrollment
        self.obs: list[dict[str, Any]] = []
        self.mastery: dict[str, dict[str, Any]] = {}
        self.history: list[dict[str, Any]] = []
        self.misc: dict[str, dict[str, Any]] = {}
        self.evidence: list[dict[str, Any]] = []

    def observe(self, *, skill: str, kind: str, value: float | None, source_type: str, source_id: str,
                locator: str, when: datetime, tag: str | None = None, weight: float = 1.0,
                confidence: float | None = None, counts: bool = True, role: str = "bot_runtime",
                quote: str | None = None) -> dict[str, Any]:
        o = {"id": len(self.obs) + 1, "enrollment_id": self.enr, "curriculum_id": CURRICULUM_ID, "skill_id": skill,
             "kind": kind, "value": value, "weight": weight, "confidence": confidence, "source_type": source_type,
             "source_id": source_id, "source_locator": locator, "quote": quote, "misconception_tag": tag,
             "guess_override": None, "counts_for_mastery": counts, "created_by_role": role,
             "applied_at": iso(when), "created_at": iso(when)}
        self.obs.append(o)
        self._apply(o, when)
        return o

    def _apply(self, o: dict[str, Any], when: datetime) -> None:
        m = self.mastery.setdefault(o["skill_id"], {"p": 0.3, "n": 0, "last": None, "at": None})
        p0 = m["p"]
        if o["kind"] in ("diagnostic", "practice", "test", "resolution"):
            g = o["guess_override"] or 0.25
            p1 = bkt(p0, (o["value"] or 0) >= 0.5, g, 0.1, 0.1)
            inc = 1 if o["counts_for_mastery"] else 0
            method, params = "bkt", {"g": g, "s": 0.1, "t": 0.1, "w": o["weight"], "guess_override": None}
        elif o["kind"] in ("lesson", "instructor"):
            p1 = blend(p0, o["value"], o["confidence"])
            inc = 1
            method, params = "blend", {"w": round(0.30 * (o["confidence"] or 0.8), 6), "m": o["value"]}
        elif o["kind"] == "inferred":
            g = 0.25 + (1 - 0.25) * (1 - o["weight"])
            p1 = bkt(p0, False, g, 0.1, 0.1)
            inc = 0
            method, params = "inferred", {"g_eff": g, "s": 0.1, "t": 0.1, "w": o["weight"]}
        else:
            raise ValueError(o["kind"])
        self.history.append({"id": len(self.history) + 1, "enrollment_id": self.enr, "skill_id": o["skill_id"],
                             "observation_id": o["id"], "p_before": round(p0, 5), "p_after": round(p1, 5),
                             "method": method, "params": params, "created_at": iso(when)})
        m["p"], m["n"], m["last"] = p1, m["n"] + inc, o["id"]
        if inc:
            m["at"] = iso(when)
        tag = o["misconception_tag"]
        if tag and (o["value"] is None or o["value"] < 0.5):
            tskill, prereq, ti, ts = content.tag_info(tag)
            mc = self.misc.get(tag)
            if mc is None:
                mc = {"id": uid("misconception", f"{self.enr}:{tag}"), "enrollment_id": self.enr,
                      "curriculum_id": CURRICULUM_ID, "skill_id": tskill or o["skill_id"], "tag": tag,
                      "text_instructor": ti, "text_student": ts, "status": "pending_review", "evidence_count": 0,
                      "first_seen": iso(when), "last_seen": iso(when), "resolved_at": None, "resolved_by": None,
                      "resolution_observation_id": None, "rejected_by": None, "reject_note": None}
                self.misc[tag] = mc
            mc["evidence_count"] += 1
            mc["last_seen"] = iso(when)
            if mc["status"] == "pending_review" and mc["evidence_count"] >= 3:
                mc["status"] = "open"
            self.evidence.append({"misconception_id": mc["id"], "observation_id": o["id"]})
            if o["kind"] in ("diagnostic", "practice", "test") and prereq and prereq != o["skill_id"]:
                self.observe(skill=prereq, kind="inferred", value=0, source_type="observation", source_id=str(o["id"]),
                             locator=o["source_locator"] + " (ön koşul çıkarımı)", when=when, weight=0.5,
                             counts=False, role=o["created_by_role"])

    def mastery_rows(self) -> list[dict[str, Any]]:
        return [{"enrollment_id": self.enr, "curriculum_id": CURRICULUM_ID, "skill_id": s, "p": round(m["p"], 5),
                 "evidence_count": m["n"], "last_observation_id": m["last"], "last_evidence_at": m["at"],
                 "updated_at": iso(NOW - timedelta(days=2))} for s, m in sorted(self.mastery.items())]


def mert_learning(keys: dict[str, dict[str, Any]], diag_test_id: str) -> dict[str, list[dict[str, Any]]]:
    """Mert: 20 maddelik teşhis (5 yanlış) + 4 pratik + 1 eğitmen notu → mastery, yanılgılar, kanıt zinciri."""
    enr = ENROLL["mert"]
    gz = Gozluk(enr)
    session = uid("diagnostic_session", "mert")
    start = datetime.fromisoformat("2026-10-15T15:00:00+00:00")
    wrong = {3: "A", 7: "A", 8: "A", 12: "A", 19: "A"}
    attempts: list[dict[str, Any]] = []
    answer = _correct_options()
    for i in range(1, 21):
        code = f"DIAG-2026.1-{i:02d}"
        q = keys[code]
        chosen = wrong.get(i, answer[code])
        correct = chosen == answer[code]
        tag = None if correct else next(o["misconception_tag"] for o in q["options"] if o["key"] == chosen)
        when = start + timedelta(minutes=i)
        aid = len(attempts) + 1
        attempts.append({"id": aid, "enrollment_id": enr, "question_id": q["id"], "context": "diagnostic",
                         "session_id": session, "chosen": {"key": chosen}, "attempt_no": 1, "is_correct": correct,
                         "misconception_tag": tag, "graded_at": iso(when), "response_ms": 30000 + 1000 * i,
                         "created_at": iso(when)})
        gz.observe(skill=q["skill_ids"][0], kind="diagnostic", value=1 if correct else 0, source_type="attempt",
                   source_id=str(aid), locator=f"Teşhis · Soru {i}", when=when, tag=tag)
    pstart = datetime.fromisoformat("2026-10-16T16:00:00+00:00")
    for j, (code, chosen) in enumerate([("T01", "C"), ("T02", "A"), ("T07", "A"), ("T08", "B")]):
        q = keys[code]
        correct = chosen == answer[code]
        tag = None if correct else next(o["misconception_tag"] for o in q["options"] if o["key"] == chosen)
        when = pstart + timedelta(minutes=2 * j)
        aid = len(attempts) + 1
        attempts.append({"id": aid, "enrollment_id": enr, "question_id": q["id"], "context": "practice",
                         "session_id": None, "chosen": {"key": chosen}, "attempt_no": 1, "is_correct": correct,
                         "misconception_tag": tag, "graded_at": iso(when), "response_ms": 41000 + 500 * j,
                         "created_at": iso(when)})
        gz.observe(skill=q["skill_ids"][0], kind="practice", value=1 if correct else 0, source_type="attempt",
                   source_id=str(aid), locator=f"Pratik · {q['id'][:8]}", when=when, tag=tag)
    note_id = uid("instructor_note", "mert-1")
    note_when = datetime.fromisoformat("2026-10-17T12:00:00+00:00")
    note = {"id": note_id, "enrollment_id": enr, "author_id": STAFF["inst"]["id"], "curriculum_id": CURRICULUM_ID,
            "skill_id": content.sk("temel.rasyonel-sayilar"),
            "body": "Derste ortak paydayı bulmakta zorlanıyor; kesir modeliyle çalıştık.", "mastery_estimate": 0.45,
            "approved_fact": False, "created_at": iso(note_when)}
    gz.observe(skill=note["skill_id"], kind="instructor", value=0.45, source_type="instructor_note", source_id=note_id,
               locator="Eğitmen notu · 17 Eki", when=note_when, confidence=1.0, role="instructor",
               quote="Derste ortak paydayı bulmakta zorlanıyor; kesir modeliyle çalıştık.")
    per_skill = []
    names = {s["id"]: s["name"] for s in content.skills()}
    for row in sorted(gz.mastery_rows(), key=lambda r: r["p"]):
        per_skill.append({"skill_id": row["skill_id"], "name": names[row["skill_id"]], "p": row["p"],
                          "n": row["evidence_count"], "reliable": row["evidence_count"] >= 5})
    session_row = {"id": session, "enrollment_id": enr, "test_id": diag_test_id, "chat_id": STUDENTS["mert"]["tg"],
                   "current_index": 20, "status": "finished", "started_at": iso(start),
                   "finished_at": iso(start + timedelta(minutes=21)),
                   "result": {"per_skill": per_skill, "weakest": [p["name"] for p in per_skill[:3]],
                              "open_tags": [t for t, m in gz.misc.items() if m["status"] in ("pending_review", "open")]}}
    return {"attempts": attempts, "observations": gz.obs, "mastery": gz.mastery_rows(),
            "mastery_history": gz.history, "misconceptions": list(gz.misc.values()),
            "misconception_evidence": gz.evidence, "instructor_notes": [note], "diagnostic_sessions": [session_row]}


def _correct_options() -> dict[str, str]:
    out = {f"DIAG-2026.1-{i:02d}": row[4] for i, row in enumerate(content.DIAG, start=1)}
    out.update({row[0]: row[5] for row in content.TPL})
    return out


def exam_world() -> dict[str, list[dict[str, Any]]]:
    """TYT-MAT kursu: 3 yıllık ÖSYM arşivi (yalnız istatistik), kümeler ve öncelik planları."""
    course = {"id": uid("course", "TYT-MAT"), "code": "TYT-MAT", "curriculum_id": CURRICULUM_ID,
              "title": "TYT Matematik", "instructor_alias": "hoca-A"}
    years = [2023, 2024, 2025]
    sources = [{"id": uid("exam_source", f"TYT-MAT:{y}"), "course_id": course["id"], "year": y, "term": "osym",
                "instructor_alias": None, "storage_path": f"exams/{uid('exam_source', f'TYT-MAT:{y}')}.pdf",
                "legal_basis": "kamuya açık ÖSYM yayını — yalnız istatistik", "uploaded_by": STAFF["coord"]["id"],
                "status": "clustered", "error": None, "created_at": "2026-10-06T10:00:00Z"} for y in years]
    topics = [
        ("Rasyonel sayılarda dört işlem", "temel.rasyonel-sayilar", "mc", years, 4.0,
         "Kesirli ifadenin sonucunu bulunuz: paydaları farklı iki kesrin toplamı ve farkı"),
        ("Yüzde ve kâr–zarar", "problem.yuzde", "mc", years, 4.0,
         "Bir ürünün fiyatına art arda iki yüzde zam uygulanıyor; son fiyat soruluyor"),
        ("Birinci dereceden denklem", "cebir.denklem", "mc", [2023, 2025], 4.0,
         "Paydalı birinci dereceden bir denklemin çözüm değeri soruluyor"),
        ("Mutlak değer", "cebir.mutlak-deger", "mc", [2024, 2025], 4.0,
         "Mutlak değerli denklemin çözüm kümesinin elemanları toplamı soruluyor"),
        ("Üslü ifadeler", "temel.uslu", "mc", [2023, 2024], 4.0,
         "Aynı tabanlı üslü ifadelerin çarpımı ve bölümü sadeleştiriliyor"),
        ("Oran–orantı", "cebir.oran-oranti", "mc", [2025], 4.0,
         "İşçi sayısı ile iş süresi arasındaki ters orantı kuruluyor"),
    ]
    items, clusters = [], []
    item_no = {y: 0 for y in years}
    by_topic: dict[str, list[str]] = {}
    for topic, skill, kind, hit_years, pts, text in topics:
        cid = uid("exam_cluster", f"TYT-MAT:{topic}")
        for y in hit_years:
            item_no[y] += 1
            iid = uid("exam_item", f"TYT-MAT:{y}:{topic}")
            by_topic.setdefault(topic, []).append(iid)
            items.append({"id": iid, "source_id": uid("exam_source", f"TYT-MAT:{y}"), "item_no": item_no[y],
                          "topic": topic, "kind": kind, "points": pts, "curriculum_id": CURRICULUM_ID,
                          "skill_id": content.sk(skill), "ocr_text": f"{y} arşiv maddesi: {text}.", "embedding": None,
                          "cluster_id": cid})
        clusters.append({"id": cid, "course_id": course["id"], "label": topic, "kind": kind,
                         "curriculum_id": CURRICULUM_ID, "skill_id": content.sk(skill), "item_count": len(hit_years),
                         "years_hit": hit_years, "years_total": len(years), "avg_points": pts,
                         "updated_at": "2026-10-07T03:40:00Z"})

    def plan_json(n_rows: int, generated: str) -> dict[str, Any]:
        rows = []
        for rank, (topic, skill, _kind, hit_years, pts, _t) in enumerate(topics[:n_rows], start=1):
            rows.append({"rank": rank, "topic": topic, "kind": "çoktan seçmeli", "skill_id": content.sk(skill),
                         "hits": len(hit_years), "years": len(hit_years), "points_text": f"≈{round(pts)} puan",
                         "evidence_count": len(by_topic[topic]), "evidence_item_ids": by_topic[topic],
                         "syllabus_alignment": "covered_and_asked", "variant_question_ids": []})
        return {"schema_version": "1.0", "course_code": "TYT-MAT", "period": PERIOD,
                "title": "Sıklık analizine göre öncelikler", "years_total": len(years), "rows": rows,
                "others": ["Köklü ifadeler", "Çarpanlara ayırma"], "uncovered_topics": ["Devirli ondalık açılım"],
                "evidence_count": sum(len(by_topic[t[0]]) for t in topics[:n_rows]), "generated_at": generated}

    plans = [
        {"id": uid("plan", "TYT-MAT:v1"), "course_id": course["id"], "period": PERIOD,
         "plan": plan_json(4, "2026-10-01T03:50:00Z"), "evidence_count": 10, "status": "retired",
         "approved_by": STAFF["inst"]["id"], "approved_at": "2026-10-02T09:00:00Z", "created_at": "2026-10-01T03:50:00Z"},
        {"id": uid("plan", "TYT-MAT:v2"), "course_id": course["id"], "period": PERIOD,
         "plan": plan_json(6, "2026-10-07T03:50:00Z"), "evidence_count": 13, "status": "approved",
         "approved_by": STAFF["inst"]["id"], "approved_at": "2026-10-08T09:30:00Z", "created_at": "2026-10-07T03:50:00Z"},
        {"id": uid("plan", "TYT-MAT:v3"), "course_id": course["id"], "period": PERIOD,
         "plan": plan_json(5, "2026-10-19T03:50:00Z"), "evidence_count": 12, "status": "pending_review",
         "approved_by": None, "approved_at": None, "created_at": "2026-10-19T03:50:00Z"},
    ]
    for p in plans:
        p["evidence_count"] = p["plan"]["evidence_count"]
    syllabus = [{"id": uid("syllabus", f"TYT-MAT:{w}"), "course_id": course["id"], "curriculum_id": CURRICULUM_ID,
                 "week": w, "title": t, "skill_ids": [content.sk(s) for s in ss]}
                for w, t, ss in [(1, "Rasyonel sayılar", ["temel.rasyonel-sayilar"]),
                                 (2, "Üslü ifadeler", ["temel.uslu"]),
                                 (3, "Denklemler ve mutlak değer", ["cebir.denklem", "cebir.mutlak-deger"]),
                                 (4, "Problemler", ["problem.yuzde", "cebir.oran-oranti"]),
                                 (5, "Ondalık gösterim", ["temel.ondalik"])]]
    return {"courses": [course], "syllabus_topics": syllabus, "exam_sources": sources, "exam_clusters": clusters,
            "exam_items": items, "exam_priority_plans": plans}


def research_world(output: dict[str, Any]) -> dict[str, list[dict[str, Any]]]:
    req_id = output["request_id"]
    req = {"id": req_id, "student_id": STUDENTS["elif"]["id"], "staff_id": None, "query": output["query"],
           "expanded_queries": output["expanded_queries"], "status": "done", "cost_usd": 0.0275,
           "created_at": "2026-10-17T18:00:00Z", "finished_at": "2026-10-18T00:30:00Z"}
    out_id = uid("research_output", "elif-1")
    out = {"id": out_id, "request_id": req_id, "output": output, "bibtex": output["bibtex"], "apa": "\n".join(output["apa"]),
           "model": output["model"], "status": "pending_review", "created_at": "2026-10-18T00:30:00Z"}
    cits = []
    for c in output["citations"]:
        cits.append({"id": uid("citation", f"{out_id}:{c['ordinal']}"), "output_id": out_id, "ordinal": c["ordinal"],
                     "doi": c.get("doi"), "title": c["title"], "authors": c["authors"], "venue": c.get("venue"),
                     "year": c["year"], "crossref_status": c["crossref_status"],
                     "title_similarity": c.get("title_similarity"), "verified_at": c.get("verified_at"),
                     "oa_pdf_url": c.get("oa_pdf_url"), "tldr": c.get("tldr"), "status": "kept", "removed_reason": None,
                     "relevance": None, "relevance_by": None, "relevance_at": None})
    return {"research_requests": [req], "research_outputs": [out], "citations": cits}


def build(research_output: dict[str, Any]) -> dict[str, Any]:
    st = STUDENTS
    legal = legal_texts()
    lt = {r["kind"]: r["id"] for r in legal}
    diag_q, diag_k = content.diagnostic_questions()
    tpl_q, tpl_k, figs, tpls = content.template_questions()
    llm_q, llm_k = content.llm_questions()
    questions = diag_q + tpl_q + llm_q
    codes = {q["code"]: q for q in questions}
    diag_test = {"id": uid("diagnostic_test", "2026.1"), "curriculum_id": CURRICULUM_ID, "version": "2026.1",
                 "item_ids": [q["id"] for q in diag_q]}
    learning = mert_learning(codes, diag_test["id"])
    learning["diagnostic_sessions"].append({
        "id": uid("diagnostic_session", "elif"), "enrollment_id": ENROLL["elif"], "test_id": diag_test["id"],
        "chat_id": STUDENTS["elif"]["tg"], "current_index": 0, "status": "in_progress",
        "started_at": "2026-10-20T08:30:00Z", "finished_at": None, "result": None})
    for q in questions:
        del q["code"]  # içerik kodu (DIAG-2026.1-07, T01, L01) DB sütunu değildir

    pool = [
        {"id": uid("pool", "explanation"), "kind": "explanation", "curriculum_id": CURRICULUM_ID,
         "skill_id": content.sk("temel.rasyonel-sayilar"), "misconception_tag": "rasyonel.pay-payda-ayri-toplama",
         "mode": "socratic", "body": "Paylar ve paydalar ayrı ayrı toplanmaz. `1/2` ile `1/3`'ü önce aynı paydaya "
         "getirelim: ortak payda kaç olur?", "status": "approved", "model": "gemini-2.5-flash-lite", "cost_usd": 0.00025,
         "hit_count": 7, "approved_by": STAFF["inst"]["id"], "approved_at": "2026-10-10T10:00:00Z",
         "created_at": "2026-10-09T20:00:00Z"},
        {"id": uid("pool", "feedback_wrong"), "kind": "feedback_wrong", "curriculum_id": CURRICULUM_ID,
         "skill_id": content.sk("temel.rasyonel-sayilar"), "misconception_tag": "rasyonel.pay-payda-ayri-toplama",
         "mode": "socratic", "body": "✕ Tekrar dene. Paylar ve paydalar ayrı ayrı toplanmaz; önce paydaları eşitleyelim.",
         "status": "approved", "model": None, "cost_usd": 0, "hit_count": 4, "approved_by": STAFF["inst"]["id"],
         "approved_at": "2026-10-10T10:00:00Z", "created_at": "2026-10-09T20:00:00Z"},
        {"id": uid("pool", "feedback_right"), "kind": "feedback_right", "curriculum_id": CURRICULUM_ID,
         "skill_id": content.sk("temel.rasyonel-sayilar"), "misconception_tag": None, "mode": "socratic",
         "body": "✓ Doğru. Paydalar eşitlenince yalnız paylar toplanır. Bir tane de sen dener misin?",
         "status": "approved", "model": None, "cost_usd": 0, "hit_count": 9, "approved_by": STAFF["inst"]["id"],
         "approved_at": "2026-10-10T10:00:00Z", "created_at": "2026-10-09T20:00:00Z"},
        {"id": uid("pool", "hint-uslu"), "kind": "hint", "curriculum_id": CURRICULUM_ID,
         "skill_id": content.sk("temel.uslu"), "misconception_tag": "uslu.usleri-carpma", "mode": "socratic",
         "body": "İpucu: `2^3 = 2 · 2 · 2`. Çarpımda kaç tane 2 olduğunu sayarsan üslere ne olduğunu görürsün; kaç tane?",
         "status": "pending_review", "model": "gemini-2.5-flash-lite", "cost_usd": 0.00024, "hit_count": 0,
         "approved_by": None, "approved_at": None, "created_at": "2026-10-17T17:05:00Z"},
    ]
    pool_ids = {"feedback_right": pool[2]["id"], "feedback_wrong": pool[1]["id"]}

    msgs, by_key = conversations.messages()
    facts = conversations.memory_facts(by_key)
    responses = conversations.bot_responses(by_key, pool_ids)
    calls, ledger = conversations.llm_calls_and_ledger(responses)
    for m in msgs:
        m.pop("_key", None)
        m.pop("_pii", None)

    staff_rows = [{"id": s["id"], "full_name": s["full_name"], "role": s["role"], "subject": s["subject"],
                   "active": True, "created_at": "2026-10-01T00:00:00Z"} for s in STAFF.values()]
    students = [{"id": s["id"], "public_ref": s["ref"], "is_minor": s["is_minor"], "tz": "Europe/Istanbul",
                 "tier": "standard", "status": s["status"], "created_at": "2026-10-10T12:00:00Z", "deleted_at": None}
                for s in st.values()]
    pii = []
    for s in st.values():
        names = f"{s['first']} {s['last']}" + (f" {s['guardian_name']}" if s["guardian_name"] else "")
        pii.append({"student_id": s["id"], "display_name": f"{s['first']} {s['last']}", "birth_year": s["birth_year"],
                    "school": s["school"], "grade": s["grade"], "guardian_name": s["guardian_name"],
                    "guardian_relation": s["guardian_relation"], "guardian_contact": s["guardian_contact"],
                    "name_token_hashes": name_token_hashes(names), "updated_at": "2026-10-10T12:00:00Z"})
    tids = [{"telegram_user_id": s["tg"], "student_id": s["id"], "staff_id": None, "username": s["username"],
             "mention_handle": None, "linked_at": "2026-10-10T12:00:00Z"} for s in st.values()]
    tids += [{"telegram_user_id": s["tg"], "student_id": None, "staff_id": s["id"], "username": s["username"],
              "mention_handle": s["mention"], "linked_at": "2026-10-12T09:00:00Z"} for s in STAFF.values() if s["tg"]]
    guardian_codes = [
        {"id": uid("guardian_code", "zeynep"), "student_id": st["zeynep"]["id"], "code_hash": sha256_hex("K7F32QX9"),
         "channel": "telegram", "created_by": STAFF["coord"]["id"], "expires_at": "2026-10-22T09:00:00Z",
         "used_at": None, "used_by_telegram_user_id": None, "attempts": 0, "locked_until": None},
        {"id": uid("guardian_code", "mert"), "student_id": st["mert"]["id"], "code_hash": sha256_hex("M4RT7Q2Z"),
         "channel": "telegram", "created_by": STAFF["coord"]["id"], "expires_at": "2026-10-14T09:00:00Z",
         "used_at": "2026-10-12T18:30:00Z", "used_by_telegram_user_id": 700000301, "attempts": 0, "locked_until": None},
    ]
    staff_codes = [{"id": uid("staff_code", "inst"), "staff_id": STAFF["inst"]["id"], "code_hash": sha256_hex("EGT4K2PZ"),
                    "created_by": STAFF["coord"]["id"], "expires_at": "2026-10-23T09:00:00Z", "used_at": None,
                    "used_by_telegram_user_id": None}]

    def consent(key: str, kind: str, method: str, given_by: str, evidence: dict, when: str) -> dict[str, Any]:
        return {"id": uid("consent", f"{key}:{kind}"), "student_id": st[key]["id"], "kind": kind,
                "legal_text_id": lt[kind], "status": "given", "method": method, "given_by": given_by,
                "evidence": evidence, "given_at": when, "revoked_at": None, "created_at": when}

    consents = [
        consent("elif", "kvkk_aydinlatma", "telegram_button", "student",
                {"chat_id": st["elif"]["tg"], "message_id": 1, "telegram_user_id": st["elif"]["tg"]}, "2026-10-10T12:05:00Z"),
        consent("mert", "kvkk_aydinlatma", "telegram_button", "student",
                {"chat_id": st["mert"]["tg"], "message_id": 1, "telegram_user_id": st["mert"]["tg"]}, "2026-10-11T15:00:00Z"),
        consent("mert", "veli_onayi", "guardian_code", "guardian",
                {"chat_id": 700000301, "message_id": 3, "telegram_user_id": 700000301,
                 "code_id": uid("guardian_code", "mert")}, "2026-10-12T18:30:00Z"),
        consent("zeynep", "kvkk_aydinlatma", "telegram_button", "student",
                {"chat_id": st["zeynep"]["tg"], "message_id": 1, "telegram_user_id": st["zeynep"]["tg"]},
                "2026-10-16T13:58:00Z"),
    ]
    enrollments = [{"id": ENROLL[k], "student_id": s["id"], "curriculum_id": CURRICULUM_ID, "period_label": PERIOD,
                    "status": "active", "started_at": "2026-10-10", "ended_at": None} for k, s in st.items()]
    prefs = [{"student_id": s["id"], "active_hours": [18, 19, 20, 21], "modality": None,
              "default_mode": "socratic", "explanation_notes": "kısa adımlar işe yarıyor" if k == "elif" else None,
              "proactive_enabled": True, "voice_reply": False, "updated_at": "2026-10-19T00:40:00Z"}
             for k, s in st.items()]
    tg_chats = [{"chat_id": s["tg"], "kind": "private", "title": None, "bot_is_admin": False, "bot_can_pin": False,
                 "recording_notice_msg_id": None, "recording_notice_legal_id": None,
                 "privacy_mode_off_verified": False, "retention_days": 90, "recording_notice_days": None,
                 "group_auto_answer_min": 0, "created_at": "2026-10-10T12:00:00Z"} for s in st.values()]
    tg_chats.append({"chat_id": GROUP_A, "kind": "supergroup", "title": GROUP_A_TITLE, "bot_is_admin": True,
                     "bot_can_pin": True, "recording_notice_msg_id": 2, "recording_notice_legal_id": lt["grup_kayit"],
                     "privacy_mode_off_verified": True, "retention_days": 90, "recording_notice_days": 90,
                     "group_auto_answer_min": 0, "created_at": "2026-10-14T17:00:00Z"})
    sessions = [
        {"student_id": st["elif"]["id"], "chat_id": st["elif"]["tg"], "state": "idle", "mode": "socratic",
         "direct_once": False, "pending_question_id": None,
         "diagnostic_session_id": uid("diagnostic_session", "elif"), "hint_level": 0,
         "last_activity_at": "2026-10-19T16:03:00Z", "quota_warned_on": None},
        {"student_id": st["mert"]["id"], "chat_id": st["mert"]["tg"], "state": "idle", "mode": "socratic",
         "direct_once": False, "pending_question_id": None,
         "diagnostic_session_id": learning["diagnostic_sessions"][0]["id"], "hint_level": 0,
         "last_activity_at": "2026-10-19T18:05:00Z", "quota_warned_on": "2026-10-17"},
        {"student_id": st["zeynep"]["id"], "chat_id": st["zeynep"]["tg"], "state": "awaiting_guardian",
         "mode": "socratic", "direct_once": False, "pending_question_id": None, "diagnostic_session_id": None,
         "hint_level": 0, "last_activity_at": "2026-10-18T13:40:00Z", "quota_warned_on": None},
    ]
    esc = [
        {"id": uid("escalation", "mert-grade"), "chat_id": st["mert"]["tg"], "message_id": by_key["m4"]["id"],
         "student_id": st["mert"]["id"], "reason": "grade_attendance_payment", "question_text": by_key["m4"]["text_llm"],
         "target_staff_id": STAFF["inst"]["id"], "status": "open", "created_at": by_key["m4"]["sent_at"],
         "answered_at": None, "answered_by": None},
        {"id": uid("escalation", "elif-hoca"), "chat_id": GROUP_A, "message_id": by_key["g7"]["id"],
         "student_id": st["elif"]["id"], "reason": "human_requested", "question_text": by_key["g7"]["text_llm"],
         "target_staff_id": STAFF["inst"]["id"], "status": "answered", "created_at": by_key["g7"]["sent_at"],
         "answered_at": by_key["g8"]["sent_at"], "answered_by": STAFF["inst"]["id"]},
    ]
    alerts = [
        {"id": uid("alert", "unanswered-g5"), "kind": "unanswered", "severity": "danger", "student_id": st["mert"]["id"],
         "staff_id": STAFF["inst"]["id"], "detail": f"Cevapsız soru: \"{by_key['g5']['text_llm']}\"",
         "since": by_key["g5"]["sent_at"], "ref": {"message_id": by_key["g5"]["id"]}, "status": "open",
         "created_at": "2026-10-19T01:05:00Z", "resolved_at": None, "resolved_by": None},
        {"id": uid("alert", "unanswered-esc"), "kind": "unanswered", "severity": "danger", "student_id": st["mert"]["id"],
         "staff_id": STAFF["inst"]["id"], "detail": f"Hocaya iletilen soru cevap bekliyor: \"{by_key['m4']['text_llm']}\"",
         "since": by_key["m4"]["sent_at"], "ref": {"escalation_id": esc[0]["id"]}, "status": "open",
         "created_at": "2026-10-19T03:05:00Z", "resolved_at": None, "resolved_by": None},
        {"id": uid("alert", "deadline-elif"), "kind": "deadline", "severity": "neutral", "student_id": st["elif"]["id"],
         "staff_id": STAFF["inst"]["id"], "detail": "Cuma günü deneme sınavı var; hazırlık için 3 gün kaldı.",
         "since": facts[1]["created_at"], "ref": {"fact_id": 2}, "status": "open", "created_at": "2026-10-20T05:05:00Z",
         "resolved_at": None, "resolved_by": None},
        {"id": uid("alert", "silent-zeynep"), "kind": "silent", "severity": "warning", "student_id": st["zeynep"]["id"],
         "staff_id": STAFF["inst"]["id"], "detail": "Öğrenci 3 gündür yazmadı; veli onayı da bekleniyor.",
         "since": "2026-10-16T14:00:00Z", "ref": {}, "status": "open", "created_at": "2026-10-19T14:05:00Z",
         "resolved_at": None, "resolved_by": None},
        {"id": uid("alert", "ops-lesson"), "kind": "ops", "severity": "warning", "student_id": None, "staff_id": None,
         "detail": "Ders raporu onay bekliyor", "since": "2026-10-19T17:31:00Z", "ref": {"lesson_id": LESSON_ID},
         "status": "open", "created_at": "2026-10-19T17:31:00Z", "resolved_at": None, "resolved_by": None},
        {"id": uid("alert", "unanswered-g7"), "kind": "unanswered", "severity": "warning", "student_id": st["elif"]["id"],
         "staff_id": STAFF["inst"]["id"], "detail": f"Hocaya iletilen soru cevap bekliyor: \"{by_key['g7']['text_llm']}\"",
         "since": by_key["g7"]["sent_at"], "ref": {"escalation_id": esc[1]["id"]}, "status": "done",
         "created_at": "2026-10-18T17:20:00Z", "resolved_at": by_key["g8"]["sent_at"], "resolved_by": STAFF["inst"]["id"]},
    ]
    proactive = [
        {"id": uid("proactive", "elif-exam"), "student_id": st["elif"]["id"], "chat_id": st["elif"]["tg"],
         "recipient": "student", "template_id": "exam_tomorrow", "params": {"fact_id": 2},
         "scheduled_for": "2026-10-22T16:00:00Z", "sent_at": None, "telegram_message_id": None, "status": "scheduled"},
        {"id": uid("proactive", "mert-plan"), "student_id": st["mert"]["id"], "chat_id": st["mert"]["tg"],
         "recipient": "student", "template_id": "priority_plan_ready",
         "params": {"plan_id": uid("plan", "TYT-MAT:v2"), "course_code": "TYT-MAT"},
         "scheduled_for": "2026-10-08T15:00:00Z", "sent_at": "2026-10-08T15:15:00Z", "telegram_message_id": 4401,
         "status": "sent"},
    ]
    quota_usage = [
        {"id": 1, "student_id": st["elif"]["id"], "staff_id": None, "day": "2026-10-19", "kind": "message", "used": 12,
         "warned": False},
        {"id": 2, "student_id": st["elif"]["id"], "staff_id": None, "day": "2026-10-19", "kind": "test", "used": 1,
         "warned": False},
        {"id": 3, "student_id": st["mert"]["id"], "staff_id": None, "day": "2026-10-19", "kind": "message", "used": 4,
         "warned": False},
        {"id": 4, "student_id": None, "staff_id": STAFF["inst"]["id"], "day": "2026-10-19", "kind": "message", "used": 2,
         "warned": False},
    ]
    weekly = [{"id": uid("weekly", "mert-2026-10-13"), "student_id": st["mert"]["id"], "week_start": "2026-10-13",
               "body": "Öğrenci bu hafta teşhis testini bitirdi ve kesir toplamada paydaları ayrı toplama hatasını "
                       "üç kez tekrarladı. Üslü ifadelerde aynı tabanlı çarpımı sordu. Ödevini pazartesiye kadar "
                       "teslim edeceğini söyledi. Kesirlerde zorlandığını belirtti; moral göstergesi düştü.",
               "metrics": {"messages": 9, "questions_solved": 24, "accuracy": 0.75, "active_days": 4,
                           "open_misconceptions": 1, "unanswered_questions": 1, "morale_trend": "down",
                           "mastery_deltas": [{"skill_id": content.sk("temel.rasyonel-sayilar"), "delta": -0.05,
                                               "reliable": True}]},
               "facts_used": [7, 9, 11], "model": "gemini-2.5-flash-lite", "cost_usd": 0.00016,
               "created_at": "2026-10-20T01:30:00Z"}]

    analysis = lesson.analysis_01()
    analysis_id = uid("lesson_analysis", LESSON_ID)
    lessons = [{"id": LESSON_ID, "enrollment_id": ENROLL["elif"], "staff_id": STAFF["inst"]["id"],
                "held_at": "2026-10-19T15:00:00Z", "duration_min": 90, "video_ref": "local:2026-10-19-ders-01.mp4",
                "video_deleted_at": None, "deletion_notified_at": None, "transcript_path": f"transcripts/{LESSON_ID}.jsonl",
                "frames_count": 8, "status": "analyzed", "created_at": "2026-10-19T17:00:00Z"}]
    seed_profile = {"weak": [], "misconceptions": [], "prereq_hint": None, "explanation_notes": "kısa adımlar işe yarıyor",
                    "weekly_line": None, "open_misconceptions": [], "previous_next_step": None}
    analyses = [{"id": analysis_id, "lesson_id": LESSON_ID, "version": 1, "seed_profile": seed_profile,
                 "analysis": analysis, "model": "gemini-2.5-pro", "cost_usd": 0.41, "status": "draft",
                 "approved_by": None, "approved_at": None, "created_at": "2026-10-19T17:30:00Z"}]
    claims = lesson.claims_from_analysis(analysis, analysis_id, CURRICULUM_ID)

    gen_requests = [{"id": uid("generation_request", "elif-yas"), "kind": "pool_miss", "curriculum_id": CURRICULUM_ID,
                     "skill_id": content.sk("problem.yas"), "difficulty_band": "mid", "topic": None,
                     "question_kind": "mcq", "points": None, "plan_id": None, "requested_by": ENROLL["elif"],
                     "requested_by_staff": None, "served_question_id": None, "served_at": None,
                     "needs_generation": True, "created_at": "2026-10-19T16:20:00Z"}]
    pilot = [
        ("question_accuracy", 0.7273, {"n": 11, "approved": 8, "rejected": 3, "by_reason": {"SymPy": 1, "Çeldirici": 1,
                                                                                         "Şekil": 1}}),
        ("diagnostic_agreement", None, {"n": 1, "numerator": 0, "denominator": 1}),
        ("citation_relevance", None, {"n_rated": 0, "n_total": 3}),
        ("priority_uplift", None, {"plan_ids": [uid("plan", "TYT-MAT:v2")], "n_students": 1, "delta_in": None,
                                   "delta_out": None}),
        ("cost_per_student", 0.0213, {"month_usd": 0.064, "active_students": 3, "lesson_usd": 0.2535}),
        ("flagged_response_share", 0.1333, {"n": 30, "flagged": 4, "by_reason": {"kalite": 4}}),
        ("degraded_share", 0.1667, {"n": 30, "degraded": 3, "schema_invalid": 2, "repaired": 0}),
        ("distractor_unused_share", 0.35, {"n": 20, "unused": 7}),
    ]
    pilot_rows = [{"metric": m, "period": "2026-10-12", "value": v, "detail": d, "computed_at": "2026-10-19T01:20:00Z"}
                  for m, v, d in pilot]
    provider_health = [{"provider": p, "cooldown_until": None, "consecutive_errors": 0, "daily_units_used": 0,
                        "daily_units_day": "2026-10-19", "last_error": None, "updated_at": "2026-10-19T21:00:00Z"}
                       for p in ("gemini-paid", "gemini-free", "groq", "cf-ai", "openrouter")]

    staff_students = [{"staff_id": STAFF["inst"]["id"], "student_id": s["id"]} for s in st.values()]
    staff_students.append({"staff_id": STAFF["obs"]["id"], "student_id": st["elif"]["id"]})

    exam = exam_world()
    research = research_world(research_output)

    seed: dict[str, Any] = {
        "quota_tiers": [
            {"tier": "standard", "label": "Standart", "service_level": "ai_only", "advisor_sla_hours": None},
            {"tier": "pilot", "label": "Pilot", "service_level": "ai_plus_advisor", "advisor_sla_hours": 4},
            {"tier": "staff", "label": "Personel", "service_level": "ai_only", "advisor_sla_hours": None}],
        "quota_limits": [{"tier": t, "kind": k, "daily_limit": v, "warn_at_remaining": 5}
                         for t, vals in (("standard", (25, 5, 0, 0, 10)), ("pilot", (40, 8, 2, 0, 20)),
                                         ("staff", (50, 10, 5, 0, 20)))
                         for k, v in zip(("message", "test", "research", "voice_minutes", "figure"), vals, strict=True)],
        "settings": settings(),
        "runtime_flags": runtime_flags(),
        "retention_policies": retention_policies(),
        "legal_texts": legal,
        "curricula": [{"id": CURRICULUM_ID, "code": "TYT-MAT", "authority": "ÖSYM", "year": 2026, "version": "2026.1",
                       "label": "TYT Matematik 2026", "status": "active"}],
        "skills": content.skills(),
        "skill_prerequisites": content.prerequisites(),
        "misconception_tags": content.misconception_tags(),
        "question_templates": tpls,
        "figures": figs,
        "questions": questions,
        "secure.answer_keys": diag_k + tpl_k + llm_k,
        "diagnostic_tests": [diag_test],
        "content_pool": pool,
        "staff": staff_rows,
        "staff_students": staff_students,
        "students": students,
        "secure.student_pii": pii,
        "secure.telegram_identities": tids,
        "secure.guardian_codes": guardian_codes,
        "secure.staff_codes": staff_codes,
        "secure.auth_links": [],
        "consents": consents,
        "enrollments": enrollments,
        "preferences": prefs,
        "tg_chats": tg_chats,
        "chat_roles": conversations.chat_roles(),
        "sessions": sessions,
        "messages": msgs,
        "memory_facts": facts,
        "weekly_summaries": weekly,
        "bot_responses": responses,
        "llm_calls": calls,
        "spend_ledger": ledger,
        "provider_health": provider_health,
        "quota_usage": quota_usage,
        "escalations": esc,
        "instructor_alerts": alerts,
        "proactive_messages": proactive,
        **learning,
        "lessons": lessons,
        "lesson_analyses": analyses,
        "lesson_claims": claims,
        "generation_requests": gen_requests,
        **exam,
        **research,
        "pilot_metrics": pilot_rows,
    }
    return seed
