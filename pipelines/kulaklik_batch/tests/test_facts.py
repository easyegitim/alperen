"""Gece olgu çıkarımı: kaynak mesaj zorunluluğu, onaysız öğrenci, PII temizliği, birleştirme, düzeltmeler."""

from __future__ import annotations

import json
from datetime import date

import ogrenmen_contracts as contracts
from ogrenmen_common.adapters.base import LLMRequest, LLMResult
from ogrenmen_common.fakes.llm import estimate_tokens
from ogrenmen_pii import name_token_hashes

from conftest import KULAKLIK, REF_A, REF_B, REF_C, STUDENT_A, make_rt, read_jsonl, run_cli
from ogrenmen_kulaklik import facts as F
from ogrenmen_kulaklik.fixture_llm import install

DAY = date(2026, 10, 18)


class ScriptedLLM:
    """``nightly_facts`` için verilen yanıtı döndürür ve istemleri kaydeder (sözleşme dışı yanıt da verilebilir)."""

    def __init__(self, outputs):
        self.outputs = outputs
        self.prompts: list[str] = []

    def complete(self, request: LLMRequest) -> LLMResult:
        self.prompts.append(request.prompt_text)
        ref = next(line.split(": ", 1)[1] for line in request.prompt.splitlines() if line.startswith("Öğrenci: "))
        data = self.outputs[ref]
        text = json.dumps(data, ensure_ascii=False)
        return LLMResult(ok=True, text=text, json=data, tokens_in=estimate_tokens(request.prompt_text),
                         tokens_out=estimate_tokens(text))


def fact(ref, kind, text, sources, **extra):
    base = {"schema_version": "1.0", "student_ref": ref, "kind": kind, "text": text, "source_message_ids": sources,
            "confidence": 0.8, "valid_until": None, "morale_signal": None, "requires_approval": False, "skill_id": None}
    base.update(extra)
    return base


def output(ref, facts, asked=(), answered=(), prefs=None):
    out = {"schema_version": "1.0", "day": DAY.isoformat(), "student_ref": ref, "facts": facts,
           "is_question_message_ids": list(asked), "answered_question_message_ids": list(answered)}
    if prefs:
        out["preferences"] = prefs
    return out


def use(rt, llm):
    rt.ledger.llm = llm
    rt.llm = llm
    return llm


def test_cli_facts_rows_all_have_source_message_ids(tmp_path):
    assert run_cli("facts", "--day", "2026-10-18", "--dry-run", "--fixtures", str(KULAKLIK),
                   "--out", str(tmp_path)) == 0
    rows = read_jsonl(tmp_path / "memory_facts.jsonl")
    assert rows
    assert all(len(r["source_message_ids"]) >= 1 for r in rows)
    new = [r for r in rows if r["status"] == "active"]
    assert len(new) == 8  # facts-day.json: 4 + 4 olgu
    day_ids = {int(m["id"]) for m in json.loads((KULAKLIK / "messages-day.json").read_text())}
    assert all(set(r["source_message_ids"]) <= day_ids for r in new)
    report = json.loads((tmp_path / "facts_report.json").read_text())
    assert report["skipped_unconsented"] == [REF_C]
    # reembed --missing ayrı adımdır: 12 + 3 embedding'siz olgu doldurulur, çıktısı out/reembed/
    assert report["reembed"]["embedded"] == 15
    assert (tmp_path / "reembed" / "memory_facts.jsonl").is_file()
    assert (tmp_path / "cost_estimate.json").is_file()


def test_requires_approval_facts_are_not_approved(tmp_path):
    run_cli("facts", "--day", "2026-10-18", "--dry-run", "--fixtures", str(KULAKLIK), "--out", str(tmp_path))
    rows = [r for r in read_jsonl(tmp_path / "memory_facts.jsonl") if r["status"] == "active"]
    gated = [r for r in rows if r["requires_approval"]]
    assert gated, "facts-day.json'da not sorusu olgusu requires_approval=true"
    assert all(r["approved"] is False for r in rows)


def test_unconsented_student_never_reaches_llm(tmp_path):
    rt = make_rt(tmp_path)
    rt.db.seed("messages", {"id": 900, "chat_id": 700000003, "telegram_message_id": 90, "sender_role": "student",
                            "student_id": "9d4d557b-6191-5018-b679-baf9dbacc67e", "text_llm": None,
                            "attachments": [], "is_question": True, "answered_at": None,
                            "sent_at": "2026-10-18T15:00:00Z", "expires_at": "2027-01-16T15:00:00Z"})
    wrapped = install(rt, KULAKLIK)
    report = F.run_facts(rt, DAY)
    called = [c.student_ref for c in wrapped.calls]
    assert sorted(called) == sorted([REF_A, REF_B])
    assert REF_C in report.skipped_unconsented
    for call in wrapped.calls:
        assert REF_C not in call.prompt_text
        assert "[#13]" not in call.prompt_text and "[#900]" not in call.prompt_text
        assert "[#15]" not in call.prompt_text  # onaysız grup üyesi (student_id null) da gitmez
    rt.close()


def test_prompt_is_pii_scrubbed_with_name_hashes(tmp_path):
    rt = make_rt(tmp_path)
    rt.db.seed("messages", {"id": 901, "chat_id": 700000001, "telegram_message_id": 91, "sender_role": "student",
                            "student_id": STUDENT_A, "attachments": [], "is_question": False, "answered_at": None,
                            "text_llm": "Elif burada, numaram 0532 123 45 67, e-posta elif@example.com",
                            "sent_at": "2026-10-18T17:40:00Z", "expires_at": "2027-01-16T17:40:00Z"})
    llm = use(rt, ScriptedLLM({
        REF_A: output(REF_A, [fact(REF_A, "other", "Öğrenci 0532 123 45 67 numarasını yazdı.", [901])]),
        REF_B: output(REF_B, []),
    }))
    hashes = name_token_hashes("Elif")
    report = F.run_facts(rt, DAY, name_hashes=hashes)
    prompt_a = next(p for p in llm.prompts if REF_A in p)
    assert "Elif" not in prompt_a and "0532" not in prompt_a and "elif@example.com" not in prompt_a
    assert "[TELEFON]" in prompt_a and "[E-POSTA]" in prompt_a
    stored = rt.db.select("memory_facts", where={"student_id": STUDENT_A, "kind": "other"})
    assert stored and "0532" not in stored[0]["text"] and "[TELEFON]" in stored[0]["text"]
    assert report.pii_replacements >= 3
    rt.close()


def test_fact_with_foreign_or_missing_source_is_dropped(tmp_path):
    rt = make_rt(tmp_path)
    use(rt, ScriptedLLM({
        REF_A: output(REF_A, [
            fact(REF_A, "promise", "Öğrenci yarın 10 soru çözeceğini söyledi.", [24]),
            fact(REF_A, "other", "Öğrenci başka bir günün mesajına dayanıyor.", [3]),   # günün mesajı değil
            fact(REF_A, "other", "Öğrenci B'nin mesajına dayanan olgu yazıldı.", [26]),  # başka öğrencinin mesajı
        ]),
        REF_B: output(REF_B, [fact(REF_B, "deadline", "Öğrencinin ödevi pazartesi teslim edilecek.", [26])]),
    }))
    report = F.run_facts(rt, DAY)
    assert report.inserted == 2
    assert {d["reason"] for d in report.dropped} == {"kaynak_gunun_mesaji_degil"}
    assert len(report.dropped) == 2
    rows = rt.db.written("memory_facts")
    assert all(r["source_message_ids"] for r in rows)
    rt.close()


def test_output_for_another_student_is_rejected(tmp_path):
    rt = make_rt(tmp_path)
    use(rt, ScriptedLLM({REF_A: output(REF_B, [fact(REF_B, "other", "Öğrenci başka biridir burada.", [26])]),
                         REF_B: output(REF_B, [])}))
    report = F.run_facts(rt, DAY)
    assert report.inserted == 0
    assert report.rejected_outputs and report.rejected_outputs[0]["student_ref"] == REF_A
    rt.close()


def test_merge_marks_similar_old_fact(tmp_path):
    rt = make_rt(tmp_path)
    F.reembed(rt, missing=True)  # eski olguların embedding'i (CLI'da ayrı adım)
    install(rt, KULAKLIK)
    report = F.run_facts(rt, DAY)
    old = rt.db.get("memory_facts", id=2)  # "Öğrencinin Cuma günü deneme sınavı var." (aynı metin → kosinüs 1)
    assert old["status"] == "merged"
    new = rt.db.select("memory_facts", where={"student_id": STUDENT_A, "status": "active",
                                               "text": "Öğrencinin Cuma günü deneme sınavı var."})
    assert len(new) == 1 and new[0]["id"] != 2 and new[0]["embedding"]
    assert report.merged >= 1
    # farklı türdeki olgu birleştirilmez: tercih olgusu (id 5) aktif kalır
    assert rt.db.get("memory_facts", id=5)["status"] == "active"
    rt.close()


def test_is_question_corrected_and_answered_filled(tmp_path):
    rt = make_rt(tmp_path)
    rt.db.role = "postgres"
    rt.db.update("messages", {"is_question": True}, where={"id": 17})   # sezgisel yanlış pozitif
    rt.db.update("messages", {"is_question": False, "answered_at": None}, where={"id": 21})  # yanlış negatif
    rt.db.role = "batch_worker"
    use(rt, ScriptedLLM({REF_A: output(REF_A, [], asked=[16, 19, 21], answered=[16, 19, 21]),
                         REF_B: output(REF_B, [], asked=[14, 27])}))
    report = F.run_facts(rt, DAY)
    assert rt.db.get("messages", id=17)["is_question"] is False
    m21 = rt.db.get("messages", id=21)
    bot_reply = rt.db.get("messages", id=22)  # 21'den sonraki ilk bot cevabı
    assert m21["is_question"] is True and m21["answered_at"] == bot_reply["sent_at"]
    assert report.is_question_fixed == 2 and report.answered_filled == 1
    rt.close()


def test_blocked_batch_increments_facts_lag(tmp_path):
    rt = make_rt(tmp_path)
    rt.db.role = "postgres"
    rt.db.update("runtime_flags", {"value": True}, where={"key": "degraded_mode"})
    rt.db.role = "batch_worker"
    install(rt, KULAKLIK)
    report = F.run_facts(rt, DAY, batch=True)
    assert report.batch_status == "blocked" and report.inserted == 0
    assert rt.db.get("runtime_flags", key="facts_lag_days")["value"] == 1
    assert all(c["status"] == "cap_blocked" for c in rt.ledger.calls if c["purpose"] == "nightly_facts")
    rt.close()


def test_batch_mode_uses_batch_pricing(tmp_path):
    rt = make_rt(tmp_path)
    install(rt, KULAKLIK)
    report = F.run_facts(rt, DAY, batch=True)
    assert report.batch_status == "done" and report.inserted == 8
    calls = [c for c in rt.ledger.calls if c["purpose"] == "nightly_facts"]
    assert calls and all(c["batch"] for c in calls)
    rt.close()


def test_stored_facts_satisfy_memory_fact_contract(tmp_path):
    rt = make_rt(tmp_path)
    install(rt, KULAKLIK)
    F.run_facts(rt, DAY)
    refs = {STUDENT_A: REF_A, "1da926ea-a047-5403-9644-bb047719707b": REF_B}
    for row in rt.db.written("memory_facts"):
        view = {"schema_version": "1.0", "student_ref": refs[row["student_id"]], "kind": row["kind"],
                "text": row["text"], "source_message_ids": row["source_message_ids"],
                "confidence": row["confidence"], "valid_until": row["valid_until"],
                "morale_signal": row["morale_signal"], "requires_approval": row["requires_approval"]}
        contracts.validate("memory-fact", view)
    rt.close()


def test_prompt_trimmed_to_token_budget(tmp_path, monkeypatch):
    rt = make_rt(tmp_path)
    monkeypatch.setattr(F, "MAX_INPUT_TOKENS", 330)
    wrapped = install(rt, KULAKLIK)
    report = F.run_facts(rt, DAY)
    assert report.trimmed_messages > 0
    for call in wrapped.calls:
        assert estimate_tokens(call.prompt_text) <= 330
    rt.close()


def test_judgement_and_prophecy_words_are_dropped(tmp_path):
    rt = make_rt(tmp_path)
    use(rt, ScriptedLLM({
        REF_A: output(REF_A, [
            fact(REF_A, "morale", "Öğrenci tembel davranıyor.", [24], morale_signal=-1),
            fact(REF_A, "other", "Öğrenci bu konunun sınavda kesin çıkacağını düşünüyor.", [24]),
            fact(REF_A, "promise", "Öğrenci yarın 10 soru çözeceğini söyledi.", [24]),
        ], prefs={"modality": "visual", "explanation_notes": "Tembel olduğu için kısa anlat"}),
        REF_B: output(REF_B, []),
    }))
    before = rt.db.get("preferences", student_id=STUDENT_A)
    report = F.run_facts(rt, DAY)
    assert report.inserted == 1
    dropped = [d for d in report.dropped if d["reason"] == "yargi_kelimesi"]
    assert {d.get("word") for d in dropped} >= {"tembel", "çıkacak"}
    assert any(d.get("field") == "explanation_notes" for d in dropped)
    texts = [r["text"] for r in rt.db.written("memory_facts")]
    assert texts == ["Öğrenci yarın 10 soru çözeceğini söyledi."]
    after = rt.db.get("preferences", student_id=STUDENT_A)
    assert after["explanation_notes"] == before["explanation_notes"]
    rt.close()


def test_merge_ignores_kind_but_keeps_approved_fact_for_pending_new_fact(tmp_path):
    rt = make_rt(tmp_path)
    rt.db.seed("memory_facts", [
        {"id": 600, "student_id": STUDENT_A, "kind": "other", "text": "Öğrenci her akşam 20 soru çözüyor.",
         "source_message_ids": [3], "requires_approval": False, "approved": False, "status": "active",
         "embedding": None, "created_at": "2026-10-10T00:00:00Z"},
        {"id": 601, "student_id": STUDENT_A, "kind": "instructor_fact", "text": "Eğitmen notu 75 olarak bildirdi.",
         "source_message_ids": [3], "requires_approval": True, "approved": True, "status": "active",
         "embedding": None, "created_at": "2026-10-10T00:00:00Z"},
    ])
    F.reembed(rt, missing=True)
    use(rt, ScriptedLLM({
        REF_A: output(REF_A, [
            fact(REF_A, "promise", "Öğrenci her akşam 20 soru çözüyor.", [24]),  # farklı tür, aynı metin
            fact(REF_A, "instructor_fact", "Eğitmen notu 75 olarak bildirdi.", [24], requires_approval=True),
        ]),
        REF_B: output(REF_B, []),
    }))
    report = F.run_facts(rt, DAY)
    assert rt.db.get("memory_facts", id=600)["status"] == "merged"  # §6.2: tür koşulu yok
    assert rt.db.get("memory_facts", id=601)["status"] == "active"  # onaylı olgu, onay bekleyen yeniyle düşmez
    assert report.inserted == 2 and report.merged == 1
    rt.close()


def test_answered_at_not_fabricated_without_reply(tmp_path):
    rt = make_rt(tmp_path)
    rt.db.seed("messages", {"id": 902, "chat_id": 700000001, "telegram_message_id": 92, "sender_role": "student",
                            "student_id": STUDENT_A, "attachments": [], "is_question": True, "answered_at": None,
                            "text_llm": "Son bir soru: kesirde sadeleştirme nasıl?",
                            "sent_at": "2026-10-18T20:50:00Z", "expires_at": "2027-01-16T20:50:00Z"})
    use(rt, ScriptedLLM({REF_A: output(REF_A, [], asked=[16, 19, 21, 902], answered=[902]),
                         REF_B: output(REF_B, [], asked=[14, 27])}))
    report = F.run_facts(rt, DAY)
    assert rt.db.get("messages", id=902)["answered_at"] is None
    assert report.answered_unresolved == 1 and report.answered_filled == 0
    rt.close()


def test_fully_trimmed_student_is_not_reported_as_unconsented(tmp_path, monkeypatch):
    rt = make_rt(tmp_path)
    monkeypatch.setattr(F, "MAX_INPUT_TOKENS", 10)
    wrapped = install(rt, KULAKLIK)
    report = F.run_facts(rt, DAY)
    assert report.skipped_unconsented == [REF_C]
    assert sorted(report.skipped_trimmed_out) == sorted([REF_A, REF_B])
    assert wrapped.calls == []
    rt.close()
