"""Dev-seed sohbet dünyası: 40 mesaj, 12 hafıza olgusu, 30 bot cevabı, llm_calls ve harcama defteri.

Mesaj metinleri `text_raw`; `text_llm` packages/pii temizleyicisiyle (sohbet üyelerinin ad-token
hash'leri + rol etiketleri) üretilir. Onaysız üyelerin (Zeynep: veli onayı yok, Barış: öğrenci satırı
yok) mesajlarında yalnız meta veri vardır (text_raw = text_llm = null).
"""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any

from fxlib import (
    BOT,
    CURRICULUM_ID,
    GROUP_A,
    STAFF,
    STUDENTS,
    UNCONSENTED,
    at,
    iso,
    name_token_hashes,
    scrub,
    sha256_hex,
    uid,
)

PRICES = {"gemini-2.5-flash-lite": (0.10, 0.40), "gemini-2.5-flash-lite@free": (0.0, 0.0),
          "llama-3.3-70b-versatile": (0.0, 0.0)}
PROVIDER = {"gemini-2.5-flash-lite": "gemini-paid", "gemini-2.5-flash-lite@free": "gemini-free",
            "llama-3.3-70b-versatile": "groq"}


def cost(model: str, tin: int, tout: int) -> float:
    pi, po = PRICES[model]
    return round(tin * pi / 1e6 + tout * po / 1e6, 6)


def scrub_for(sender: str | None, text: str) -> tuple[str, int]:
    """Worker girişi: sohbet üyelerinin hash'leri; gönderen öğrenci → [ÖĞRENCİ], personel → [EĞİTMEN],
    veli → [VELİ], diğer bilinen adlar → [AD]."""
    names: list[str] = []
    roles: dict[str, str] = {}
    for k, s in STUDENTS.items():
        hs = name_token_hashes(f"{s['first']} {s['last']}")
        names.extend(hs)
        if k == sender:
            roles.update({h: "ÖĞRENCİ" for h in hs})
            if s["guardian_name"]:
                roles.update({h: "VELİ" for h in name_token_hashes(s["guardian_name"].split(" ")[0])})
        elif s["guardian_name"]:
            names.extend(name_token_hashes(s["guardian_name"]))
    for st in STAFF.values():
        roles.update({h: "EĞİTMEN" for h in name_token_hashes(st["full_name"])})
    r = scrub(text, {"nameHashes": names, "roleHashes": roles})
    return r["text"], sum(x["count"] for x in r["replacements"])


# (anahtar, gönderen, sohbet, metin|None, zaman, yanıtlanan anahtar|None, soru mu, bot etiketlendi mi)
# gönderen: öğrenci anahtarı | 'inst' | 'bot' | 'baris'
M: list[tuple[str, str, int | str, str | None, datetime, str | None, bool | None, bool]] = [
    ("e1", "elif", "elif", "Merhaba, rasyonel sayılarda toplama konusunu tekrar etmek istiyorum.", at(14, 19, 5), None, False, False),
    ("e2", "bot", "elif", "Tabii. Paydaları farklı iki kesri toplarken ilk adımın ne olurdu?", at(14, 19, 5), None, None, False),
    ("e3", "elif", "elif", "Paydaları eşitlemek sanırım, kısa adımlarla gidersek daha iyi anlıyorum.", at(14, 19, 7), None, False, False),
    ("e4", "bot", "elif", "Evet. `1/4 + 1/2` için ortak payda kaç olur?", at(14, 19, 7), None, None, False),
    ("g1", "bot", "group", "Bu gruptaki mesajlar Öğrenmen tarafından kaydedilir ve 90 gün sonra silinir. Öğrenmen bir yapay zekâ öğretmenidir; hocalar da bu grupta. Ayrıntı: /gizlilik", at(14, 20, 0), None, None, False),
    ("m1", "mert", "mert", "Üslü ifadelerde 2^3 · 2^4 neden 2^7 oluyor?", at(15, 18, 20), None, True, False),
    ("m2", "bot", "mert", "Aynı tabanlı çarpımda üslere ne oluyor sence? `2^3`'ü açık yazarak dene, kaç tane 2 var?", at(15, 18, 20), None, None, False),
    ("z1", "zeynep", "zeynep", None, at(16, 17, 0), None, None, False),
    ("z2", "bot", "zeynep", "Velinin onayı gerekiyor. Koordinatörden aldığın kodu velin kendi Telegram hesabından `/veli KOD` ile girebilir ya da sana gönderilen bağlantıyı açabilir.", at(16, 17, 0), None, None, False),
    ("g2", "inst", "group", "Arkadaşlar, rasyonel sayılar ödevi Cuma günü teslim.", at(16, 19, 30), None, False, False),
    ("g3", "elif", "group", "@ogrenmen_bot 0,045 · 100 kaç eder?", at(17, 20, 5), None, True, True),
    ("g4", "bot", "group", "Virgül 100 ile çarparken kaç basamak kayar sence? Önce `0,045 · 10` deneyelim mi?", at(17, 20, 5), "g3", None, False),
    ("z3", "zeynep", "zeynep", None, at(18, 16, 40), None, None, False),
    ("g5", "mert", "group", "Yarın deneme sınavı saat kaçta başlıyor?", at(18, 19, 0), None, True, False),
    ("g6", "baris", "group", None, at(18, 19, 20), None, None, False),
    ("g7", "elif", "group", "@hoca mutlak değerde iki durumu anlamadım", at(18, 19, 45), None, True, False),
    ("e5", "elif", "elif", "Cuma günü deneme sınavı var, ona kadar kesirleri bitirmem lazım.", at(18, 20, 10), None, False, False),
    ("e6", "bot", "elif", "Güzel bir hedef. Bugün `3/4 + 1/8` ile başlayalım mı?", at(18, 20, 10), None, None, False),
    ("e7", "elif", "elif", "3/4 + 1/8 kaç oluyor? Paydaları ayrı toplayınca 4/12 buldum.", at(18, 20, 12), None, True, False),
    ("e8", "bot", "elif", "✕ Tekrar dene. Paylar ve paydalar ayrı ayrı toplanmaz. `3/4`'ü sekizde kaç olarak yazabilirsin?", at(18, 20, 12), None, None, False),
    ("e9", "elif", "elif", "6/8 + 1/8 = 7/8 mi?", at(18, 20, 14), None, True, False),
    ("e10", "bot", "elif", "✓ Doğru. Paydalar eşitlenince yalnız paylar toplanır. Bir tane de sen dener misin?", at(18, 20, 14), None, None, False),
    ("g8", "inst", "group", "İçerideki ifade pozitif de negatif de olabilir; iki denklem kur, yarın derste bakarız.", at(18, 20, 30), "g7", False, False),
    ("e11", "elif", "elif", "Bugün biraz yorgunum ama yarın akşam 10 soru çözeceğim.", at(18, 20, 30), None, False, False),
    ("e12", "bot", "elif", "Anlaşıldı, yarın akşam 10 soruyla devam ederiz. Hazır olunca /test yazabilir misin?", at(18, 20, 31), None, None, False),
    ("m3", "mert", "mert", "Matematik ödevini pazartesiye kadar teslim etmem lazım.", at(18, 21, 0), None, False, False),
    ("m4", "mert", "mert", "Bu hafta notum kaç oldu?", at(18, 21, 2), None, True, False),
    ("m5", "bot", "mert", "Bunu hocan söyleyebilir; sorunu ona ilettim.", at(18, 21, 2), None, None, False),
    ("m6", "mert", "mert", "Kesirlerde hâlâ paydaları ayrı ayrı topluyorum, bir türlü oturmadı.", at(18, 21, 15), None, False, False),
    ("m7", "bot", "mert", "Bunu birlikte düzeltebiliriz. `1/2 + 1/3` için önce hangi sayıyı ortak payda seçersin?", at(18, 21, 15), None, None, False),
    ("g9", "zeynep", "group", None, at(19, 10, 0), None, None, False),
    ("g10", "mert", "group", "Mutlak değer sorusunu ben de çözemedim, |x - 2| = 5 nasıl çözülüyor?", at(19, 18, 0), None, True, False),
    ("g11", "inst", "group", "İki durum: x - 2 = 5 ya da x - 2 = -5. Sonuçları kontrol et.", at(19, 18, 30), "g10", False, False),
    ("e13", "elif", "elif", "Dün söz verdiğim 10 soruyu çözdüm, 8'i doğru.", at(19, 19, 0), None, False, False),
    ("e14", "bot", "elif", "Emeğine sağlık. Yanlış yaptığın iki soruda ortak bir şey var mıydı?", at(19, 19, 0), None, None, False),
    ("e15", "elif", "elif", "İkisi de negatif sayılarla ilgiliydi.", at(19, 19, 3), None, False, False),
    ("e16", "bot", "elif", "O zaman işaret kurallarına bakalım. `-3 · (-4)` sonucu pozitif mi negatif mi?", at(19, 19, 3), None, None, False),
    ("m8", "mert", "mert", "Ben Mert, annem Fatma Hanım onay formunu imzaladı.", at(19, 21, 0), None, False, False),
    ("m9", "bot", "mert", "Teşekkürler, onayın kayıtlı. Bugün hangi konuya bakalım?", at(19, 21, 0), None, None, False),
    ("m10", "mert", "mert", "Oran orantıya bakalım, ters orantıyı karıştırıyorum.", at(19, 21, 5), None, False, False),
]

ANSWERED = {"e7": "e8", "e9": "e10", "m1": "m2", "g3": "g4", "g7": "g8", "g10": "g11"}


def chat_id(chat: int | str) -> int:
    if chat == "group":
        return GROUP_A
    return STUDENTS[str(chat)]["tg"]


def messages() -> tuple[list[dict[str, Any]], dict[str, dict[str, Any]]]:
    rows: list[dict[str, Any]] = []
    by_key: dict[str, dict[str, Any]] = {}
    tg_counter: dict[int, int] = {}
    order = sorted(range(len(M)), key=lambda i: (M[i][4], i))
    sent_by_key = {m[0]: m[4] for m in M}
    for new_id, i in enumerate(order, start=1):
        key, sender, chat, text, sent, reply_key, is_q, mention = M[i]
        cid = chat_id(chat)
        # grupta kayıt bildirimi telegram_message_id=2 (1 = gruba ekleme servis mesajı)
        tg_counter[cid] = tg_counter.get(cid, 1 if cid == GROUP_A else 0) + 1
        if sender == "bot":
            role, sid, staff_id = "bot", None, None
            if chat != "group":
                sid = STUDENTS[str(chat)]["id"]
        elif sender == "inst":
            role, sid, staff_id = "instructor", None, STAFF["inst"]["id"]
        elif sender == "baris":
            role, sid, staff_id = "student", None, None
        else:
            role, sid, staff_id = "student", STUDENTS[sender]["id"], None
        consented = sender not in ("zeynep", "baris")
        text_raw = text if consented else None
        llm_src = text_raw.replace("@" + BOT["username"], "").strip() if text_raw else None
        text_llm, n_pii = (scrub_for(sender if sender in STUDENTS else None, llm_src) if llm_src else (None, 0))
        if sender == "bot":
            text_llm, n_pii = text, 0
        answered_at = None
        if key in ANSWERED:
            answered_at = iso(sent_by_key[ANSWERED[key]] + timedelta(seconds=30))
        retention = 90
        row = {
            "id": new_id, "chat_id": cid, "telegram_message_id": tg_counter[cid], "sender_role": role,
            "student_id": sid, "staff_id": staff_id, "reply_to_telegram_message_id": None,
            "text_raw": text_raw, "text_llm": text_llm,
            "attachments": [],
            "mentions_bot": mention, "is_question": is_q if consented else None, "answered_at": answered_at,
            "sent_at": iso(sent), "expires_at": iso(sent + timedelta(days=retention)), "created_at": iso(sent),
        }
        if not consented:
            row["attachments"] = [{"kind": "meta_only", "length": 38 if key != "g6" else 51}]
        rows.append(row)
        by_key[key] = row
        row["_key"] = key
        row["_pii"] = n_pii
    for key, _sender, _chat, _text, _sent, reply_key, *_ in M:
        if reply_key:
            by_key[key]["reply_to_telegram_message_id"] = by_key[reply_key]["telegram_message_id"]
    return rows, by_key


def memory_facts(by_key: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
    e, mt = STUDENTS["elif"], STUDENTS["mert"]
    spec = [
        (e, "promise", "Öğrenci ertesi akşam 10 soru çözeceğine söz verdi.", ["e11"], 0.8, "2026-10-19", None, False, False, None),
        (e, "deadline", "Öğrencinin Cuma günü deneme sınavı var.", ["e5"], 0.85, "2026-10-23", None, False, False, None),
        (e, "morale", "Öğrenci yorgun olduğunu söyledi ama çalışmaya devam etmek istiyor.", ["e11"], 0.7, None, -1, False, False, None),
        (e, "topic_asked", "Öğrenci rasyonel sayılarda toplamayı sordu; payları ve paydaları ayrı topladı.", ["e7", "e9"], 0.9, None, None, False, False, "temel.rasyonel-sayilar"),
        (e, "preference", "Öğrenci kısa adımlarla ilerlemeyi tercih ediyor.", ["e3"], 0.7, None, None, False, False, None),
        (e, "instructor_fact", "Eğitmen rasyonel sayılar ödevinin Cuma günü teslim edileceğini duyurdu: Ödev teslimi Cuma.", ["g2"], 0.9, "2026-10-23", None, True, True, None),
        (mt, "deadline", "Öğrencinin matematik ödevini pazartesiye kadar teslim etmesi gerekiyor.", ["m3"], 0.8, "2026-10-26", None, False, False, None),
        (mt, "unanswered_question", "Öğrenci deneme sınavının saatini sordu; henüz cevap verilmedi.", ["g5"], 0.75, None, None, False, False, None),
        (mt, "morale", "Öğrenci kesirlerde zorlandığını ve konunun oturmadığını söyledi.", ["m6"], 0.7, None, -1, False, False, "temel.rasyonel-sayilar"),
        (mt, "instructor_fact", "Eğitmen rasyonel sayılar ödevinin Cuma günü teslim edileceğini duyurdu.", ["g2"], 0.9, "2026-10-23", None, True, False, None),
        (mt, "topic_asked", "Öğrenci üslü ifadelerde aynı tabanlı çarpımı sordu.", ["m1"], 0.85, None, None, False, False, "temel.uslu"),
        (mt, "topic_asked", "Öğrenci ters orantıyı karıştırdığını söyledi.", ["m10"], 0.8, None, None, False, False, "cebir.oran-oranti"),
    ]
    rows = []
    for i, (s, kind, text, src, conf, until, morale, req, appr, _skill) in enumerate(spec, start=1):
        src_rows = [by_key[k] for k in src]
        created = max(r["sent_at"] for r in src_rows)
        rows.append({
            "id": i, "student_id": s["id"], "kind": kind, "text": text,
            "source_message_ids": [r["id"] for r in src_rows], "source_lesson_claim_id": None, "confidence": conf,
            "requires_approval": req, "approved": appr, "approved_by": STAFF["inst"]["id"] if appr else None,
            "valid_from": created[:10], "valid_until": until, "morale_signal": morale, "status": "active",
            "embedding": None, "model": "gemini-2.5-flash-lite", "cost_usd": 0.00002,
            "created_at": iso(datetime.fromisoformat(created.replace("Z", "+00:00")).replace(hour=0, minute=40)
                              + timedelta(days=1)),
        })
    return rows


DEGRADED_TEXT = "Şu an yanıt veremiyorum; birkaç dakika sonra tekrar dene. Acilse hocanı etiketleyebilirsin."
UNSURE_TEXT = "Bundan emin değilim; hocana soralım."


def bot_responses(by_key: dict[str, dict[str, Any]], pool_ids: dict[str, str]) -> list[dict[str, Any]]:
    """30 satır (13–19 Ekim haftası, review_week 2026-10-13): 4 işaretli, 3 degraded, 2 schema_valid=false."""
    e, mt, z = STUDENTS["elif"], STUDENTS["mert"], STUDENTS["zeynep"]
    rows: list[dict[str, Any]] = []

    def add(purpose: str, student: dict | None, chat: int, text: str, when: str, *, in_key: str | None = None,
            out_key: str | None = None, llm: bool = False, model: str = "gemini-2.5-flash-lite", tin: int = 1780,
            tout: int = 150, attempts: list[dict] | None = None, confidence: float | None = None,
            escalated: bool = False, schema_valid: bool | None = None, flagged: str | None = None,
            cache_hit: bool = False, pool: str | None = None, guards: list[str] | None = None,
            degraded: bool = False, memory: list[int] | None = None, recent: list[int] | None = None,
            mode: str | None = "socratic", quota: dict | None = None, pii: int = 0) -> None:
        rid = len(rows) + 1
        in_row = by_key[in_key] if in_key else None
        prompt_text = None
        prompt_hash = None
        prompt_version = None
        if llm:
            prompt_version = "socratic.v3" if chat > 0 else "group.v1"
            student_line = in_row["text_llm"] if in_row else "(birleştirilmiş mesaj)"
            prompt_text = (f"[{prompt_version}] Sen Öğrenmen'sin: easy'nin yapay zekâ öğretmeni.\n"
                           f"BAĞLAM: Mod: {mode}. İpucu düzeyi: 0. Kazanım profili: henüz ölçülmedi.\n"
                           f"Hafıza: {memory or []}. Son mesajlar: {recent or []}.\nÖğrenci: {student_line}")
            prompt_hash = sha256_hex(prompt_text)
        if attempts is None:
            attempts = []
            if llm:
                attempts = [{"provider": PROVIDER[model], "model": model, "status": "ok", "tokens_in": tin,
                             "tokens_out": tout, "cost_usd": cost(model, tin, tout), "latency_ms": 900 + 37 * rid,
                             "error_code": None}]
        total = round(sum(a.get("cost_usd", 0) for a in attempts), 6)
        ok = [a for a in attempts if a["status"] == "ok"]
        rows.append({
            "id": rid, "in_message_id": in_row["id"] if in_row else None, "chat_id": chat,
            "student_id": student["id"] if student else None,
            "out_telegram_message_id": by_key[out_key]["telegram_message_id"] if out_key else 5000 + rid,
            "purpose": purpose, "mode": mode if purpose in ("chat", "hint") else None,
            "prompt_version": prompt_version, "prompt_hash": prompt_hash, "prompt_text": prompt_text,
            "response_text": text, "memory_fact_ids": memory or [], "recent_message_ids": recent or [],
            "pool_id": pool, "cache_hit": cache_hit,
            "provider": ok[-1]["provider"] if ok else None, "model": ok[-1]["model"] if ok else None,
            "provider_attempts": attempts,
            "tokens_in": sum(a.get("tokens_in", 0) for a in attempts) if attempts else None,
            "tokens_out": sum(a.get("tokens_out", 0) for a in attempts) if attempts else None,
            "cost_usd": total, "latency_ms": sum(a.get("latency_ms", 0) for a in attempts) + 120,
            "confidence": confidence, "escalated": escalated, "schema_valid": schema_valid,
            "quota_state": quota or {}, "degraded_mode": degraded, "pii_replacements": pii,
            "flagged": flagged is not None, "flagged_by": STAFF["inst"]["id"] if flagged else None,
            "flag_reason": flagged, "flagged_at": "2026-10-19T12:00:00Z" if flagged else None,
            "review_week": "2026-10-13", "created_at": when, "guards": guards or [],
        })

    def t(key: str) -> str:
        return by_key[key]["sent_at"]

    ec, mc, zc = e["tg"], mt["tg"], z["tg"]
    add("chat", e, ec, by_key["e2"]["text_raw"], t("e2"), in_key="e1", out_key="e2", llm=True, confidence=0.88,
        schema_valid=True, quota={"used": 1, "limit": 25})
    add("chat", e, ec, by_key["e4"]["text_raw"], t("e4"), in_key="e3", out_key="e4", llm=True, confidence=0.9,
        schema_valid=True, recent=[by_key["e1"]["id"], by_key["e2"]["id"]], quota={"used": 2, "limit": 25})
    add("command", None, GROUP_A, by_key["g1"]["text_raw"], t("g1"), out_key="g1", mode=None)
    add("chat", mt, mc, by_key["m2"]["text_raw"], t("m2"), in_key="m1", out_key="m2", llm=True, confidence=0.86,
        schema_valid=True, quota={"used": 1, "limit": 25})
    add("consent", z, zc, by_key["z2"]["text_raw"], t("z2"), in_key="z1", out_key="z2", mode=None,
        guards=["consent_missing"])
    add("chat", e, GROUP_A, by_key["g4"]["text_raw"], t("g4"), in_key="g3", out_key="g4", llm=True, confidence=0.84,
        schema_valid=True, quota={"used": 3, "limit": 25}, flagged="Grupta cevabı fazla yönlendirdi")
    add("chat", e, ec, by_key["e6"]["text_raw"], t("e6"), in_key="e5", out_key="e6", llm=True, confidence=0.82,
        schema_valid=True, quota={"used": 4, "limit": 25})
    add("chat", e, ec, by_key["e8"]["text_raw"], t("e8"), in_key="e7", out_key="e8", llm=True, confidence=0.91,
        schema_valid=True, memory=[5], recent=[by_key["e5"]["id"], by_key["e6"]["id"]],
        quota={"used": 5, "limit": 25})
    add("chat", e, ec, by_key["e10"]["text_raw"], t("e10"), in_key="e9", out_key="e10", llm=False, cache_hit=True,
        pool=pool_ids["feedback_right"], confidence=None, schema_valid=None, quota={"used": 6, "limit": 25})
    add("chat", e, ec, by_key["e12"]["text_raw"], t("e12"), in_key="e11", out_key="e12", llm=True, confidence=0.8,
        schema_valid=True, quota={"used": 7, "limit": 25})
    add("escalation", mt, mc, by_key["m5"]["text_raw"], t("m5"), in_key="m4", out_key="m5", mode=None,
        escalated=True, guards=["forbidden_topic"])
    add("chat", mt, mc, by_key["m7"]["text_raw"], t("m7"), in_key="m6", out_key="m7", llm=True, confidence=0.87,
        schema_valid=True, memory=[11], quota={"used": 3, "limit": 25}, flagged="Ön koşul ipucu eksik")
    add("chat", e, ec, by_key["e14"]["text_raw"], t("e14"), in_key="e13", out_key="e14", llm=True, confidence=0.83,
        schema_valid=True, memory=[1], quota={"used": 1, "limit": 25})
    add("chat", e, ec, by_key["e16"]["text_raw"], t("e16"), in_key="e15", out_key="e16", llm=True, confidence=0.86,
        schema_valid=True, quota={"used": 2, "limit": 25})
    add("chat", mt, mc, by_key["m9"]["text_raw"], t("m9"), in_key="m8", out_key="m9", llm=True, confidence=0.78,
        schema_valid=True, pii=2, quota={"used": 4, "limit": 25})
    # Mesaj tablosunda karşılığı olmayan (birleştirilmiş/komut) cevaplar
    add("command", e, ec, "Bugün 12/25 mesaj, 1/5 test kullandın. Yarın 00:00'da yenilenir.", "2026-10-19T17:10:00Z",
        mode=None)
    add("command", mt, mc, "Üslü ifadeler: henüz yeterli kanıt yok. Birkaç pratik sorusundan sonra yüzdeler görünecek.",
        "2026-10-19T17:20:00Z", mode=None)
    add("command", e, ec, "Tamam, bu soruda çözümü doğrudan göstereceğim.", "2026-10-19T17:25:00Z", mode=None)
    add("feedback", mt, mc, "✓ Doğru. Önce çarpma yapılır, sonra toplama.", "2026-10-15T15:02:00Z", mode=None)
    add("feedback", mt, mc, "✕ Tekrar dene. Paylar ve paydalar ayrı ayrı toplanmaz; önce paydaları eşitleyelim.",
        "2026-10-15T15:04:00Z", mode=None, pool=pool_ids["feedback_wrong"], cache_hit=True)
    add("feedback", mt, mc, "✕ Tekrar dene. En büyük ortak bölen küçüğü, EKOK büyüğü verir.", "2026-10-15T15:06:00Z",
        mode=None)
    add("quota", mt, mc, "Bugünlük mesaj hakkın doldu (25/25). Yarın 00:00'da yenilenir. Acil bir sorun varsa hocanı "
        "etiketleyebilirsin.", "2026-10-17T19:40:00Z", mode=None, guards=["quota"], quota={"used": 25, "limit": 25})
    rl = {"provider": "gemini-paid", "model": "gemini-2.5-flash-lite", "status": "rate_limited", "tokens_in": 0,
          "tokens_out": 0, "cost_usd": 0, "latency_ms": 310, "error_code": "429"}
    for i, when in enumerate(["2026-10-16T18:01:00Z", "2026-10-16T18:03:00Z", "2026-10-16T18:05:00Z"]):
        add("degraded", e if i != 1 else mt, ec if i != 1 else mc, DEGRADED_TEXT, when, mode=None, degraded=True,
            attempts=[dict(rl, latency_ms=310 + i),
                      {"provider": "gemini-free", "model": "gemini-2.5-flash-lite@free", "status": "cooldown_skip",
                       "tokens_in": 0, "tokens_out": 0, "cost_usd": 0, "latency_ms": 0, "error_code": None},
                      {"provider": "groq", "model": "llama-3.3-70b-versatile", "status": "timeout", "tokens_in": 0,
                       "tokens_out": 0, "cost_usd": 0, "latency_ms": 8000, "error_code": "timeout"}],
            escalated=True)
    bad = {"provider": "gemini-paid", "model": "gemini-2.5-flash-lite", "status": "bad_output", "tokens_in": 1790,
           "tokens_out": 180, "cost_usd": cost("gemini-2.5-flash-lite", 1790, 180), "latency_ms": 1100,
           "error_code": "schema"}
    for i, when in enumerate(["2026-10-17T18:30:00Z", "2026-10-18T18:45:00Z"]):
        add("chat", e if i == 0 else mt, ec if i == 0 else mc, UNSURE_TEXT, when, llm=True,
            attempts=[bad, dict(bad, latency_ms=1150)], schema_valid=False, escalated=True, confidence=None,
            guards=["unsure"])
    add("chat", e, ec, "Kesirleri karşılaştırırken önce paydaları eşitleyebilirsin. `2/3` ile `3/4`'ü on ikide nasıl "
        "yazarsın?", "2026-10-17T16:10:00Z", llm=True, confidence=0.9, schema_valid=True,
        flagged="Cevabı tek adımda verdi")
    add("hint", mt, mc, "İpucu: `2^3 = 2 · 2 · 2`. Şimdi `2^4`'ü de böyle yaz; toplam kaç tane 2 oldu?",
        "2026-10-17T17:05:00Z", llm=True, confidence=0.88, schema_valid=True)
    add("chat", e, ec, "Ondalık sayıyı 100 ile çarparken virgül iki basamak sağa gider. `0,045 · 100` kaç eder?",
        "2026-10-17T16:20:00Z", llm=True, model="gemini-2.5-flash-lite@free", confidence=0.82, schema_valid=True,
        flagged="Ücretsiz katmana düştü, metin kontrol edilmeli")
    for r in rows:
        r.pop("guards", None)
    return rows


def llm_calls_and_ledger(responses: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    refs = {s["id"]: s["ref"] for s in STUDENTS.values()}
    calls: list[dict[str, Any]] = []
    for r in responses:
        for a in r["provider_attempts"]:
            calls.append({
                "id": len(calls) + 1, "purpose": "chat", "provider": a["provider"], "model": a["model"],
                "tokens_in": a.get("tokens_in", 0), "tokens_out": a.get("tokens_out", 0), "audio_sec": None,
                "images": None, "batch": False, "status": a["status"], "error_code": a.get("error_code"),
                "latency_ms": a.get("latency_ms"), "cost_usd": a.get("cost_usd", 0), "ref_table": "bot_responses",
                "ref_id": str(r["id"]), "student_ref": refs.get(r["student_id"]), "created_at": r["created_at"],
            })
    # gece olgu çıkarımı (Batch) ve ders analizi satırları
    calls.append({"id": len(calls) + 1, "purpose": "nightly_facts", "provider": "gemini-paid",
                  "model": "gemini-2.5-flash-lite", "tokens_in": 2900, "tokens_out": 280, "audio_sec": None,
                  "images": None, "batch": True, "status": "ok", "error_code": None, "latency_ms": None,
                  "cost_usd": round((2900 * 0.10 / 1e6 + 280 * 0.40 / 1e6) * 0.5, 6), "ref_table": "memory_facts",
                  "ref_id": "1-6", "student_ref": STUDENTS["elif"]["ref"], "created_at": "2026-10-18T21:40:00Z"})
    calls.append({"id": len(calls) + 1, "purpose": "lesson_analysis", "provider": "gemini-paid",
                  "model": "gemini-2.5-pro", "tokens_in": 182000, "tokens_out": 2600, "audio_sec": None, "images": 8,
                  "batch": False, "status": "ok", "error_code": None, "latency_ms": 48000, "cost_usd": 0.2535,
                  "ref_table": "lessons", "ref_id": "00000000-0000-0000-0000-000000000001",
                  "student_ref": STUDENTS["elif"]["ref"], "created_at": "2026-10-19T17:30:00Z"})
    ledger: dict[tuple[str, str, str], dict[str, Any]] = {}
    for c in calls:
        dt = datetime.fromisoformat(c["created_at"].replace("Z", "+00:00")) + timedelta(hours=3)
        k = (dt.date().isoformat(), c["purpose"], c["provider"])
        row = ledger.setdefault(k, {"day": k[0], "purpose": k[1], "provider": k[2], "calls": 0, "tokens_in": 0,
                                    "tokens_out": 0, "cost_usd": 0.0})
        row["calls"] += 1
        row["tokens_in"] += c["tokens_in"]
        row["tokens_out"] += c["tokens_out"]
        row["cost_usd"] = round(row["cost_usd"] + c["cost_usd"], 6)
    return calls, sorted(ledger.values(), key=lambda r: (r["day"], r["purpose"], r["provider"]))


def chat_roles() -> list[dict[str, Any]]:
    rows = []
    for s in STUDENTS.values():
        rows.append({"chat_id": s["tg"], "telegram_user_id": s["tg"], "role": "student", "student_id": s["id"],
                     "staff_id": None, "mention_handle": None, "joined_at": "2026-10-10T12:00:00Z"})
        rows.append({"chat_id": GROUP_A, "telegram_user_id": s["tg"], "role": "student", "student_id": s["id"],
                     "staff_id": None, "mention_handle": None, "joined_at": "2026-10-14T17:00:00Z"})
    for key in ("inst", "coord"):
        st = STAFF[key]
        rows.append({"chat_id": GROUP_A, "telegram_user_id": st["tg"], "role": st["role"], "student_id": None,
                     "staff_id": st["id"], "mention_handle": st["mention"], "joined_at": "2026-10-14T17:00:00Z"})
    rows.append({"chat_id": GROUP_A, "telegram_user_id": BOT["id"], "role": "bot", "student_id": None,
                 "staff_id": None, "mention_handle": "@" + BOT["username"], "joined_at": "2026-10-14T17:00:00Z"})
    rows.append({"chat_id": GROUP_A, "telegram_user_id": UNCONSENTED["id"], "role": "student", "student_id": None,
                 "staff_id": None, "mention_handle": None, "joined_at": "2026-10-15T09:00:00Z"})
    return rows


__all__ = ["messages", "memory_facts", "bot_responses", "llm_calls_and_ledger", "chat_roles", "CURRICULUM_ID", "uid"]
