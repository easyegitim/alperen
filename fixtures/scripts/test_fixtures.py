"""fixtures/ testleri: `python -m pytest /home/user/alperen/fixtures/scripts -q`

Üretilmiş dosyalar üreticiyle aynı mı, tutarlılık denetimi geçiyor mu, seçim kuralı deterministik mi,
şekil örnekleri beklenen davranışı gösteriyor mu.
"""

from __future__ import annotations

import ast
import hashlib
import json
import subprocess
import sys
from pathlib import Path

import pytest

HERE = Path(__file__).resolve().parent
FIX = HERE.parent
sys.path.insert(0, str(HERE))

import build_fixtures  # noqa: E402
import check_fixtures  # noqa: E402
import select_llm  # noqa: E402


def test_generated_files_are_up_to_date():
    for rel, obj in build_fixtures.build().items():
        p = FIX / rel
        assert p.exists(), rel
        assert p.read_text(encoding="utf-8") == build_fixtures.render(obj), f"{rel} güncel değil; build_fixtures.py çalıştır"


def test_build_is_deterministic():
    a = {k: build_fixtures.render(v) for k, v in build_fixtures.build().items()}
    b = {k: build_fixtures.render(v) for k, v in build_fixtures.build().items()}
    assert a == b


def test_consistency_checks_pass():
    check_fixtures.errors.clear()
    check_fixtures.check_parse()
    check_fixtures.check_llm()
    check_fixtures.check_contract_files()
    check_fixtures.check_seed()
    check_fixtures.check_kulaklik()
    assert check_fixtures.errors == []


def test_bad_schema_really_fails_schema():
    # bad-schema'nın gerçekten şemaya aykırı olduğu doğrulanır: geçerli bir dosya bad-schema yerine konursa hata
    good = json.loads((FIX / "llm/chat/01-socratic-paydalar.json").read_text())
    assert check_fixtures.errs("tutor-reply", good) == []
    assert check_fixtures.errs("tutor-reply", json.loads((FIX / "llm/chat/bad-schema.json").read_text()))


@pytest.mark.parametrize("purpose", sorted(check_fixtures.LLM_SCHEMA))
def test_selection_rule(purpose):
    files = select_llm.candidates(purpose)
    assert files and all(not f.name.startswith("bad-schema") for f in files)
    assert [f.name for f in files] == sorted(f.name for f in files)
    prompt = "Öğrenci: 3/4 + 1/8 kaç oluyor?"
    expected = files[int(hashlib.sha256(prompt.encode()).hexdigest()[:8], 16) % len(files)]
    assert select_llm.select(purpose, prompt) == expected
    assert select_llm.select(purpose, prompt) == select_llm.select(purpose, prompt)
    assert select_llm.bad_schema(purpose).exists()


def test_selection_spreads_over_files():
    seen = {select_llm.select("chat", f"istem {i}").name for i in range(200)}
    assert seen == {f.name for f in select_llm.candidates("chat")}


def _imports(path: Path) -> set[str]:
    tree = ast.parse(path.read_text(encoding="utf-8"))
    mods = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            mods |= {a.name.split(".")[0] for a in node.names}
        elif isinstance(node, ast.ImportFrom) and node.module:
            mods.add(node.module.split(".")[0])
    return mods


def test_figure_examples(tmp_path):
    figs = FIX / "tablet/figures"
    assert "socket" in _imports(figs / "net.py")
    assert _imports(figs / "good.py") <= {"matplotlib"}
    assert _imports(figs / "blank.py") <= {"matplotlib"}
    import xml.etree.ElementTree as ET

    with pytest.raises(ET.ParseError):
        ET.fromstring((figs / "bad.svg").read_text(encoding="utf-8"))
    pytest.importorskip("matplotlib")
    import matplotlib.image as mpimg

    for name, blank in (("good.py", False), ("blank.py", True)):
        d = tmp_path / name
        d.mkdir()
        subprocess.run([sys.executable, "-I", str(figs / name)], cwd=d, check=True, timeout=120)
        img = mpimg.imread(d / "figure.png")
        assert img.shape[1] == 800 and img.shape[0] == 400
        assert (float(img.var()) < 1e-9) == blank


def test_wav_fixture_is_small_and_valid():
    wav = (FIX / "ders/lesson-01.wav").read_bytes()
    assert wav[:4] == b"RIFF" and wav[8:12] == b"WAVE"
    assert len(wav) <= 300 * 1024
    import wave

    with wave.open(str(FIX / "ders/lesson-01.wav")) as w:
        assert w.getnchannels() == 1
        assert abs(w.getnframes() / w.getframerate() - 20.0) < 0.01


def test_pii_leak_detector_catches_raw_text():
    # transcribe ham (adlı) olabilir; diarize/lesson_analysis olamaz — dedektör farkı gerçekten görür
    raw = json.loads((FIX / "llm/transcribe/02-mert.json").read_text(encoding="utf-8"))
    clean = json.loads((FIX / "llm/diarize/02-mert.json").read_text(encoding="utf-8"))
    assert check_fixtures.pii_leaks(raw)
    assert check_fixtures.pii_leaks(clean) == []
    assert clean["segments"][0]["text"] == "[ÖĞRENCİ], üslü ifadelerle başlayalım."
    for leak in ("Hakan Bey aradı", "0532 123 45 67", "@baris_t", "DENIZ KOÇ", "Barış'a sor", "can_o"):
        assert check_fixtures.pii_leaks(leak), leak
    assert check_fixtures.pii_leaks("[ÖĞRENCİ] `3/4 + 1/8` topladı; Soru 10-A şıkkı") == []


def test_forbidden_words_use_contracts_turkish_fold():
    assert check_fixtures.forbidden_words("exam-priority-plan", {"note": "Bu konu KESİN gelir"})
    assert check_fixtures.forbidden_words("exam-priority-plan", {"note": "Sıklık analizine göre öncelik"}) == []


def test_callback_data_is_lossless_and_short():
    from fxlib import uid, uuid_b64url, uuid_from_b64url

    cq = json.loads((FIX / "telegram/callback_answer.json").read_text(encoding="utf-8"))["callback_query"]
    _, s, q, key = cq["data"].split(":")
    assert len(cq["data"].encode()) <= 64 and key == "A"
    assert uuid_from_b64url(s) == uid("diagnostic_session", "elif")
    assert uuid_from_b64url(q) == uid("question", "DIAG-2026.1-01")
    u = "ffffffff-0000-4000-8000-0123456789ab"
    assert uuid_from_b64url(uuid_b64url(u)) == u and len(uuid_b64url(u)) == 22
    check_fixtures.errors.clear()
    check_fixtures.check_callback()
    assert check_fixtures.errors == []


def test_lesson_morale_analyses_are_complete():
    lm = json.loads((FIX / "kulaklik/lesson-morale.json").read_text(encoding="utf-8"))
    calls = json.loads((FIX / "kulaklik/llm-calls-month.json").read_text(encoding="utf-8"))
    cost = {c["ref_id"]: c["cost_usd"] for c in calls if c["purpose"] == "lesson_analysis"}
    assert len(lm["lesson_analyses"]) == 3
    for a in lm["lesson_analyses"]:
        assert check_fixtures.errs("lesson-analysis", a["analysis"]) == []
        assert a["analysis"]["talk"]["morale"] == "low" and isinstance(a["seed_profile"], dict)
        if a["lesson_id"] in cost:
            assert cost[a["lesson_id"]] == a["cost_usd"] == 0.45
