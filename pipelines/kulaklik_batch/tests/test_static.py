"""Statik kemerler: text_raw hiçbir okumada istenmez; model adı koda yazılmaz; kullanıcı metni ünlemsiz."""

from __future__ import annotations

import re
from pathlib import Path

from ogrenmen_kulaklik import facts as F

SRC = Path(F.__file__).parent


def test_no_text_raw_in_column_lists():
    assert "text_raw" not in F.MESSAGE_COLUMNS
    for path in SRC.glob("*.py"):
        for m in re.finditer(r"columns=\(([^)]*)\)", path.read_text(encoding="utf-8")):
            assert "text_raw" not in m.group(1), path.name


def test_no_model_names_or_hard_coded_gate_thresholds():
    for path in SRC.glob("*.py"):
        text = path.read_text(encoding="utf-8")
        assert "gemini-2.5" not in text and "flash-lite" not in text, path.name  # zincir adı kullanılır (§4.9)
        assert not re.search(r"0\.90|0\.60|0\.10\b", text), path.name  # eşikler settings.pilot_gate'ten


def test_user_facing_strings_have_no_exclamation():
    for path in SRC.glob("*.py"):
        for m in re.finditer(r'"([^"\n]*[A-Za-zÇĞİÖŞÜçğıöşü][^"\n]*)"', path.read_text(encoding="utf-8")):
            text = re.sub(r"!=|![rsa]\}", "", m.group(1))
            assert "!" not in text, (path.name, m.group(1))
