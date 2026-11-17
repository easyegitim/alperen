"""pii sarmalayıcısı: hash'le temizleme, ders transkripti rol etiketleri, sızıntı denetimi."""

from __future__ import annotations

import pytest
from ogrenmen_pii import name_token_hashes

from conftest import seed_json
from ogrenmen_common.pii import label_transcript, name_leaks, role_hashes_from_labels, scrub_for_llm


def test_scrub_for_llm_counts_and_keeps_math():
    hashes = name_token_hashes("Elif Kaya")
    out = scrub_for_llm("Elif: 3/4 + 1/8 kaç? Telefonum 0532 123 45 67, x^2 ve √5.", hashes)
    assert "Elif" not in out.text and "[TELEFON]" in out.text and "3/4 + 1/8" in out.text and "√5" in out.text
    assert out.replacements == 2 and out.by_kind == {"name": 1, "phone": 1}
    with pytest.raises(TypeError):
        scrub_for_llm("Elif", None)  # type: ignore[arg-type]
    with pytest.raises(TypeError):
        scrub_for_llm("Elif", "Elif Kaya")  # type: ignore[arg-type]


def test_label_transcript_with_lesson_labels():
    transcript = seed_json("ders/lesson-01.transcript.json")
    labels = seed_json("ders/labels.json")
    assert any("Elif" in s["text"] for s in transcript["segments"])
    cleaned, n = label_transcript(transcript, labels)
    text = " ".join(s["text"] for s in cleaned["segments"])
    assert "Elif" not in text and "[ÖĞRENCİ]" in text and n >= 1
    assert [s["speaker"] for s in cleaned["segments"]] == [s["speaker"] for s in transcript["segments"]]
    assert name_leaks(text, [r["hash"] for r in labels]) == []


def test_hocam_pattern_and_stop_words():
    cleaned, n = label_transcript({"segments": [{"t": "00:00:01", "speaker": "ÖĞRENCİ", "text": "Hocam Murat geldi."},
                                                {"t": "00:00:02", "speaker": "ÖĞRENCİ", "text": "Hocam Peki tamam."}]},
                                  [])
    assert cleaned["segments"][0]["text"] == "Hocam [AD] geldi." and cleaned["segments"][1]["text"] == (
        "Hocam Peki tamam.") and n == 1


def test_role_labels_validation_and_leaks():
    assert role_hashes_from_labels([{"hash": "h", "label": "VELİ"}]) == {"h": "VELİ"}
    with pytest.raises(ValueError):
        role_hashes_from_labels([{"hash": "h", "label": "ADMIN"}])
    hashes = name_token_hashes("Mert Demir")
    assert name_leaks("Mert'in ödevi; demir değil Demir'e sor.", hashes) == ["Mert", "demir", "Demir"]
    assert name_leaks("[ÖĞRENCİ] geldi", hashes) == []
