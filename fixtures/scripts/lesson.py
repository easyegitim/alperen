"""Ders fixture'ları: lesson-01 transkripti (adlar bilerek geçer) ve analysis-01 (lesson-analysis şeması).

Ses dosyası `fixtures/ders/lesson-01.wav` 20 saniyelik sentetiktir; zaman damgaları bu 20 saniyeye
yerleştirilmiştir. Analizdeki alıntılar transkriptin TEMİZLENMİŞ hâlinden gelir (ad yok).
"""

from __future__ import annotations

from typing import Any

from content import sk
from fxlib import LESSON_ID, STUDENTS, uid

# Ham transkript (transcribe sahtesi bunu döndürür): "Elif" adı bilerek geçer; scrub sonrası [ÖĞRENCİ] olur.
TRANSCRIPT_RAW: list[tuple[str, str, str, str]] = [
    ("00:00:00", "00:00:02", "EĞİTMEN", "Elif, bugün kesirlerde toplamaya bakalım."),
    ("00:00:02", "00:00:04", "ÖĞRENCİ", "Tamam hocam, ama paydalar farklı olunca karışıyor."),
    ("00:00:04", "00:00:06", "EĞİTMEN", "3/4 + 1/8 kaç eder, sesli düşünerek çöz."),
    ("00:00:06", "00:00:08", "ÖĞRENCİ", "Payları toplarım 4, paydaları toplarım 12, yani 4/12."),
    ("00:00:08", "00:00:10", "EĞİTMEN", "Paylar ve paydalar ayrı ayrı toplanmaz Elif. Önce paydayı eşitle."),
    ("00:00:10", "00:00:12", "ÖĞRENCİ", "Anlamadım, neden sekiz?"),
    ("00:00:12", "00:00:14", "EĞİTMEN", "Sekiz, dört ile sekizin ortak katı; 3/4 eşittir 6/8."),
    ("00:00:14", "00:00:16", "ÖĞRENCİ", "O zaman 6/8 + 1/8 = 7/8 oluyor."),
    ("00:00:16", "00:00:18", "EĞİTMEN", "Evet. Denklemde de x/2 + 1 = 4 sorusunu doğru çözdün."),
    ("00:00:18", "00:00:20", "ÖĞRENCİ", "Bu hafta sonuna kadar on kesir sorusu çözeceğim."),
]


def transcript_raw() -> dict[str, Any]:
    return {"segments": [{"t": t, "t_end": te, "speaker": sp, "text": tx} for t, te, sp, tx in TRANSCRIPT_RAW]}


def analysis_01() -> dict[str, Any]:
    """Elif'in 19 Ekim dersi (lesson 00000000-…-0001) — taslak analiz; dev-seed lesson_analyses ile aynı."""
    return {
        "schema_version": "1.0",
        "lesson_ref": LESSON_ID,
        "student_ref": STUDENTS["elif"]["ref"],
        "duration_min": 90,
        "skills": [
            {"skill_id": sk("temel.rasyonel-sayilar"), "mastery_estimate": 0.45, "confidence": 0.8,
             "evidence": [
                 {"speaker": "ÖĞRENCİ", "quote": "Payları toplarım 4, paydaları toplarım 12, yani 4/12.",
                  "t": "00:00:06", "t_end": "00:00:08"},
                 {"speaker": "ÖĞRENCİ", "quote": "O zaman 6/8 + 1/8 = 7/8 oluyor.", "t": "00:00:14",
                  "t_end": "00:00:16"}]},
            {"skill_id": sk("cebir.denklem"), "mastery_estimate": 0.7, "confidence": 0.6,
             "evidence": [{"speaker": "EĞİTMEN", "quote": "Denklemde de x/2 + 1 = 4 sorusunu doğru çözdün.",
                           "t": "00:00:16", "t_end": "00:00:18"}]},
        ],
        "questions": [
            {"t": "00:00:10", "quote": "Anlamadım, neden sekiz?", "skill_id": sk("temel.rasyonel-sayilar"),
             "answered": True},
        ],
        "hesitations": [
            {"t": "00:00:10", "kind": "said_dont_understand", "quote": "Anlamadım, neden sekiz?",
             "skill_id": sk("temel.rasyonel-sayilar")},
            {"t": "00:00:06", "kind": "wrong_answer", "quote": "Payları toplarım 4, paydaları toplarım 12, yani 4/12.",
             "skill_id": sk("temel.rasyonel-sayilar")},
        ],
        "misconceptions": [
            {"tag": "rasyonel.pay-payda-ayri-toplama", "skill_id": sk("temel.rasyonel-sayilar"),
             "text_instructor": "Payları ve paydaları ayrı ayrı topluyor.",
             "text_student": "Paylar ve paydalar ayrı ayrı toplanmaz; önce paydaları eşitleyelim.",
             "resolved_in_lesson": True,
             "evidence": [{"speaker": "ÖĞRENCİ", "quote": "Payları toplarım 4, paydaları toplarım 12, yani 4/12.",
                           "t": "00:00:06", "t_end": "00:00:08"}]},
            {"tag": None, "skill_id": sk("temel.rasyonel-sayilar"),
             "text_instructor": "Ortak paydanın neden seçildiğini açıklayamıyor.",
             "text_student": "Ortak payda iki paydanın ortak katıdır; en küçüğünü seçmek işi kolaylaştırır.",
             "resolved_in_lesson": False,
             "evidence": [{"speaker": "ÖĞRENCİ", "quote": "Anlamadım, neden sekiz?", "t": "00:00:10",
                           "t_end": "00:00:12"}]},
        ],
        "commitments": [
            {"who": "ÖĞRENCİ", "kind": "homework", "text": "Hafta sonuna kadar on kesir sorusu çözecek.",
             "due": "2026-10-25", "t": "00:00:18"},
        ],
        "talk": {"student_ratio": 0.42, "student_questions": 1, "attention": "medium", "morale": "medium",
                 "notes": "Öğrenci soru sormaktan çekinmedi; hatasını fark edince düzeltti."},
        "previous_profile_check": [],
        "next_step": {
            "for_student": "Paydası farklı üç kesir toplama sorusu çöz; her birinde önce ortak paydayı yaz.",
            "for_instructor": "Bir sonraki derste ortak payda seçimini EKOK ile ilişkilendirerek tekrar edin.",
        },
        "model_notes": {"model": "gemini-2.5-pro", "prompt_version": "lesson_analysis.v1", "cost_usd": 0.41,
                        "tokens_in": 182000, "tokens_out": 2600, "frames": 8},
    }


def analysis_mert(open_misconception_id: str) -> dict[str, Any]:
    """İkinci örnek (yalnız fixtures/llm/lesson_analysis): Mert'in dersi; önceki açık yanılgı takip edilir."""
    return {
        "schema_version": "1.0",
        "lesson_ref": uid("lesson", "mert-1"),
        "student_ref": STUDENTS["mert"]["ref"],
        "duration_min": 60,
        "skills": [
            {"skill_id": sk("temel.uslu"), "mastery_estimate": 0.6, "confidence": 0.7,
             "evidence": [{"speaker": "ÖĞRENCİ", "quote": "Tabanlar aynı olduğu için üsleri topladım, 2^7 oldu.",
                           "t": "00:12:40"}]},
            {"skill_id": sk("temel.rasyonel-sayilar"), "mastery_estimate": 0.5, "confidence": 0.75,
             "evidence": [{"speaker": "ÖĞRENCİ", "quote": "Önce paydaları altıda eşitledim, sonra topladım.",
                           "t": "00:31:05"}]},
        ],
        "questions": [{"t": "00:20:11", "quote": "Negatif üs olunca sayı negatif mi olur?",
                       "skill_id": sk("temel.uslu"), "answered": True}],
        "hesitations": [{"t": "00:20:11", "kind": "asked_repeat", "quote": "Bir daha anlatır mısınız?",
                         "skill_id": sk("temel.uslu")}],
        "misconceptions": [
            {"tag": "uslu.negatif-us-isaret", "skill_id": sk("temel.uslu"),
             "text_instructor": "Negatif üssü sonucun işareti sanıyor.",
             "text_student": "Negatif üs tersini alır, işareti değiştirmez.", "resolved_in_lesson": False,
             "evidence": [{"speaker": "ÖĞRENCİ", "quote": "Negatif üs olunca sayı negatif mi olur?", "t": "00:20:11"}]},
        ],
        "commitments": [
            {"who": "EĞİTMEN", "kind": "deadline", "text": "Üslü ifadeler çalışma kâğıdı pazartesi teslim edilecek.",
             "due": "2026-10-26", "t": "00:55:30"},
            {"who": "ÖĞRENCİ", "kind": "promise", "text": "Her akşam beş üslü ifade sorusu çözecek.", "due": None,
             "t": "00:56:02"},
        ],
        "talk": {"student_ratio": 0.31, "student_questions": 4, "attention": "high", "morale": "low",
                 "notes": "Öğrenci yanlış yapmaktan çekindiğini söyledi."},
        "previous_profile_check": [
            {"misconception_id": open_misconception_id, "status": "improved",
             "evidence": [{"speaker": "ÖĞRENCİ", "quote": "Önce paydaları altıda eşitledim, sonra topladım.",
                           "t": "00:31:05"}]},
        ],
        "next_step": {"for_student": "Negatif üslü beş ifadeyi kesir olarak yaz ve sonucu kontrol et.",
                      "for_instructor": "Negatif üs ile negatif sayı ayrımını sayı doğrusu üzerinde gösterin."},
        "model_notes": {"model": "gemini-2.5-pro", "prompt_version": "lesson_analysis.v1", "cost_usd": 0.33,
                        "tokens_in": 141000, "tokens_out": 2100, "frames": 26},
    }


MORALE_NOTE = "Öğrenci yanlış yapmaktan çekindiğini söyledi."
MORALE_LESSON_COST_USD = 0.45  # kulaklik/llm-calls-month.json lesson_analysis satırlarıyla aynı


def analysis_morale(lesson_id: str, ratio: float, day: int) -> dict[str, Any]:
    """kulaklik/lesson-morale.json: Mert'in moralinin düşük olduğu üç dersten birinin tam analizi
    (talk.morale='low'; onaylı talk claim'i bu nesneden türetilir)."""
    return {
        "schema_version": "1.0",
        "lesson_ref": lesson_id,
        "student_ref": STUDENTS["mert"]["ref"],
        "duration_min": 60,
        "skills": [
            {"skill_id": sk("temel.rasyonel-sayilar"), "mastery_estimate": 0.45, "confidence": 0.6,
             "evidence": [{"speaker": "ÖĞRENCİ", "quote": "Yine paydaları ayrı topladım galiba.", "t": "00:18:20"}]},
        ],
        "questions": [{"t": "00:25:40", "quote": "Bunu sınavda da yanlış yaparsam ne olacak?",
                       "skill_id": sk("temel.rasyonel-sayilar"), "answered": True}],
        "hesitations": [{"t": "00:18:20", "kind": "long_silence", "quote": "Yine paydaları ayrı topladım galiba.",
                         "skill_id": sk("temel.rasyonel-sayilar")}],
        "misconceptions": [],
        "commitments": [
            {"who": "ÖĞRENCİ", "kind": "homework", "text": "Paydası farklı beş kesir toplama sorusu çözecek.",
             "due": f"2026-10-{day + 3:02d}", "t": "00:57:10"},
        ],
        "talk": {"student_ratio": ratio, "student_questions": 1, "attention": "medium", "morale": "low",
                 "notes": MORALE_NOTE},
        "previous_profile_check": [],
        "next_step": {"for_student": "Her gün iki kesir sorusu çöz; ilk adımda ortak paydayı yaz.",
                      "for_instructor": "Derse kısa ve kolay bir soruyla başlayıp başarı hissini güçlendirin."},
        "model_notes": {"model": "gemini-2.5-pro", "prompt_version": "lesson_analysis.v1",
                        "cost_usd": MORALE_LESSON_COST_USD, "tokens_in": 150000, "tokens_out": 26250, "frames": 24},
    }


def seed_profile_morale() -> dict[str, Any]:
    """lesson_analyses.seed_profile (§3.6): analiz promptuna verilen profilin anlık görüntüsü."""
    return {"weak": [{"skill_id": sk("temel.rasyonel-sayilar"), "name": "Rasyonel sayılarda dört işlem ve sıralama",
                      "band": "düşük"}],
            "misconceptions": ["Paylar ve paydalar ayrı ayrı toplanmaz; önce paydaları eşitleyelim."],
            "prereq_hint": None, "explanation_notes": None, "weekly_line": None,
            "open_misconceptions": [], "previous_next_step": None}


def claims_from_analysis(analysis: dict[str, Any], analysis_id: str, curriculum_id: str) -> list[dict[str, Any]]:
    """write_lesson_analysis türetimi (§3.9): skills → skill_mastery, misconceptions → misconception, …, talk → tek claim."""

    def sec(ts: str) -> int:
        h, m, s = (int(x) for x in ts.split(":"))
        return h * 3600 + m * 60 + s

    claims: list[dict[str, Any]] = []

    def add(kind: str, skill: str | None, value: dict[str, Any], quote: str, speaker: str, t: str,
            t_end: str | None = None, tag: str | None = None, misconception_id: str | None = None) -> None:
        n = len(claims) + 1
        claims.append({
            "id": uid("lesson_claim", f"{analysis_id}:{n}"), "analysis_id": analysis_id, "kind": kind,
            "curriculum_id": curriculum_id, "skill_id": skill, "misconception_tag": tag,
            "misconception_id": misconception_id, "value": value, "quote": quote, "speaker": speaker,
            "t_start_sec": sec(t), "t_end_sec": sec(t_end) if t_end else None, "status": "pending",
            "edited_value": None, "decided_by": None, "decided_at": None,
        })

    for s in analysis["skills"]:
        ev = s["evidence"][0]
        add("skill_mastery", s["skill_id"], {"mastery": s["mastery_estimate"], "confidence": s["confidence"]},
            ev["quote"], ev["speaker"], ev["t"], ev.get("t_end"))
    for m in analysis["misconceptions"]:
        ev = m["evidence"][0]
        add("misconception", m["skill_id"], {"text": m["text_instructor"], "text_student": m["text_student"]},
            ev["quote"], ev["speaker"], ev["t"], ev.get("t_end"), tag=m.get("tag"))
    for q in analysis["questions"]:
        add("question", q.get("skill_id"), {"text": q["quote"], "answered": q.get("answered", False)},
            q["quote"], "ÖĞRENCİ", q["t"])
    for h in analysis["hesitations"]:
        add("hesitation", h.get("skill_id"), {"text": h.get("quote", h["kind"]), "kind": h["kind"]},
            h.get("quote", h["kind"]), "ÖĞRENCİ", h["t"])
    for c in analysis["commitments"]:
        add(c["kind"], None, {"text": c["text"], "due": c.get("due")}, c["text"], c["who"], c["t"])
    for p in analysis["previous_profile_check"]:
        ev = (p.get("evidence") or [{"quote": "Önceki yanılgı takibi", "speaker": "EĞİTMEN", "t": "00:00:00"}])[0]
        add("followup", None, {"status": p["status"]}, ev["quote"], ev["speaker"], ev["t"],
            misconception_id=p["misconception_id"])
    ns = analysis["next_step"]
    add("next_step", None, {"text": ns["for_student"], "for_instructor": ns["for_instructor"]}, ns["for_student"],
        "EĞİTMEN", "00:00:00")
    talk = analysis["talk"]
    add("talk", None, {k: talk[k] for k in ("student_ratio", "student_questions", "attention", "morale")},
        talk.get("notes") or "Konuşma oranı özeti", "EĞİTMEN", "00:00:00")
    return claims
