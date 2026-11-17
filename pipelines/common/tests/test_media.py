"""LLMVision/LLMOCR/LLMTranscriber (CostLedger üzerinden) ve sahte eşlenikleriyle tutarlılık."""

from __future__ import annotations

import json

import pytest

from conftest import FIXTURES
from ogrenmen_common.adapters.base import LLMRequest, LLMResult
from ogrenmen_common.adapters.media import (
    LLMOCR,
    LLMTranscriber,
    LLMVision,
    diarize_windows,
    transcript_or_unlabeled_errors,
)
from ogrenmen_common.errors import LedgerError
from ogrenmen_common.fakes import FakeLLM, FakeOCR, FakeTranscriber, FakeVision
from ogrenmen_common.ledger import CostLedger

WAV = FIXTURES / "ders" / "lesson-01.wav"


def test_llm_vision_equals_fake_vision(db, clock):
    ledger = CostLedger(db, FakeLLM(), clock=clock)
    args = {"stem": "Şekildeki 5/6 ve 1/4 kesirlerinin toplamı?", "stem_values": {"a": 5, "b": 6},
            "alt_text": "İki kesir modeli."}
    via_ledger = LLMVision(ledger).check_figure(b"\x89PNG", **args)
    assert via_ledger == FakeVision().check_figure(b"\x89PNG", **args)
    row = db.written("llm_calls")[-1]
    assert row["purpose"] == "vision_check" and row["images"] == 1 and row["ref_table"] == "figures"
    assert row["model"] == "gemini-2.5-flash@free" and row["cost_usd"] == 0  # ücretsiz katman


def test_llm_ocr_fills_source_meta_and_matches_fake(db, clock):
    meta = {"fixture_hint": "exam-2022", "source_id": "11111111-1111-4111-8111-111111111111", "year": 2022,
            "term": "final", "instructor_alias": "hoca-A"}
    items = LLMOCR(CostLedger(db, FakeLLM(), clock=clock)).extract_items([b"p1", b"p2", b"p3"], meta=meta)
    assert items == FakeOCR().extract_items([b"p1", b"p2", b"p3"], meta=meta)
    assert all(i["instructor_alias"] == "hoca-A" and i["source_id"] == meta["source_id"] for i in items)
    row = db.written("llm_calls")[-1]
    assert row["images"] == 3 and row["ref_id"] == meta["source_id"]


def test_llm_transcriber_on_fixture_wav(db, clock):
    t = LLMTranscriber(CostLedger(db, FakeLLM(), clock=clock)).transcribe(WAV)
    assert t == FakeTranscriber().transcribe(WAV)
    row = db.written("llm_calls")[-1]
    assert row["purpose"] == "transcribe" and row["audio_sec"] == 20 and row["ref_table"] == "lessons"


LABELS = json.loads((FIXTURES / "ders" / "labels.json").read_text(encoding="utf-8"))
NAME_HASHES = [row["hash"] for row in LABELS]
PLAIN = [{"t": "00:00:05", "t_end": "00:00:07", "text": "Paydaları eşitle."},
         {"t": "00:02:10", "t_end": "00:02:12", "text": "Tamam hocam."}]
NAMED = [{"t": "00:00:05", "t_end": "00:00:09", "text": "Elif, bugün kesirlerde toplamaya bakalım."},
         {"t": "00:00:40", "t_end": "00:00:44", "text": "Tamam hocam Ayşe, Elif'in sorusu da şu."},
         {"t": "00:02:10", "t_end": "00:02:14", "text": "Kaya ailesi ödevi gördü, hocam Yılmaz."},
         {"t": "00:02:30", "t_end": "00:02:33", "text": "Hocam Mehmet 3/4 + 1/8 kaç eder?"}]


class WhisperThenDiarize:
    """transcribe → etiketsiz Whisper çıktısı; diarize → etiketli pencere (gerçek zincir davranışı)."""

    def __init__(self, segments=PLAIN):
        self.segments = segments
        self.diarize_calls = 0
        self.diarize_prompts: list[str] = []

    def complete(self, req: LLMRequest) -> LLMResult:
        if req.purpose == "transcribe":
            if req.model != "whisper-large-v3-turbo":
                return LLMResult.failure("rate_limited", status=429)
            return LLMResult(ok=True, json={"segments": list(self.segments), "unlabeled": True}, audio_sec=140)
        self.diarize_calls += 1
        self.diarize_prompts.append(req.prompt_text)
        window = json.loads(req.prompt)["segments"]
        speaker = "EĞİTMEN" if self.diarize_calls == 1 else "ÖĞRENCİ"
        return LLMResult(ok=True, json={"segments": [{**s, "speaker": speaker} for s in window]}, tokens_in=50,
                         tokens_out=20)


def test_whisper_fallback_is_diarized_in_two_minute_windows(db, clock):
    llm = WhisperThenDiarize()
    t = LLMTranscriber(CostLedger(db, llm, clock=clock)).transcribe(WAV, labels=LABELS)
    assert [s["speaker"] for s in t["segments"]] == ["EĞİTMEN", "ÖĞRENCİ"] and llm.diarize_calls == 2
    statuses = [(r["purpose"], r["model"], r["status"]) for r in db.written("llm_calls")]
    assert statuses[0] == ("transcribe", "gemini-2.5-flash@free", "rate_limited")
    assert statuses[1] == ("transcribe", "whisper-large-v3-turbo", "ok")
    assert [s[0] for s in statuses[2:]] == ["diarize", "diarize"]
    whisper = db.written("llm_calls")[1]
    assert whisper["cost_usd"] == pytest.approx(0.04 * 140 / 3600, abs=1e-6)


def test_unlabeled_validator_and_windows():
    assert transcript_or_unlabeled_errors({"segments": [{"t": "00:00:01", "text": "x"}], "unlabeled": True}) == []
    assert transcript_or_unlabeled_errors({"segments": [{"text": "x"}], "unlabeled": True})
    assert transcript_or_unlabeled_errors({"segments": [{"t": "00:00:01", "text": "x"}]})  # konuşmacısız tam şema
    wins = diarize_windows([{"t": "00:00:01", "text": "a"}, {"t": "00:01:59", "text": "b"},
                            {"t": "00:02:00", "text": "c"}])
    assert [[s["text"] for s in w] for w in wins] == [["a", "b"], ["c"]]


def test_transcriber_failure_propagates(db, clock):
    class Down:
        def complete(self, req):
            return LLMResult.failure("server", status=503)

    with pytest.raises(LedgerError, match="OGR-LLM-001"):
        LLMTranscriber(CostLedger(db, Down(), clock=clock)).transcribe(WAV)


def test_whisper_text_is_scrubbed_before_diarize(db, clock):
    """§6.3/§9.1: Whisper'ın ham metni (öğrenci, eğitmen, veli adları) diarize modeline adsız gider."""
    from ogrenmen_common.pii import name_leaks

    llm = WhisperThenDiarize(NAMED)
    t = LLMTranscriber(CostLedger(db, llm, clock=clock)).transcribe(WAV, labels=LABELS, name_hashes=NAME_HASHES)
    assert llm.diarize_calls == 2 and llm.diarize_prompts
    sent = "\n".join(llm.diarize_prompts)
    assert name_leaks(sent, NAME_HASHES) == []
    for name in ("Elif", "Ayşe", "Kaya", "Yılmaz", "Mehmet"):  # Mehmet hash'te yok: "hocam X" kalıbı → [AD]
        assert name not in sent
    assert "[ÖĞRENCİ]" in sent and "[EĞİTMEN]" in sent and "Hocam [AD]" in sent
    assert "3/4 + 1/8" in sent  # matematik dokunulmaz
    assert all("Elif" not in seg["text"] for seg in t["segments"])


def test_whisper_labels_from_constructor_are_used(db, clock):
    llm = WhisperThenDiarize(NAMED)
    LLMTranscriber(CostLedger(db, llm, clock=clock), labels=LABELS).transcribe(WAV)
    assert llm.diarize_calls == 2 and all("Elif" not in p for p in llm.diarize_prompts)


def test_whisper_without_labels_or_hashes_refuses_to_send_text(db, clock):
    llm = WhisperThenDiarize(NAMED)
    with pytest.raises(LedgerError, match="ad temizliği"):
        LLMTranscriber(CostLedger(db, llm, clock=clock)).transcribe(WAV)
    assert llm.diarize_calls == 0  # ham metin hiçbir modele gitmedi
