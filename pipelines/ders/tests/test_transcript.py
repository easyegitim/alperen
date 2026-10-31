"""Transkript yolu: Gemini (etiketli) / Whisper (etiketsiz → temizlik → diarize) / whisper.cpp; JSONL sözleşmesi."""

from __future__ import annotations

import json
import stat
import subprocess
import sys

import ogrenmen_contracts as contracts
import pytest
from ogrenmen_common.adapters.base import LLMRequest, LLMResult
from ogrenmen_common.fakes import FakeLLM

from conftest import DERS, LESSON, WAV, make_rt, needs_ffmpeg, read_jsonl, run_cli
from ogrenmen_ders import transcript as T
from ogrenmen_ders.errors import DersError

LABELS = json.loads((DERS / "labels.json").read_text(encoding="utf-8"))
HASHES = sorted({r["hash"] for r in LABELS})
UNLABELED = {"unlabeled": True, "segments": [
    {"t": "00:00:00", "t_end": "00:00:02", "text": "Elif, bugün kesirlerde toplamaya bakalım."},
    {"t": "00:00:02", "t_end": "00:00:04", "text": "Tamam hocam Ayşe, ama paydalar farklı olunca karışıyor."},
    {"t": "00:02:05", "t_end": "00:02:07", "text": "Elif'in cevabı doğru."},
]}


class WhisperLikeLLM(FakeLLM):
    """``transcribe`` isteğine Whisper gibi etiketsiz bölüm döndürür; diğer amaçlar fixture'dan."""

    def complete(self, request):
        if request.purpose == "transcribe":
            self.calls.append(None)
            return LLMResult(ok=True, text=json.dumps(UNLABELED, ensure_ascii=False), json=UNLABELED,
                             tokens_in=10, tokens_out=10, audio_sec=20)
        return super().complete(request)


def test_whisper_fallback_cleans_before_diarize(tmp_path):
    rt = make_rt(tmp_path / "out")
    rt.ledger.llm = WhisperLikeLLM()
    payloads = T.PayloadLog()
    raw = T.transcribe_audio(rt, WAV, lesson_id=LESSON, student_ref="s_qk7m2rx4tn5a", labels=LABELS,
                             name_hashes=HASHES, payloads=payloads)
    diarize = [r for r in payloads.requests if r["purpose"] == "diarize"]
    assert len(diarize) == 2                                   # 2 dakikalık pencereler: 00:00 ve 00:02
    for r in diarize:
        assert "Elif" not in r["prompt"] and "Ayşe" not in r["prompt"]
    assert "[ÖĞRENCİ], bugün" in diarize[0]["prompt"] and "hocam [EĞİTMEN]" in diarize[0]["prompt"]
    assert all(seg["speaker"] in ("ÖĞRENCİ", "EĞİTMEN") for seg in raw["segments"])
    purposes = [c["purpose"] for c in rt.db.written("llm_calls")]
    assert purposes == ["transcribe", "diarize", "diarize"]


@pytest.mark.parametrize("labels", [[], [r for r in LABELS if r["label"] == "EĞİTMEN"]],
                         ids=["etiket-yok", "yalniz-egitmen"])
def test_transcribe_refuses_without_student_labels(tmp_path, labels):
    rt = make_rt(tmp_path / "out")
    rt.ledger.llm = WhisperLikeLLM()
    payloads = T.PayloadLog()
    hashes = sorted({r["hash"] for r in labels})
    with pytest.raises(DersError, match="OGR-DERS-003 öğrenci ad hash'i yok"):
        T.transcribe_audio(rt, WAV, lesson_id=LESSON, student_ref=None, labels=labels, name_hashes=hashes,
                           payloads=payloads)
    assert not rt.db.written("llm_calls") and payloads.requests == []   # ses de gönderilmedi
    with pytest.raises(DersError, match="OGR-DERS-003"):                 # diarize kendi başına da reddeder
        T._diarize(rt, UNLABELED["segments"], labels=labels, name_hashes=hashes, payloads=payloads,
                   lesson_id=LESSON, student_ref=None)
    assert payloads.requests == []


def test_payload_log_records_every_round_and_blocks_leaks(tmp_path):
    """Vekil, defterin gönderdiği her isteği (onarım dahil) kaydeder; adı olan istemi göndermez."""
    rt = make_rt(tmp_path / "out", bad_output_at=[0])                    # ilk transkript yanıtı bozuk → onarım
    payloads = T.PayloadLog()
    T.transcribe_audio(rt, WAV, lesson_id=LESSON, student_ref=None, labels=LABELS, name_hashes=HASHES,
                       payloads=payloads, hint="lesson-01")
    assert [r["purpose"] for r in payloads.requests] == ["transcribe", "transcribe"]
    assert "Önceki yanıtın şemaya uymadı" in payloads.requests[1]["prompt"]
    assert payloads.requests[0]["model"] and "Elif" not in json.dumps(payloads.requests, ensure_ascii=False)
    inner = rt.ledger.llm
    leaky = LLMRequest(purpose="diarize", model="m", system="", prompt="Elif: merhaba", schema_id=None)
    with payloads.sending(rt, chain="diarize", name_hashes=HASHES, what="deneme"):
        with pytest.raises(DersError, match="OGR-DERS-003"):
            rt.ledger.llm.complete(leaky)
    assert rt.ledger.llm is inner and len(payloads.requests) == 2        # adaptör geri kondu, kayıt yok


def test_scrubbing_validator_removes_names_from_errors():
    check = T.scrubbing_validator(lambda data: ["/segments/0/text: 'Elif hocam' fazla uzun"], LABELS, HASHES)
    (err,) = check({})
    assert "Elif" not in err and "[ÖĞRENCİ]" in err


def test_clean_transcript_labels_names_and_validates_segments():
    raw = json.loads((DERS / "lesson-01.transcript.json").read_text(encoding="utf-8"))
    cleaned, replaced = T.clean_transcript(raw, LABELS, HASHES)
    assert replaced == 2 and "Elif" not in json.dumps(cleaned, ensure_ascii=False)
    assert cleaned["segments"][4]["text"] == "Paylar ve paydalar ayrı ayrı toplanmaz [ÖĞRENCİ]. Önce paydayı eşitle."
    for line in T.transcript_jsonl(cleaned).decode("utf-8").splitlines():
        contracts.validate("transcript#/$defs/segment", json.loads(line))
    contracts.validate("transcript", cleaned)
    with pytest.raises(DersError, match="OGR-DERS-005"):
        T.clean_transcript({"segments": [{"t": "0:1", "speaker": "ÖĞRENCİ", "text": "x"}]}, LABELS, HASHES)


def test_assert_no_names_is_last_belt():
    with pytest.raises(DersError, match="OGR-DERS-003"):
        T.assert_no_names("EĞİTMEN: Elif, başlayalım.", HASHES, what="deneme")
    T.assert_no_names("EĞİTMEN: [ÖĞRENCİ], başlayalım.", HASHES, what="deneme")


def test_normalize_splits_long_segments_and_drops_extra_keys():
    long = " ".join(["kesir"] * 1500)
    out = T.normalize_segments({"segments": [{"t": "00:00:01", "speaker": "EĞİTMEN", "text": long, "conf": 0.9},
                                             {"t": "00:00:02", "speaker": "ÖĞRENCİ", "text": "   "}]})
    assert len(out["segments"]) == 3 and all(len(s["text"]) <= T.MAX_SEGMENT_TEXT for s in out["segments"])
    assert all(set(s) == {"t", "speaker", "text"} for s in out["segments"])


def test_parse_whisper_cpp():
    data = {"transcription": [
        {"timestamps": {"from": "00:00:00,000", "to": "00:00:02,000"}, "offsets": {"from": 0, "to": 2000},
         "text": " Elif, bugün kesirlere bakalım."},
        {"offsets": {"from": 125400, "to": 127000}, "text": "  "},
        {"offsets": {"from": 3725000, "to": 3727500}, "text": "Tamam."}]}
    assert T.parse_whisper_cpp(data) == [
        {"t": "00:00:00", "t_end": "00:00:02", "text": "Elif, bugün kesirlere bakalım."},
        {"t": "01:02:05", "t_end": "01:02:07", "text": "Tamam."}]


def _fake_whisper_bin(tmp_path):
    """whisper.cpp ikamesi: -of <önek> -oj ile <önek>.json yazar (gerçek ikilinin çıktı biçimi)."""
    script = tmp_path / "whisper-cli"
    script.write_text(
        f"#!{sys.executable}\n"
        "import json, sys\n"
        "a = sys.argv[1:]\n"
        "assert '-oj' in a and a[a.index('-l') + 1] == 'tr' and a[a.index('-m') + 1].endswith('.bin')\n"
        "open(a[a.index('-f') + 1], 'rb').read(4)\n"
        "out = a[a.index('-of') + 1] + '.json'\n"
        "segs = [{'offsets': {'from': 0, 'to': 2000}, 'text': ' Elif, bugün kesirlerde toplamaya bakalım.'},\n"
        "        {'offsets': {'from': 2000, 'to': 4000}, 'text': ' Tamam hocam.'}]\n"
        "json.dump({'transcription': segs}, open(out, 'w'))\n", encoding="utf-8")
    script.chmod(script.stat().st_mode | stat.S_IEXEC)
    model = tmp_path / "ggml-large-v3-turbo.bin"
    model.write_bytes(b"model")
    return script, model


def test_whisper_cpp_engine_local_then_diarize(tmp_path):
    script, model = _fake_whisper_bin(tmp_path)
    rt = make_rt(tmp_path / "out")
    payloads = T.PayloadLog()
    raw = T.transcribe_audio(rt, WAV, lesson_id=LESSON, student_ref="s_qk7m2rx4tn5a", labels=LABELS,
                             name_hashes=HASHES, payloads=payloads, engine="whispercpp",
                             env={"WHISPER_CPP_BIN": str(script), "WHISPER_CPP_MODEL": str(model)})
    assert [r["purpose"] for r in payloads.requests] == ["diarize"]   # ses hiçbir sağlayıcıya gitmedi
    assert "Elif" not in payloads.requests[0]["prompt"] and "[ÖĞRENCİ]" in payloads.requests[0]["prompt"]
    assert raw["segments"] and [c["purpose"] for c in rt.db.written("llm_calls")] == ["diarize"]
    with pytest.raises(DersError, match="OGR-DERS-006"):
        T.transcribe_audio(rt, WAV, lesson_id=LESSON, student_ref=None, labels=LABELS, name_hashes=HASHES,
                           payloads=payloads, engine="whispercpp", env={})


def test_whisper_cpp_timeout_is_ders_error(tmp_path, monkeypatch):
    script, model = _fake_whisper_bin(tmp_path)

    def hang(args, **kw):
        raise subprocess.TimeoutExpired(args, kw.get("timeout"))

    monkeypatch.setattr(subprocess, "run", hang)
    with pytest.raises(DersError, match="OGR-DERS-006 whisper.cpp zaman aşımı"):
        T.whisper_cpp(WAV, env={"WHISPER_CPP_BIN": str(script), "WHISPER_CPP_MODEL": str(model)})


@needs_ffmpeg
def test_transcribe_only_cli(tmp_path):
    out = tmp_path / "out"
    assert run_cli("transcribe-only", "--lesson", LESSON, "--video", str(WAV), "--dry-run", "--fixtures",
                   str(DERS), "--out", str(out)) == 0
    transcript = json.loads((out / "transcript.json").read_text(encoding="utf-8"))
    contracts.validate("transcript", transcript)
    assert "Elif" not in json.dumps(transcript, ensure_ascii=False)
    assert not (out / "lesson_analyses.jsonl").exists() and not (out / "lesson_claims.jsonl").exists()
    (lesson,) = read_jsonl(out / "lessons.jsonl")
    assert lesson["transcript_path"] == f"transcripts/{LESSON}.jsonl" and lesson["status"] == "analyzed"
    assert [c["purpose"] for c in read_jsonl(out / "llm_calls.jsonl")] == ["transcribe"]
    assert "Elif" not in (out / "api_payload.json").read_text(encoding="utf-8")
