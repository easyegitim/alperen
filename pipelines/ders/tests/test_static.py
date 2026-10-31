"""Statik kemerler: model adı koda yazılmaz, gözlem tablosuna yazım yok, text_raw okunmaz, metinler ünlemsiz."""

from __future__ import annotations

import re
from pathlib import Path

import ogrenmen_ders

SRC = Path(ogrenmen_ders.__file__).parent
FILES = sorted(SRC.glob("*.py"))


def test_no_model_names_in_code():
    for path in FILES:
        text = path.read_text(encoding="utf-8")
        assert not re.search(r"gemini-|claude-|whisper-large|flash-lite|sonnet", text, re.I), path.name


def test_never_writes_observations_or_reads_text_raw():
    for path in FILES:
        text = path.read_text(encoding="utf-8")
        assert not re.search(r"""(insert|update|insert_minimal|update_minimal)\([^)]*["']observations["']""", text), \
            path.name
        assert "text_raw" not in text, path.name
        assert "approve_lesson_analysis\"" not in text and "'approve_lesson_analysis'" not in text, path.name


def test_rpc_names_are_blueprint_names():
    names = set()
    for path in FILES:
        names |= set(re.findall(r"""\.rpc\(\s*["']([a-z_]+)["']""", path.read_text(encoding="utf-8")))
    assert names == {"register_lesson", "resolve_lesson_labels", "profile_for_prompt", "write_lesson_analysis",
                     "confirm_video_deleted"}


def test_user_facing_strings_have_no_exclamation():
    for path in FILES:
        for m in re.finditer(r'"([^"\n]*[A-Za-zÇĞİÖŞÜçğıöşü][^"\n]*)"', path.read_text(encoding="utf-8")):
            text = re.sub(r"!=|![rsa]\}", "", m.group(1))
            assert "!" not in text, (path.name, m.group(1))
