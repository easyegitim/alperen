"""Gece olgu çıkarımı (``facts``) ve eksik embedding doldurma (``reembed``) — BLUEPRINT §6.2.

``facts --day D``:

1. (CLI) ``reembed --missing`` ayrı adım olarak çalışır (``approve_lesson_analysis``'in embedding'siz yazdığı
   ödev/söz/moral olguları ve önceki gecelerin eksikleri).
2. ``D`` gününün (Europe/Istanbul) mesajları ``text_raw`` OLMADAN okunur. Yalnız ``text_llm``'i dolu mesajlar
   modele gider: onaysız öğrencinin (ve onaysız grup üyesinin) mesajında ``text_llm`` null'dır, bu öğrenciler için
   hiç çağrı yapılmaz (§12 #55). Her metin ``scrub_for_llm`` ile (ad-token hash'leriyle) bir kez daha temizlenir;
   istem numaralı mesaj listesidir ve ≤ 3.000 tokendir (fazlaysa en eski mesajlar atılır).
3. Zincir ``nightly_facts``, sözleşme ``nightly-facts-output``; ``--batch`` ile Gemini Batch (tek iş; gecikirse
   ``deferred`` → ``runtime_flags.facts_lag_days + 1``, eş zamanlı çağrıya düşülmez), aksi hâlde eş zamanlı.
4. Doğrulama: çıktının ``student_ref``/``day``'i istenenle aynı olmalı; her olgunun ``source_message_ids``'i
   boş olamaz ve yalnız istemde gönderilen o günün mesajlarından olabilir — olmayan olgu atılır. Olgu metni
   temizleyiciden geçer; yargı/tanı etiketi (``tembel``, ``depresif`` …) ya da ilke 10 kelimesi (``tahmin``,
   ``çıkacak``, ``kesin``, ``garanti``) taşıyan olgu atılır (``yargi_kelimesi``); ``memory-fact`` şemasıyla
   yeniden doğrulanır.
5. Embedding (768) → aynı öğrencide kosinüsü > 0.92 olan eski aktif olgu ``merged`` (§6.2; tür koşulu yok);
   ancak onay bekleyen yeni olgu (``requires_approval``) kullanılabilir (onaylı ya da onay gerektirmeyen) eski
   olguyu birleştirmez — eğitmenin onayladığı olgu, yenisi onaylanana kadar erişimden düşmesin. Yeni olgu
   ``memory_facts``'e yazılır (``requires_approval`` → ``approved=false``).
6. ``messages.is_question`` yalnız düzeltilir (girişte Worker sezgiseli yazmıştır); ``answered_at``
   ``answered_question_message_ids`` ile, istemdeki sonraki bot/eğitmen cevabının zamanıyla doldurulur (cevap
   satırı istemde yoksa yazılmaz — uydurma zaman yok); ``preferences.modality/explanation_notes`` güncellenir.
   ``messages`` güncellemesi ``RETURNING`` olmadan gider (``update_minimal``: ``batch_worker`` ``text_raw``'ı
   okuyamaz).
"""

from __future__ import annotations

import json
from collections.abc import Sequence
from dataclasses import dataclass, field
from datetime import date
from typing import Any

import ogrenmen_contracts as contracts
from ogrenmen_common.adapters.base import LLMRequest, is_null
from ogrenmen_common.batch import BatchItem
from ogrenmen_common.clock import iso, parse_ts
from ogrenmen_common.errors import LedgerError, RpcError
from ogrenmen_common.fakes.embedding import cosine, to_halfvec
from ogrenmen_common.fakes.llm import estimate_tokens
from ogrenmen_common.pii import scrub_for_llm

from .common import Students, day_window, flag, label_word, select_window, update_minimal

MAX_INPUT_TOKENS = 3000
MERGE_COSINE = 0.92
MESSAGE_COLUMNS = ("id", "chat_id", "telegram_message_id", "sender_role", "student_id", "staff_id",
                   "reply_to_telegram_message_id", "text_llm", "is_question", "answered_at", "sent_at")
"""``batch_worker`` sütun yetkisinin alt kümesi — ``text_raw`` yoktur ve istenmez."""
ROLE_LABEL = {"student": "öğrenci", "bot": "bot", "instructor": "eğitmen", "coordinator": "koordinatör",
              "observer": "gözlemci", "other": "diğer"}
STAFF_ROLES = ("instructor", "coordinator")

SYSTEM = (
    "Sen Öğrenmen'in gece hafıza çıkarıcısısın. Sana bir öğrencinin bir günlük, numaralı ve kişisel verisi "
    "temizlenmiş mesajları verilir. Yalnız nightly-facts-output şemasına uygun JSON döndür.\n"
    "Kurallar:\n"
    "- Her olgu üçüncü tekil ve isimsizdir: 'Öğrenci …', 'Eğitmen …'. Ad, okul, telefon yazma.\n"
    "- Her olgunun source_message_ids alanı en az bir mesaj numarası içerir ve yalnız listedeki numaraları kullanır.\n"
    "- Not, devamsızlık, puan ya da ödeme içeren olguda requires_approval=true; eğitmen beyanı instructor_fact "
    "ve requires_approval=true.\n"
    "- Moral için morale_signal −2…2 arası bir sayıdır; yargı ya da tanı etiketi kullanma.\n"
    "- is_question_message_ids: öğrencinin soru olan mesajları; answered_question_message_ids: cevap alanlar.\n"
    "- En çok 12 olgu; emin olmadığın olguyu yazma."
)


@dataclass
class FactsReport:
    day: str
    batch: bool
    batch_status: str = "done"
    students_seen: int = 0
    students_called: int = 0
    skipped_unconsented: list[str] = field(default_factory=list)
    skipped_trimmed_out: list[str] = field(default_factory=list)
    inserted: int = 0
    merged: int = 0
    dropped: list[dict] = field(default_factory=list)
    rejected_outputs: list[dict] = field(default_factory=list)
    is_question_fixed: int = 0
    answered_filled: int = 0
    answered_unresolved: int = 0
    preferences_updated: int = 0
    pii_replacements: int = 0
    trimmed_messages: int = 0
    facts_lag_days: int = 0
    errors: dict[str, str] = field(default_factory=dict)

    def as_dict(self) -> dict[str, Any]:
        return dict(self.__dict__)


@dataclass
class StudentDay:
    student_id: str
    ref: str
    lines: list[tuple[dict, str]]
    """(mesaj, temizlenmiş metin) — istemde giden sıra."""
    allowed: set[int]
    own: dict[int, dict]
    pii: int = 0
    trimmed: int = 0


def parse_vec(value: Any) -> list[float] | None:
    """``halfvec`` metni (``[0.1,…]``) ya da liste → float listesi."""
    if value is None:
        return None
    if isinstance(value, str):
        text = value.strip()
        if not text:
            return None
        return [float(x) for x in json.loads(text)]
    return [float(x) for x in value]


# --- reembed ------------------------------------------------------------------------------------


def reembed(rt: Any, *, missing: bool = True, limit: int | None = None) -> dict[str, Any]:
    """``memory_facts``'e embedding yazar. ``missing=True``: yalnız ``embedding is null and status='active'``;
    ``missing=False``: tüm aktif olgular (embedding modeli değiştiğinde). LLM çağrısı yoktur; her olgu bir
    embedding çağrısıdır (``llm_calls.purpose='embedding'``)."""
    where: dict[str, Any] = {"status": "active"}
    if missing:
        where["embedding"] = is_null()
    rows = rt.db.select("memory_facts", where=where, columns=("id", "student_id", "text"), order="id")
    if limit is not None:
        rows = rows[:limit]
    done: list[int] = []
    error = None
    for row in rows:
        try:
            vec = rt.embedding.embed([row["text"]])[0]
        except LedgerError as exc:
            error = exc.message
            break
        rt.db.update("memory_facts", {"embedding": to_halfvec(vec)}, where={"id": row["id"]})
        done.append(int(row["id"]))
    return {"mode": "missing" if missing else "all", "selected": len(rows), "embedded": len(done),
            "fact_ids": done, "error": error}


# --- facts --------------------------------------------------------------------------------------


def _student_days(rt: Any, day: date, students: Students, name_hashes: Sequence[str],
                  only_ref: str | None, report: FactsReport) -> list[StudentDay]:
    msgs = select_window(rt.db, "messages", "sent_at", day_window(day), columns=MESSAGE_COLUMNS)
    msgs.sort(key=lambda m: (parse_ts(m["sent_at"]), int(m["id"])))
    by_student: dict[str, list[dict]] = {}
    for m in msgs:
        if m.get("student_id") is not None:
            by_student.setdefault(str(m["student_id"]), []).append(m)
    out: list[StudentDay] = []
    for sid in sorted(by_student, key=lambda s: students.ref(s) or s):
        ref = students.ref(sid)
        if ref is None or students.status(sid) == "deleted":
            continue
        if only_ref is not None and ref != only_ref:
            continue
        report.students_seen += 1
        rows = by_student[sid]
        own_student = [m for m in rows if m.get("sender_role") == "student"]
        if not any(m.get("text_llm") for m in own_student):
            report.skipped_unconsented.append(ref)  # onaysız: text_llm null → modele hiç gitmez
            continue
        tg_ids = {(m["chat_id"], m.get("telegram_message_id")) for m in own_student}
        replies = [m for m in msgs if m.get("sender_role") in STAFF_ROLES and m.get("text_llm")
                   and (m["chat_id"], m.get("reply_to_telegram_message_id")) in tg_ids]
        context = [m for m in rows if m.get("text_llm")] + replies
        context.sort(key=lambda m: (parse_ts(m["sent_at"]), int(m["id"])))
        lines: list[tuple[dict, str]] = []
        pii = 0
        for m in context:
            cleaned = scrub_for_llm(str(m["text_llm"]), name_hashes)
            pii += cleaned.replacements
            lines.append((m, cleaned.text))
        sd = StudentDay(student_id=sid, ref=ref, lines=lines, allowed=set(), own={}, pii=pii)
        _trim(sd, day)
        sd.allowed = {int(m["id"]) for m, _ in sd.lines}
        sd.own = {int(m["id"]): m for m, _ in sd.lines if m.get("sender_role") == "student"}
        if not sd.own:
            report.skipped_trimmed_out.append(ref)  # token bütçesi öğrencinin tüm satırlarını attı
            continue
        out.append(sd)
    return out


def _line(m: dict, text: str) -> str:
    return f"[#{m['id']}] {ROLE_LABEL.get(str(m.get('sender_role')), 'diğer')}: {text}"


def build_prompt(sd: StudentDay, day: date) -> str:
    head = [f"Öğrenci: {sd.ref}", f"Gün: {day.isoformat()}", "Mesajlar (numara = messages.id):"]
    return "\n".join(head + [_line(m, t) for m, t in sd.lines])


def _trim(sd: StudentDay, day: date) -> None:
    """Girdi ≤ 3.000 token (sistem + istem); fazlaysa en eski mesajlar atılır."""
    while sd.lines and estimate_tokens(SYSTEM + "\n\n" + build_prompt(sd, day)) > MAX_INPUT_TOKENS:
        sd.lines.pop(0)
        sd.trimmed += 1


def _request(sd: StudentDay, day: date) -> LLMRequest:
    return LLMRequest(purpose="nightly_facts", model="", prompt=build_prompt(sd, day), system=SYSTEM,
                      schema_id="nightly-facts-output", max_tokens=1200, temperature=0.1)


def _clean_fact(fact: dict, sd: StudentDay, name_hashes: Sequence[str], report: FactsReport) -> dict | None:
    sources = fact.get("source_message_ids") or []
    if fact.get("student_ref") != sd.ref:
        report.dropped.append({"student_ref": sd.ref, "reason": "student_ref"})
        return None
    if not sources:
        report.dropped.append({"student_ref": sd.ref, "reason": "kaynaksız"})
        return None
    if not set(int(s) for s in sources) <= sd.allowed:
        report.dropped.append({"student_ref": sd.ref, "reason": "kaynak_gunun_mesaji_degil",
                               "source_message_ids": [int(s) for s in sources]})
        return None
    cleaned = scrub_for_llm(str(fact["text"]), name_hashes)
    fact = dict(fact, text=cleaned.text)
    report.pii_replacements += cleaned.replacements
    word = label_word(fact["text"])
    if word is not None:
        report.dropped.append({"student_ref": sd.ref, "reason": "yargi_kelimesi", "word": word})
        return None
    if fact.get("kind") == "instructor_fact":
        fact["requires_approval"] = True
    errs = contracts.errors("memory-fact", fact)
    if errs:
        report.dropped.append({"student_ref": sd.ref, "reason": "sema", "detail": str(errs[0].message)[:120]})
        return None
    return fact


def _apply_output(rt: Any, sd: StudentDay, day: date, data: dict, result: Any, name_hashes: Sequence[str],
                  report: FactsReport) -> None:
    if data.get("student_ref") != sd.ref or data.get("day") != day.isoformat():
        report.rejected_outputs.append({"student_ref": sd.ref, "reason": "öğrenci ya da gün uyuşmuyor",
                                        "got": {"student_ref": data.get("student_ref"), "day": data.get("day")}})
        return
    facts = [f for f in (_clean_fact(dict(x), sd, name_hashes, report) for x in data.get("facts") or []) if f]
    db = rt.db
    if facts:
        vectors = rt.embedding.embed([f["text"] for f in facts])
        existing = db.select("memory_facts", where={"student_id": sd.student_id, "status": "active"},
                             columns=("id", "kind", "embedding", "requires_approval", "approved"))
        old = [(e, parse_vec(e.get("embedding"))) for e in existing]
        share = round(float(result.cost_usd) / len(facts), 6)
        for fact, vec in zip(facts, vectors, strict=True):
            pending = bool(fact["requires_approval"])
            for row, ovec in old:
                if ovec is None or row.get("_merged"):
                    continue
                usable = not row.get("requires_approval") or bool(row.get("approved"))
                if pending and usable:
                    continue  # onay bekleyen olgu kullanılabilir olguyu erişimden düşürmez
                if cosine(vec, ovec) > MERGE_COSINE:
                    db.update("memory_facts", {"status": "merged"}, where={"id": row["id"]})
                    row["_merged"] = True
                    report.merged += 1
            db.insert("memory_facts", {
                "student_id": sd.student_id, "kind": fact["kind"], "text": fact["text"],
                "source_message_ids": [int(s) for s in fact["source_message_ids"]],
                "confidence": fact["confidence"], "requires_approval": bool(fact["requires_approval"]),
                "approved": False, "valid_from": day.isoformat(), "valid_until": fact.get("valid_until"),
                "morale_signal": fact.get("morale_signal"), "status": "active", "embedding": to_halfvec(vec),
                "model": result.model, "cost_usd": share,
            })
            report.inserted += 1
    _fix_messages(rt, sd, data, report)
    _preferences(rt, sd, data, name_hashes, report)


def _fix_messages(rt: Any, sd: StudentDay, data: dict, report: FactsReport) -> None:
    """``is_question`` yalnız düzeltilir; ``answered_at`` cevap verilen soru için doldurulur."""
    asked = {int(i) for i in data.get("is_question_message_ids") or []} & set(sd.own)
    answered = {int(i) for i in data.get("answered_question_message_ids") or []} & set(sd.own)
    later = [m for m, _ in sd.lines if m.get("sender_role") in ("bot", *STAFF_ROLES)]
    for mid, m in sorted(sd.own.items()):
        want = mid in asked
        if bool(m.get("is_question")) != want:
            update_minimal(rt.db, "messages", {"is_question": want}, where={"id": mid})
            report.is_question_fixed += 1
        if want and mid in answered and m.get("answered_at") is None:
            sent = parse_ts(m["sent_at"])
            reply = next((x for x in later if x["chat_id"] == m["chat_id"] and parse_ts(x["sent_at"]) >= sent
                          and int(x["id"]) != mid), None)
            if reply is None:
                report.answered_unresolved += 1  # cevap satırı istemde yok: zaman uydurulmaz
                continue
            update_minimal(rt.db, "messages", {"answered_at": reply["sent_at"]}, where={"id": mid})
            report.answered_filled += 1


def _preferences(rt: Any, sd: StudentDay, data: dict, name_hashes: Sequence[str], report: FactsReport) -> None:
    prefs = data.get("preferences") or {}
    values: dict[str, Any] = {}
    if prefs.get("modality"):
        values["modality"] = prefs["modality"]
    if prefs.get("explanation_notes"):
        notes = scrub_for_llm(str(prefs["explanation_notes"]), name_hashes).text[:200]
        word = label_word(notes)
        if word is None:
            values["explanation_notes"] = notes
        else:
            report.dropped.append({"student_ref": sd.ref, "reason": "yargi_kelimesi", "field": "explanation_notes",
                                   "word": word})
    if not values:
        return
    current = rt.db.select("preferences", where={"student_id": sd.student_id}, limit=1)
    if not current:
        return  # batch_worker preferences'a satır ekleyemez (§3.8 W: r u)
    changed = {k: v for k, v in values.items() if current[0].get(k) != v}
    if changed:
        changed["updated_at"] = iso(rt.clock())
        rt.db.update("preferences", changed, where={"student_id": sd.student_id})
        report.preferences_updated += 1


def _set_lag(rt: Any, value: int, report: FactsReport) -> None:
    report.facts_lag_days = value
    try:
        rt.db.rpc("set_runtime_flag", {"p_key": "facts_lag_days", "p_value": value})
    except RpcError as exc:
        report.errors["facts_lag_days"] = exc.message


def run_facts(rt: Any, day: date, *, batch: bool = False, name_hashes: Sequence[str] = (),
              student_ref: str | None = None, limit: int | None = None) -> FactsReport:
    report = FactsReport(day=day.isoformat(), batch=batch)
    students = Students.load(rt.db)
    days = _student_days(rt, day, students, name_hashes, student_ref, report)
    if limit is not None:
        days = days[:limit]
    for sd in days:
        report.pii_replacements += sd.pii
        report.trimmed_messages += sd.trimmed
    lag = int(flag(rt.db, "facts_lag_days", 0) or 0)
    results: dict[str, Any] = {}
    if batch:
        outcome = rt.batch.run("nightly_facts", [
            BatchItem(key=sd.ref, request=_request(sd, day), student_ref=sd.ref, ref_table="messages",
                      ref_id=",".join(str(i) for i in sorted(sd.allowed))) for sd in days],
            display_name=f"ogrenmen-nightly-facts-{day.isoformat()}")
        report.batch_status = outcome.status
        report.errors.update(outcome.errors)
        report.students_called = len(days)
        if outcome.status in ("deferred", "blocked"):
            _set_lag(rt, lag + 1, report)  # eş zamanlı çağrıya düşülmez (§12 #27)
            return report
        results = outcome.results
    else:
        for sd in days:
            report.students_called += 1
            try:
                results[sd.ref] = rt.ledger.call("nightly_facts", _request(sd, day), student_ref=sd.ref,
                                                 ref_table="messages",
                                                 ref_id=",".join(str(i) for i in sorted(sd.allowed)))
            except LedgerError as exc:
                report.errors[sd.ref] = exc.message
                if exc.code == "OGR-LLM-002":
                    report.batch_status = "blocked"
        if report.batch_status == "blocked":
            _set_lag(rt, lag + 1, report)
    for sd in days:
        res = results.get(sd.ref)
        if res is None or not isinstance(res.data, dict):
            continue
        _apply_output(rt, sd, day, res.data, res, name_hashes, report)
    if report.batch_status == "done":
        if lag:
            _set_lag(rt, 0, report)
        else:
            report.facts_lag_days = 0
    return report
