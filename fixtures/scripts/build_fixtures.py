#!/usr/bin/env python3
"""fixtures/ altındaki tüm JSON fixture'larını deterministik olarak üretir.

Kullanım:
  python fixtures/scripts/build_fixtures.py           # JSON dosyalarını yazar
  python fixtures/scripts/build_fixtures.py --check   # diskteki dosyalar üretilenle aynı değilse 1 ile çıkar

İkili dosyalar (lesson-01.wav, ders/frames/*.png) `fixtures/ders/scripts/make_fixture.sh`, PDF'ler
`fixtures/scripts/make_pdfs.py` ile üretilir. Şekil kodları (tablet/figures/*) bu betikle yazılır.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))

import content  # noqa: E402
import db_seed  # noqa: E402
import kalem  # noqa: E402
import kitap  # noqa: E402
import kulaklik  # noqa: E402
import lesson  # noqa: E402
import panel  # noqa: E402
import tablet  # noqa: E402
from content import sk  # noqa: E402
from fxlib import FIX, STUDENTS, role_hashes_for, scrub  # noqa: E402

RAT = sk("temel.rasyonel-sayilar")
MUT = sk("cebir.mutlak-deger")


def tutor(reply: str, *, conf: float, skills: list[str], tag: str | None = None, hint: int = 0,
          escalate: bool = False, reason: str | None = None, facts: list[int] | None = None,
          buttons: list[str] | None = None, pool: bool = False) -> dict[str, Any]:
    out: dict[str, Any] = {"reply": reply, "ends_with_question": reply.rstrip().endswith("?"), "hint_level": hint,
                           "confidence": conf, "escalate": escalate, "escalate_reason": reason,
                           "detected_skill_ids": skills, "detected_misconception_tag": tag,
                           "used_fact_ids": facts or [], "suggest_pool_save": pool}
    if buttons is not None:
        out["suggested_buttons"] = buttons
    return out


def llm_chat() -> list[tuple[str, dict[str, Any]]]:
    return [
        ("01-socratic-paydalar.json", tutor(
            "Paylar ve paydalar ayrı ayrı toplanmaz.\n`3/4`'ü sekizde kaç olarak yazabilirsin?", conf=0.86,
            skills=[RAT], tag="rasyonel.pay-payda-ayri-toplama", buttons=["hint", "ask_instructor"])),
        ("02-socratic-hint.json", tutor(
            "İlk adım: `3/4 = 6/8`.\nŞimdi `6/8 + 1/8` toplamında paylara ne yaparsın?", conf=0.9, skills=[RAT],
            hint=1, facts=[4], buttons=["hint", "show_solution"])),
        ("03-pool-save.json", tutor(
            "Kesirleri toplarken önce paydaları eşitleriz, sonra yalnız payları toplarız.\n"
            "`1/2 + 1/3` için ortak payda kaç olur?", conf=0.92, skills=[RAT], pool=True)),
        ("04-low-confidence.json", tutor(
            "Şekli göremediğim için bu soruda emin değilim.\nŞekildeki kenar uzunluklarını yazar mısın?", conf=0.42,
            skills=[], buttons=["ask_instructor"])),
        ("05-escalate.json", tutor(
            "Bundan emin değilim; hocana soralım.", conf=0.35, skills=[MUT], escalate=True, reason="bot_unsure",
            buttons=["ask_instructor"])),
        ("06-direct.json", tutor(
            "Çözüm: `3/4 = 6/8`, sonra `6/8 + 1/8 = **7/8**`.\nBenzer bir soruyu sen dener misin?", conf=0.88,
            skills=[RAT], hint=3)),
        ("injection.json", tutor(
            "Kurallarım aynı kalıyor; birlikte soruya dönelim.\n`3/4 + 1/8` için ortak payda ne olmalı?", conf=0.6,
            skills=[RAT])),
    ]


def llm_chat_group() -> list[tuple[str, dict[str, Any]]]:
    return [
        ("01-group-socratic.json", tutor(
            "Mutlak değerin içi pozitif de olabilir negatif de.\n`x - 2 = 5` dışında hangi denklemi kurarsın?",
            conf=0.85, skills=[MUT], tag="mutlak.tek-durum")),
        ("02-group-hint.json", tutor(
            "İpucu: `|x - 2| = 5` için `x - 2 = -5` durumunu da yaz.\nBu durumda `x` kaç olur?", conf=0.88,
            skills=[MUT], hint=1)),
        ("03-group-pool-save.json", tutor(
            "Ondalık sayıyı 10 ile çarparken virgül bir basamak sağa gider.\n100 ile çarparken kaç basamak kayar?",
            conf=0.91, skills=[sk("temel.ondalik")], pool=True)),
        ("04-group-low-confidence.json", tutor(
            "Bu soruyu tam anlayamadım.\nSorunun kökünü bir kez daha yazar mısın?", conf=0.4, skills=[])),
        ("05-group-escalate.json", tutor(
            "Bunu hocana bırakıyorum.", conf=0.5, skills=[], escalate=True, reason="grade_attendance_payment")),
    ]


def llm_weekly() -> list[tuple[str, dict[str, Any]]]:
    mert, elif_ = STUDENTS["mert"]["ref"], STUDENTS["elif"]["ref"]
    return [
        ("01-mert-2026-10-13.json", {
            "schema_version": "1.0", "student_ref": mert, "week_start": "2026-10-13",
            "body": "Öğrenci bu hafta teşhis testini bitirdi ve kesir toplamada paydaları ayrı toplama hatasını üç kez "
                    "tekrarladı. Üslü ifadelerde aynı tabanlı çarpımı sordu. Ödevini pazartesiye kadar teslim "
                    "edeceğini söyledi. Kesirlerde zorlandığını belirtti; moral göstergesi düştü.",
            "metrics": {"messages": 9, "questions_solved": 24, "accuracy": 0.75, "active_days": 4,
                        "open_misconceptions": 1, "unanswered_questions": 1, "morale_trend": "down",
                        "mastery_deltas": [{"skill_id": RAT, "delta": -0.05, "reliable": True}]},
            "facts_used": [7, 9, 11], "next_week_focus": [RAT, sk("temel.uslu")]}),
        ("02-elif-2026-10-13.json", {
            "schema_version": "1.0", "student_ref": elif_, "week_start": "2026-10-13",
            "body": "Öğrenci rasyonel sayılarda toplamayı çalıştı ve paydaları eşitleyerek doğru sonuca ulaştı. "
                    "Cuma günkü deneme sınavı için kesirleri bitirmeyi hedefliyor. On soru çözme sözünü tuttu. "
                    "Yorgun olduğunu söylese de çalışmaya devam etti.",
            "metrics": {"messages": 16, "questions_solved": 10, "accuracy": 0.8, "active_days": 3,
                        "open_misconceptions": 0, "unanswered_questions": 0, "morale_trend": "flat"},
            "facts_used": [1, 2, 3, 4], "next_week_focus": [RAT, sk("temel.sayilar")]}),
    ]


def transcript_segments(raw: dict[str, Any], scrubbed: bool, student_key: str) -> dict[str, Any]:
    """diarize sahtesi: transkript, dersin öğrencisinin rol hash'leriyle temizlenmiş hâli (§6.3: ad API'ye gitmez)."""
    if not scrubbed:
        return raw
    roles = role_hashes_for(student_key)
    return {"segments": [dict(s, text=scrub(s["text"], {"nameHashes": [], "roleHashes": roles})["text"])
                         for s in raw["segments"]]}


def llm_files(seed: dict[str, Any], by_text: dict[str, int]) -> dict[str, list[tuple[str, Any]]]:
    raw = lesson.transcript_raw()
    second = {"segments": [
        {"t": "00:00:00", "t_end": "00:00:03", "speaker": "EĞİTMEN", "text": "Mert, üslü ifadelerle başlayalım."},
        {"t": "00:00:03", "t_end": "00:00:06", "speaker": "ÖĞRENCİ", "text": "Negatif üs olunca sayı negatif mi olur?"},
        {"t": "00:00:06", "t_end": "00:00:10", "speaker": "EĞİTMEN",
         "text": "Hayır, negatif üs tersini alır: 2^-1 eşittir 1/2."}]}
    mert_mis = next(m for m in seed["misconceptions"] if m["tag"] == "rasyonel.pay-payda-ayri-toplama")
    nightly = kulaklik.nightly_outputs(by_text)
    files: dict[str, list[tuple[str, Any]]] = {
        "chat": llm_chat(),
        "chat_group": llm_chat_group(),
        "nightly_facts": [("01-elif-2026-10-18.json", nightly[0]), ("02-mert-2026-10-18.json", nightly[1]),
                          ("03-elif-2026-10-18-alt.json", nightly[2])],
        "weekly_summary": llm_weekly(),
        "question_gen": tablet.question_gen(),
        "vision_check": tablet.vision_check(),
        "ocr": [("01-exam-2022.json", kalem.ocr_2022()), ("02-exam-2023.json", kalem.ocr_2023())],
        "lesson_analysis": [("01-analysis-01.json", lesson.analysis_01()),
                            ("02-mert.json", lesson.analysis_mert(mert_mis["id"]))],
        "transcribe": [("01-lesson-01.json", raw), ("02-mert.json", second)],
        "diarize": [("01-lesson-01.json", transcript_segments(raw, True, "elif")),
                    ("02-mert.json", transcript_segments(second, True, "mert"))],
        "query_expand": kitap.query_expand(),
        "research": [("01-spaced-repetition.json", kitap.research_llm_1()), ("02-kesirler.json", kitap.research_llm_2())],
    }
    bad: dict[str, Any] = {
        "chat": {"reply": "", "ends_with_question": "evet", "confidence": 1.4, "escalate": False},
        "chat_group": {"reply": "Harika!!! 🎉", "confidence": -1, "detected_skill_ids": ["Rasyonel Sayılar"],
                       "used_fact_ids": "yok"},
        "nightly_facts": {"schema_version": "1.0", "day": "18 Ekim", "student_ref": "Elif Kaya",
                          "facts": [{"kind": "promise", "text": "Elif söz verdi", "source_message_ids": []}]},
        "weekly_summary": {"schema_version": "1.0", "student_ref": STUDENTS["mert"]["ref"], "week_start": "2026-10-13",
                           "body": "Uzun gövde. " * 60, "metrics": {"messages": "dokuz"}, "facts_used": []},
        "question_gen": tablet.question_gen_bad_schema(),
        "vision_check": {"matches_stem": True, "status": "mismatch", "mismatches": ["payda yanlış"]},
        "ocr": [{"schema_version": "1.0", "source_id": "kaynak-2022", "item_no": 0, "topic": "Rasyonel sayılar",
                 "kind": "essay", "year": "2022"}],
        "lesson_analysis": {"schema_version": "1.0", "lesson_ref": "ders-1", "student_ref": STUDENTS["elif"]["ref"],
                            "skills": [{"skill_id": RAT, "mastery_estimate": 0.5, "confidence": 0.8, "evidence": []}],
                            "talk": {"student_ratio": 1.5}},
        "transcribe": {"segments": [{"t": "0:05", "speaker": "HOCA", "text": "Elif, başlayalım."}]},
        "diarize": {"segments": []},
        "query_expand": {"queries": ["aralıklı tekrar"]},
        "research": dict(kitap.research_llm_1(), citations=[{"ordinal": 1, "doi": "10.9999/fake", "title": "Uydurma",
                                                             "authors": "Yazar, A.", "year": 2021,
                                                             "crossref_status": "unresolved"}]),
    }
    for purpose, obj in bad.items():
        files[purpose].append(("bad-schema.json", obj))
    return files


def build() -> dict[str, Any]:
    """Göreli yol → JSON nesnesi (ya da metin dosyaları için str)."""
    research = kitap.research_verified()
    seed = db_seed.build(research)
    msgs_day = kulaklik.messages_day(seed)
    by_text = {m["text_llm"]: m["id"] for m in msgs_day if m["text_llm"]}
    out: dict[str, Any] = {"db/dev-seed.json": seed}

    for purpose, files in llm_files(seed, by_text).items():
        for fname, obj in files:
            out[f"llm/{purpose}/{fname}"] = obj

    qg = dict(tablet.question_gen())
    out["tablet/llm-question.json"] = qg["01-rasyonel-kesir-modeli.json"]
    out["tablet/llm-question-bad-sympy.json"] = qg["03-bad-sympy.json"]
    out["tablet/llm-question-bad-schema.json"] = tablet.question_gen_bad_schema()
    out["tablet/generation_requests.json"] = tablet.generation_requests()
    out["tablet/figures/good.py"] = tablet.GOOD_PY
    out["tablet/figures/blank.py"] = tablet.BLANK_PY
    out["tablet/figures/net.py"] = tablet.NET_PY
    out["tablet/figures/bad.svg"] = tablet.BAD_SVG

    out["kitap/openalex-search.json"] = kitap.openalex()
    out["kitap/s2-search.json"] = kitap.s2()
    out["kitap/arxiv-search.json"] = kitap.arxiv()
    out["kitap/crossref-ok.json"] = kitap.crossref_ok()
    out["kitap/crossref-404.json"] = kitap.crossref_404()
    out["kitap/unpaywall.json"] = kitap.unpaywall()
    out["kitap/requests.json"] = kitap.requests()

    out["kalem/courses.json"] = [kalem.course()]
    out["kalem/exam_sources.json"] = kalem.exam_sources()
    out["kalem/ocr-2022.json"] = kalem.ocr_2022()
    out["kalem/ocr-2023.json"] = kalem.ocr_2023()
    out["kalem/syllabus.json"] = kalem.syllabus()

    out["kulaklik/messages-day.json"] = msgs_day
    out["kulaklik/facts-day.json"] = kulaklik.nightly_outputs(by_text)[:2]
    out["kulaklik/escalations.json"] = seed["escalations"]
    out["kulaklik/bot-responses-week.json"] = seed["bot_responses"]
    out["kulaklik/questions-review.json"] = kulaklik.questions_review()
    out["kulaklik/chats.json"] = kulaklik.chats()
    out["kulaklik/lesson-morale.json"] = kulaklik.lesson_morale()
    out["kulaklik/students.json"] = seed["students"]
    out["kulaklik/memory-facts.json"] = seed["memory_facts"]
    calls = kulaklik.llm_calls_month()
    out["kulaklik/llm-calls-month.json"] = calls
    out["kulaklik/spend-ledger-month.json"] = kulaklik.spend_ledger(calls)

    out["ders/lesson-01.transcript.json"] = lesson.transcript_raw()
    out["ders/analysis-01.json"] = lesson.analysis_01()
    out["ders/lessons.json"] = [{k: v for k, v in seed["lessons"][0].items()} | {
        "student_ref": STUDENTS["elif"]["ref"]}]
    out["ders/labels.json"] = [{"hash": h, "label": lbl} for h, lbl in role_hashes_for("elif").items()]

    out["panel/overview.json"] = panel.overview(seed)
    out["panel/alerts.json"] = panel.alerts(seed)
    out["panel/lesson_analysis.json"] = panel.lesson_analysis(seed)
    out["panel/bot_responses.json"] = panel.bot_responses(seed)
    out["panel/queue.json"] = panel.queue(seed)
    out["panel/consents.json"] = panel.consents(seed)
    out["panel/students.json"] = panel.students(seed)
    out["panel/priority_plans.json"] = panel.priority_plans(seed)
    out["panel/chats.json"] = panel.chats(seed)
    out["panel/pilot.json"] = panel.pilot(seed)
    _ = content
    return out


def render(obj: Any) -> str:
    if isinstance(obj, str):
        return obj
    return json.dumps(obj, ensure_ascii=False, indent=2) + "\n"


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--check", action="store_true", help="dosyalar güncel değilse 1 ile çık")
    args = ap.parse_args()
    files = build()
    stale = []
    for rel, obj in sorted(files.items()):
        p = FIX / rel
        text = render(obj)
        if args.check:
            if not p.exists() or p.read_text(encoding="utf-8") != text:
                stale.append(rel)
            continue
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(text, encoding="utf-8")
    if args.check:
        if stale:
            print("Güncel olmayan fixture'lar:\n  " + "\n  ".join(stale), file=sys.stderr)
            return 1
        print(f"OK: {len(files)} fixture güncel")
        return 0
    print(f"{len(files)} fixture yazıldı")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
