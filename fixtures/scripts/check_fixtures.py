#!/usr/bin/env python3
"""fixtures/ tutarlılık denetimi (M01'in kendi doğrulaması; M13 `fixtures-valid` CI işinin yerel eşleniği).

Denetimler:
  1. fixtures/**/*.json parse edilir.
  2. fixtures/llm/<amaç>/*.json klasör → şema eşlemesiyle packages/contracts/schemas'a karşı doğrulanır;
     bad-schema*.json GEÇMEMELİDİR; her klasörde ≥ 1 bad-schema.json vardır; §2.3 sayı kuralları.
  3. telegram/*.json → telegram-update; tablet/llm-question*.json → question-generation; ders/*.json,
     kalem/ocr-*.json, tablet/generation_requests.json, kitap ve panel sözleşme nesneleri.
  4. dev-seed.json değişmezleri: tam bir aktif müfredat, settings.default_period, sayılar (3 öğrenci, 1 eğitmen,
     1 koordinatör, 1 gözlemci, 1 grup, 40 mesaj, 12 olgu, 30 bot cevabı, 1 taslak ders analizi), kanıt zinciri,
     LLM'e giden metinlerde ad yok, bot metinlerinde emoji/ünlem yok.
  5. Çapraz bağlar: nightly_facts mesaj id'leri messages-day.json'da; analysis-01 = llm/lesson_analysis/01;
     kulaklık sayıları (4/30 işaretli, 3 degraded + 2 schema_valid=false, 8/11 soru); ses dosyası ≤ 300 KB;
     callback_data ≤ 64 bayt ve tam UUID'lere çözülür; lesson-morale analizleri tam ve maliyeti llm_calls ile aynı.
  6. PII: LLM'e giden her alan (messages.text_llm, bot_responses.prompt_text, memory_facts.text, llm/diarize,
     llm/lesson_analysis, ders/analysis-01) temizleyiciye göre sabit noktadır: scrub(metin, tüm ad hash'leri) == metin.
     Yasaklı kelimeler packages/contracts'ın `find_forbidden_word`'üyle (aynı Türkçe katlama) aranır.

Kullanım: python fixtures/scripts/check_fixtures.py   (hata varsa 1 ile çıkar)
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path
from typing import Any

from jsonschema import Draft202012Validator, FormatChecker
from referencing import Registry, Resource

ROOT = Path(__file__).resolve().parents[2]
FIX = ROOT / "fixtures"
SCHEMAS = ROOT / "packages" / "contracts" / "schemas"

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(ROOT / "packages" / "contracts" / "python"))
from ogrenmen_contracts._core import find_forbidden_word  # noqa: E402

from fxlib import NEWCOMER, UNCONSENTED, all_name_hashes, name_token_hashes, scrub, uuid_from_b64url  # noqa: E402

LLM_SCHEMA = {
    "chat": "tutor-reply", "chat_group": "tutor-reply", "nightly_facts": "nightly-facts-output",
    "weekly_summary": "weekly-summary", "question_gen": "question-generation", "vision_check": "figure-render-report",
    "ocr": "exam-item[]", "lesson_analysis": "lesson-analysis", "transcribe": "transcript", "diarize": "transcript",
    "query_expand": "query-expand", "research": "research-output",
}
MIN_FILES = {"chat": 4, "chat_group": 4, "nightly_facts": 3, "weekly_summary": 2, "question_gen": 3,
             "vision_check": 2, "ocr": 2, "lesson_analysis": 2, "research": 2, "transcribe": 1, "diarize": 1,
             "query_expand": 1}
EMOJI = re.compile("(?![\u2713\u2715\u2605\u00b7])[\U0001F300-\U0001FAFF\u2600-\u26FF\u2700-\u27BF]")  # ✓ ✕ ★ · serbest
FORBIDDEN_NAMES = ("Elif", "Kaya", "Mert", "Demir", "Zeynep", "Çelik", "Ayşe", "Yılmaz", "Fatma", "Selin", "Arslan",
                   "Hakan", "Deniz", "Koç", "Barış", "Tunç", "Öztürk", "elif_k", "mert_d", "zeynep_c", "ayse_hoca",
                   "selin_koord", "baris_t", "can_o")
# Dünyadaki herkesin ad-token hash'leri (öğrenciler + veliler + personel + onaysız üye + yeni kullanıcı).
WORLD_HASHES = list(dict.fromkeys(all_name_hashes() + name_token_hashes(
    f"{UNCONSENTED['first_name']} {UNCONSENTED['last_name']} {NEWCOMER['first_name']} {NEWCOMER['last_name']}")))

errors: list[str] = []


def fail(msg: str) -> None:
    errors.append(msg)


def registry() -> Registry:
    reg = Registry()
    for p in SCHEMAS.glob("*.schema.json"):
        s = json.loads(p.read_text(encoding="utf-8"))
        reg = reg.with_resource(s["$id"], Resource.from_contents(s))
    return reg


REG = registry()


def validator(name: str) -> Draft202012Validator:
    s = json.loads((SCHEMAS / f"{name}.schema.json").read_text(encoding="utf-8"))
    return Draft202012Validator(s, registry=REG, format_checker=FormatChecker())


def errs(name: str, obj: Any) -> list[str]:
    if name.endswith("[]"):
        if not isinstance(obj, list) or not obj:
            return ["boş olmayan dizi bekleniyor"]
        v = validator(name[:-2])
        return [f"[{i}] {e.message}" for i, o in enumerate(obj) for e in v.iter_errors(o)]
    return [e.message for e in validator(name).iter_errors(obj)]


def forbidden_words(name: str, obj: Any) -> list[str]:
    """Şemanın `x-forbidden-words` listesinden ilk isabet (packages/contracts ile aynı kural)."""
    s = json.loads((SCHEMAS / f"{name}.schema.json").read_text(encoding="utf-8"))
    hit = find_forbidden_word(obj, s.get("x-forbidden-words", []))
    return [f"yasaklı kelime: {hit}"] if hit is not None else []


def strings(obj: Any) -> list[str]:
    """JSON değerindeki tüm dizgeler (anahtarlar hariç)."""
    if isinstance(obj, str):
        return [obj]
    if isinstance(obj, list):
        return [x for v in obj for x in strings(v)]
    if isinstance(obj, dict):
        return [x for v in obj.values() for x in strings(v)]
    return []


def pii_leaks(obj: Any) -> list[str]:
    """LLM'e giden metin temizleyicinin sabit noktası olmalı: scrub(t, tüm ad hash'leri) == t. Ad, telefon,
    e-posta, @kullanıcı, okul, şube … kalmışsa o dizgeler döner."""
    out = []
    for t in strings(obj):
        if scrub(t, {"nameHashes": WORLD_HASHES})["text"] != t or any(n in t for n in FORBIDDEN_NAMES):
            out.append(t)
    return out


def load(rel: str) -> Any:
    return json.loads((FIX / rel).read_text(encoding="utf-8"))


def check_parse() -> None:
    for p in sorted(FIX.rglob("*.json")):
        try:
            json.loads(p.read_text(encoding="utf-8"))
        except (ValueError, UnicodeDecodeError) as e:
            fail(f"{p.relative_to(FIX)}: JSON değil ({e})")


def check_llm() -> None:
    for purpose, schema in LLM_SCHEMA.items():
        d = FIX / "llm" / purpose
        files = sorted(d.glob("*.json"))
        good = [f for f in files if not f.name.startswith("bad-schema")]
        bad = [f for f in files if f.name.startswith("bad-schema")]
        if len(good) < MIN_FILES[purpose]:
            fail(f"llm/{purpose}: {len(good)} geçerli dosya, en az {MIN_FILES[purpose]} gerekli")
        if not bad:
            fail(f"llm/{purpose}: bad-schema.json yok")
        for f in good:
            e = errs(schema, json.loads(f.read_text(encoding="utf-8")))
            if e:
                fail(f"llm/{purpose}/{f.name}: şemaya uymuyor: {e[:3]}")
        for f in bad:
            if not errs(schema, json.loads(f.read_text(encoding="utf-8"))):
                fail(f"llm/{purpose}/{f.name}: bad-schema şemadan GEÇİYOR")
    chat = [json.loads(f.read_text()) for f in sorted((FIX / "llm/chat").glob("*.json")) if "bad" not in f.name]
    if not any(c["escalate"] for c in chat) or not any(c["confidence"] < 0.55 for c in chat) or not any(
            c["suggest_pool_save"] for c in chat):
        fail("llm/chat: escalate=true, confidence<0.55 ve suggest_pool_save=true dosyaları gerekli")
    if not (FIX / "llm/chat/injection.json").exists():
        fail("llm/chat/injection.json yok")
    for purpose in ("chat", "chat_group"):
        for f in (FIX / "llm" / purpose).glob("*.json"):
            if f.name.startswith("bad"):
                continue
            r = json.loads(f.read_text())["reply"]
            if "!" in r or EMOJI.search(r) or len(r.splitlines()) > 4:
                fail(f"llm/{purpose}/{f.name}: cevap metni kurala aykırı (ünlem/emoji/4+ satır)")
            if any(n in r for n in FORBIDDEN_NAMES):
                fail(f"llm/{purpose}/{f.name}: cevapta ad geçiyor")
    vis = [json.loads(f.read_text())["status"] for f in (FIX / "llm/vision_check").glob("0*.json")]
    if set(vis) != {"match", "mismatch"}:
        fail("llm/vision_check: match ve mismatch örnekleri gerekli")
    dois = [c.get("doi") for f in (FIX / "llm/research").glob("0*.json") for c in json.loads(f.read_text())["citations"]]
    if "10.9999/fake" not in dois:
        fail("llm/research: 10.9999/fake DOI'li örnek gerekli")
    if load("llm/lesson_analysis/01-analysis-01.json") != load("ders/analysis-01.json"):
        fail("llm/lesson_analysis/01 ile ders/analysis-01.json aynı değil")
    # diarize ve lesson_analysis çıktıları temizlenmiş metinden üretilir (§6.3): ad/PII içermez
    for purpose in ("diarize", "lesson_analysis"):
        for f in sorted((FIX / "llm" / purpose).glob("0*.json")):
            leaks = pii_leaks(json.loads(f.read_text(encoding="utf-8")))
            if leaks:
                fail(f"llm/{purpose}/{f.name}: temizlenmemiş metin {leaks[:2]}")
    if pii_leaks(load("ders/analysis-01.json")):
        fail("ders/analysis-01.json: temizlenmemiş metin")


def check_contract_files() -> None:
    for p in sorted((FIX / "telegram").glob("*.json")):
        e = errs("telegram-update", json.loads(p.read_text()))
        if e:
            fail(f"telegram/{p.name}: {e[:2]}")
    for name in ("private_text", "private_start", "callback_answer", "group_mention", "group_plain",
                 "group_instructor_reply", "new_member", "new_member_service_message", "bot_added",
                 "bot_added_not_admin", "edited_message", "voice", "oversized", "group_unconsented_mention"):
        if not (FIX / "telegram" / f"{name}.json").exists():
            fail(f"telegram/{name}.json yok")
    pt = load("telegram/private_text.json")["message"]["from"]
    if pt.get("first_name") != "Elif" or pt.get("last_name") != "Kaya":
        fail("telegram/private_text.json: from Elif Kaya olmalı")
    if len((FIX / "telegram/oversized.json").read_bytes()) <= 64 * 1024:
        fail("telegram/oversized.json 64 KB'tan büyük olmalı")
    if load("telegram/bot_added_not_admin.json")["my_chat_member"]["new_chat_member"]["status"] != "member":
        fail("bot_added_not_admin: status='member' olmalı")
    if load("telegram/api/getChatMember.member.json")["result"]["status"] != "member":
        fail("telegram/api/getChatMember.member.json status='member' olmalı")
    if "new_chat_members" not in load("telegram/new_member_service_message.json")["message"]:
        fail("new_member_service_message: new_chat_members yok")
    check_callback()

    if errs("question-generation", load("tablet/llm-question.json")):
        fail("tablet/llm-question.json geçersiz")
    if errs("question-generation", load("tablet/llm-question-bad-sympy.json")):
        fail("tablet/llm-question-bad-sympy.json şemaya uymalı (yalnız SymPy'de düşer)")
    if not errs("question-generation", load("tablet/llm-question-bad-schema.json")):
        fail("tablet/llm-question-bad-schema.json şemadan geçmemeli")
    reqs = load("tablet/generation_requests.json")
    kinds = sorted(r["kind"] for r in reqs)
    if kinds != ["exam_variant", "pool_miss", "pool_miss"]:
        fail(f"tablet/generation_requests.json: 2 pool_miss + 1 exam_variant bekleniyor ({kinds})")
    for r in reqs:
        e = errs("generation-request", r)
        if e or "ocr_text" in r or not r["needs_generation"] or r["served_question_id"]:
            fail(f"tablet/generation_requests.json satırı uygun değil: {e[:2]}")
    for n in ("good.py", "blank.py", "net.py", "bad.svg"):
        if not (FIX / "tablet/figures" / n).exists():
            fail(f"tablet/figures/{n} yok")

    for rel, schema in (("ders/lesson-01.transcript.json", "transcript"), ("ders/analysis-01.json", "lesson-analysis"),
                        ("kalem/ocr-2022.json", "exam-item[]"), ("kalem/ocr-2023.json", "exam-item[]")):
        e = errs(schema, load(rel))
        if e:
            fail(f"{rel}: {e[:2]}")
    if "Elif" not in json.dumps(load("ders/lesson-01.transcript.json"), ensure_ascii=False):
        fail("ders/lesson-01.transcript.json içinde 'Elif' bilerek geçmeli")
    if any(n in json.dumps(load("ders/analysis-01.json"), ensure_ascii=False) for n in ("Elif", "Kaya")):
        fail("ders/analysis-01.json içinde ad geçmemeli")
    wav = FIX / "ders/lesson-01.wav"
    if not wav.exists() or wav.stat().st_size > 300 * 1024:
        fail("ders/lesson-01.wav yok ya da 300 KB'tan büyük")
    if len(list((FIX / "ders/frames").glob("*.png"))) != 8:
        fail("ders/frames/*.png 8 kare olmalı")
    for rel in ("kalem/exam-2022.pdf", "kitap/sample.pdf"):
        p = FIX / rel
        if not p.exists() or not p.read_bytes().startswith(b"%PDF"):
            fail(f"{rel} PDF değil ya da yok")

    srcs = load("kalem/exam_sources.json")
    up = [s for s in srcs if s["status"] == "uploaded"]
    if len(up) != 1 or up[0]["instructor_alias"] != "hoca-A" or not up[0]["storage_path"].startswith("exams/"):
        fail("kalem/exam_sources.json: tam 1 uploaded, instructor_alias='hoca-A', storage_path exams/<uuid>.pdf")
    rq = sorted(r["status"] for r in load("kitap/requests.json"))
    if rq != ["done", "queued", "queued"]:
        fail(f"kitap/requests.json: 2 queued + 1 done bekleniyor ({rq})")
    ax = load("kitap/arxiv-search.json")["entries"]
    if len(ax) != 2 or sum(1 for e in ax if not e["doi"]) != 1:
        fail("kitap/arxiv-search.json: 2 kayıt, biri DOI'siz")
    if "10.9999/fake" not in load("kitap/crossref-404.json"):
        fail("kitap/crossref-404.json: 10.9999/fake yok")


def check_seed() -> None:
    s = load("db/dev-seed.json")
    act = [c for c in s["curricula"] if c["status"] == "active"]
    if len(act) != 1 or (act[0]["code"], act[0]["year"], act[0]["version"]) != ("TYT-MAT", 2026, "2026.1"):
        fail("dev-seed: tam bir aktif TYT-MAT 2026.1 müfredatı gerekli")
    dp = [r for r in s["settings"] if r["key"] == "default_period"]
    if not dp or dp[0]["value"] != "YKS 2027":
        fail("dev-seed: settings.default_period='YKS 2027' yok")
    roles = sorted(r["role"] for r in s["staff"])
    if roles != ["coordinator", "instructor", "observer"]:
        fail(f"dev-seed: 1 koordinatör, 1 eğitmen, 1 gözlemci bekleniyor ({roles})")
    if len(s["students"]) != 3:
        fail("dev-seed: 3 öğrenci bekleniyor")
    kinds = {}
    for c in s["consents"]:
        kinds.setdefault(c["student_id"], set()).add(c["kind"])
    minors_missing = [st for st in s["students"] if st["is_minor"] and "veli_onayi" not in kinds.get(st["id"], set())]
    if len(minors_missing) != 1:
        fail("dev-seed: tam bir reşit olmayan, veli onayı eksik öğrenci bekleniyor")
    groups = [c for c in s["tg_chats"] if c["kind"] != "private"]
    counts = {"messages": 40, "memory_facts": 12, "bot_responses": 30}
    for t, n in counts.items():
        if len(s[t]) != n:
            fail(f"dev-seed: {t} {len(s[t])} satır, {n} bekleniyor")
    if len(groups) != 1:
        fail("dev-seed: 1 grup bekleniyor")
    if [a["status"] for a in s["lesson_analyses"]] != ["draft"]:
        fail("dev-seed: 1 taslak ders analizi bekleniyor")
    msg_ids = {m["id"] for m in s["messages"]}
    for f in s["memory_facts"]:
        if not f["source_message_ids"] or not set(f["source_message_ids"]) <= msg_ids:
            fail(f"dev-seed: olgu {f['id']} kaynak mesajı yok")
    no_consent = {st["id"] for st in minors_missing}
    for m in s["messages"]:
        if m["sender_role"] == "student" and (m["student_id"] in no_consent or m["student_id"] is None) and (
                m["text_raw"] is not None or m["text_llm"] is not None):
            fail(f"dev-seed: onaysız üyenin mesajı {m['id']} metin taşıyor")
        if m["text_llm"] and pii_leaks(m["text_llm"]):
            fail(f"dev-seed: mesaj {m['id']} text_llm temizlenmemiş: {m['text_llm']!r}")
    for r in s["bot_responses"]:
        if "!" in r["response_text"] or EMOJI.search(r["response_text"]):
            fail(f"dev-seed: bot cevabı {r['id']} ünlem/emoji içeriyor")
        if r["prompt_text"] and pii_leaks(r["prompt_text"]):
            fail(f"dev-seed: bot cevabı {r['id']} prompt_text temizlenmemiş: {pii_leaks(r['prompt_text'])[:1]}")
    for f in s["memory_facts"]:
        if pii_leaks(f["text"]):
            fail(f"dev-seed: olgu {f['id']} metni temizlenmemiş: {f['text']!r}")
    obs = {o["id"]: o for o in s["observations"]}
    att = {str(a["id"]) for a in s["attempts"]}
    notes = {n["id"] for n in s["instructor_notes"]}
    for o in s["observations"]:
        ok = (o["source_type"] == "attempt" and o["source_id"] in att) or (
            o["source_type"] == "observation" and int(o["source_id"]) in obs) or (
            o["source_type"] == "instructor_note" and o["source_id"] in notes)
        if not ok:
            fail(f"dev-seed: gözlem {o['id']} kaynaksız")
    q = {x["id"]: x for x in s["questions"]}
    keys = {k["question_id"] for k in s["secure.answer_keys"]}
    figs = {f["id"]: f for f in s["figures"]}
    for x in s["questions"]:
        nulls = sum(1 for o in x["options"] or [] if o["misconception_tag"] is None)
        if x["kind"] == "mcq" and (len(x["options"]) != 4 or nulls < 2):
            fail(f"dev-seed: soru {x['id']} şık kuralı (4 şık, ≥ 2 null)")
        if x["status"] == "approved":
            if x["id"] not in keys:
                fail(f"dev-seed: onaylı soru {x['id']} anahtarsız")
            if x["figure_id"] and figs[x["figure_id"]]["review_status"] != "verified":
                fail(f"dev-seed: onaylı soru {x['id']} doğrulanmamış şekilli")
        e = errs("question-item", {"schema_version": "1.0", "curriculum_code": "TYT-MAT@2026.1", "kind": x["kind"],
                                   "skill_ids": x["skill_ids"], "stem": x["stem"], "figure": None,
                                   "options": x["options"], "source": x["source"],
                                   "verification": dict(x["verification"], status=x["status"])})
        if e:
            fail(f"dev-seed: soru {x['id']} question-item'a uymuyor: {e[:2]}")
    practice = [x for x in s["questions"] if x["status"] == "approved" and x["source"] in ("template", "instructor")]
    if len(practice) < 10:
        fail("dev-seed: en az 10 onaylı şablon sorusu gerekli (practice-after-diagnostic)")
    if len(s["diagnostic_tests"][0]["item_ids"]) != 20 or not all(i in q for i in s["diagnostic_tests"][0]["item_ids"]):
        fail("dev-seed: teşhis testi 20 madde")
    tags = {t["tag"] for t in s["misconception_tags"]}
    if len(tags) != 27:
        fail("dev-seed: 27 yanılgı etiketi bekleniyor")
    for x in s["questions"]:
        for o in x["options"] or []:
            if o["misconception_tag"] and o["misconception_tag"] not in tags:
                fail(f"dev-seed: bilinmeyen etiket {o['misconception_tag']}")
    approved = [p for p in s["exam_priority_plans"] if p["status"] == "approved"]
    if len(approved) != 1:
        fail("dev-seed: tam bir onaylı öncelik planı")
    for p in s["exam_priority_plans"]:
        e = errs("exam-priority-plan", p["plan"]) + forbidden_words("exam-priority-plan", p["plan"])
        if e:
            fail(f"dev-seed: plan {p['id']}: {e[:2]}")
    if errs("research-output", s["research_outputs"][0]["output"]):
        fail("dev-seed: research_outputs[0].output geçersiz")
    if errs("lesson-analysis", s["lesson_analyses"][0]["analysis"]):
        fail("dev-seed: lesson_analyses[0].analysis geçersiz")
    body = next(t["body_md"] for t in s["legal_texts"] if t["kind"] == "kvkk_aydinlatma")
    if "<!-- ogrenmen:cocuk-dili:start -->" not in body or "{{" in json.dumps(s["legal_texts"], ensure_ascii=False):
        fail("dev-seed: aydınlatma metninde çocuk dili işaretleri yok ya da çözülmemiş yer tutucu var")
    for r in s["bot_responses"]:
        row = {k: v for k, v in r.items() if k not in ("id", "student_id", "flagged", "flagged_by", "flag_reason",
                                                       "flagged_at", "review_week", "created_at")}
        e = errs("bot-response-log", dict(row, schema_version="1.0"))
        if e:
            fail(f"dev-seed: bot cevabı {r['id']} bot-response-log'a uymuyor: {e[:2]}")
    import panel  # noqa: PLC0415
    for a in panel.alerts(s):
        c = {k: v for k, v in a.items() if k not in ("id", "status", "student_label")}
        e = errs("instructor-alert", c) + forbidden_words("instructor-alert", c)
        if e:
            fail(f"dev-seed: alarm {a['id']}: {e[:2]}")


def check_callback() -> None:
    """ans:<session b64url>:<question b64url>:<key> — ≤ 64 bayt, kayıpsız; Elif'in açık teşhis oturumu ve
    o oturumun sıradaki maddesi (M04 tam UUID'yi sessions.diagnostic_session_id ile denetler)."""
    seed = load("db/dev-seed.json")
    cq = load("telegram/callback_answer.json")["callback_query"]
    datas = [cq["data"]] + [b["callback_data"] for row in cq["message"]["reply_markup"]["inline_keyboard"] for b in row]
    sess = {x["id"]: x for x in seed["diagnostic_sessions"]}
    tests = {t["id"]: t for t in seed["diagnostic_tests"]}
    session_ids = {x["diagnostic_session_id"] for x in seed["sessions"] if x["diagnostic_session_id"]}
    for d in datas:
        parts = d.split(":")
        if len(d.encode("utf-8")) > 64 or len(parts) != 4 or parts[0] != "ans" or parts[3] not in "ABCD":
            fail(f"callback_answer: biçim ans:<22>:<22>:<A-D>, ≤ 64 bayt ({d!r})")
            continue
        try:
            sid, qid = uuid_from_b64url(parts[1]), uuid_from_b64url(parts[2])
        except ValueError as e:
            fail(f"callback_answer: base64url çözülemedi ({e})")
            continue
        ds = sess.get(sid)
        if ds is None or sid not in session_ids:
            fail(f"callback_answer: oturum {sid} dev-seed sessions/diagnostic_sessions'da yok")
            continue
        items = tests[ds["test_id"]]["item_ids"]
        if ds["current_index"] >= len(items) or items[ds["current_index"]] != qid:
            fail(f"callback_answer: soru {qid} oturumun sıradaki maddesi değil")


def check_kulaklik() -> None:
    day = load("kulaklik/messages-day.json")
    ids = {m["id"] for m in day}
    if any("text_raw" in m for m in day):
        fail("kulaklik/messages-day.json text_raw taşımamalı (batch_worker sütun yetkisi yok)")
    for f in sorted((FIX / "llm/nightly_facts").glob("0*.json")):
        o = json.loads(f.read_text())
        used = {i for fact in o["facts"] for i in fact["source_message_ids"]} | set(o["is_question_message_ids"]) | set(
            o["answered_question_message_ids"])
        if not used <= ids:
            fail(f"llm/nightly_facts/{f.name}: messages-day.json dışında mesaj id'si {sorted(used - ids)}")
    for o in load("kulaklik/facts-day.json"):
        if errs("nightly-facts-output", o):
            fail("kulaklik/facts-day.json geçersiz")
    br = load("kulaklik/bot-responses-week.json")
    if (len(br), sum(r["flagged"] for r in br), sum(r["purpose"] == "degraded" for r in br),
            sum(r["schema_valid"] is False for r in br)) != (30, 4, 3, 2):
        fail("kulaklik/bot-responses-week.json: 30 satır; 4 flagged, 3 degraded, 2 schema_valid=false")
    qr = load("kulaklik/questions-review.json")
    st = [x["status"] for x in qr]
    if (len(qr), st.count("approved"), st.count("rejected"), st.count("pending_review")) != (12, 8, 3, 1) or any(
            x["status"] == "rejected" and not x["review_note"] for x in qr) or any(x["source"] != "llm" for x in qr):
        fail("kulaklik/questions-review.json: 12 llm sorusu (8/3/1, ret nedenli)")
    ch = load("kulaklik/chats.json")
    if len(ch) != 2 or any(c["bot_is_admin"] for c in ch) or len({c["chat_id"] for c in ch}) != 2:
        fail("kulaklik/chats.json: 2 grup, bot_is_admin=false")
    lm = load("kulaklik/lesson-morale.json")
    talk = [c for c in lm["lesson_claims"] if c["kind"] == "talk" and c["status"] == "approved"
            and c["value"]["morale"] == "low"]
    if len(talk) != 3 or [f["morale_signal"] for f in lm["memory_facts"]] != [-2, -2, -2]:
        fail("kulaklik/lesson-morale.json: 3 onaylı talk.morale='low' + 3 morale_signal=-2 olgu")
    by_analysis = {c["analysis_id"]: c for c in talk}
    calls = load("kulaklik/llm-calls-month.json")
    call_cost = {c["ref_id"]: c["cost_usd"] for c in calls if c["purpose"] == "lesson_analysis"}
    for a in lm["lesson_analyses"]:
        e = errs("lesson-analysis", a.get("analysis"))
        claim = by_analysis.get(a["id"])
        if e or not isinstance(a.get("seed_profile"), dict) or claim is None:
            fail(f"kulaklik/lesson-morale.json: analiz {a['id']} eksik (analysis/seed_profile/talk claim) {e[:2]}")
            continue
        an = a["analysis"]
        if an["talk"]["morale"] != claim["value"]["morale"] or an["lesson_ref"] != a["lesson_id"]:
            fail(f"kulaklik/lesson-morale.json: analiz {a['id']} talk/lesson_ref claim ile tutarsız")
        if a["cost_usd"] != an["model_notes"]["cost_usd"] or a["lesson_id"] in call_cost and (
                call_cost[a["lesson_id"]] != a["cost_usd"]):
            fail(f"kulaklik/lesson-morale.json: analiz {a['id']} maliyeti llm_calls/model_notes ile aynı değil")
    if pii_leaks([a["analysis"] for a in lm["lesson_analyses"]]) or pii_leaks([f["text"] for f in lm["memory_facts"]]):
        fail("kulaklik/lesson-morale.json: temizlenmemiş metin")
    for f in load("kulaklik/memory-facts.json"):
        if pii_leaks(f["text"]):
            fail(f"kulaklik/memory-facts.json: olgu {f['id']} temizlenmemiş")
    chat = round(sum(c["cost_usd"] for c in calls if c["purpose"] == "chat"), 6)
    les = round(sum(c["cost_usd"] for c in calls if c["purpose"] == "lesson_analysis"), 6)
    if (chat, les) != (3.0, 0.9):
        fail(f"kulaklik/llm-calls-month.json: sohbet 3,00 $ ve ders 0,90 $ bekleniyor ({chat}, {les})")


def main() -> int:
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    check_parse()
    check_llm()
    check_contract_files()
    check_seed()
    check_kulaklik()
    if errors:
        print("FAIL:\n  " + "\n  ".join(errors), file=sys.stderr)
        return 1
    n = len(list(FIX.rglob("*.json")))
    print(f"OK: {n} JSON fixture denetlendi")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
