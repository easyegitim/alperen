"""gemini_schema ↔ commit edilen schemas/gemini/*.json ↔ scripts/flatten.py (TS toGeminiSchema ile aynı)."""

from __future__ import annotations

import json
import subprocess
import sys

import pytest
from conftest import CONTRACTS, SCHEMA_DIR, read_json

import ogrenmen_contracts as oc

GEMINI_DIR = SCHEMA_DIR / "gemini"
FLATTENED = [n for n in oc.SCHEMA_NAMES if n != "common"]


def test_file_set():
    assert sorted(p.stem for p in GEMINI_DIR.glob("*.json")) == sorted(FLATTENED)


@pytest.mark.parametrize("name", FLATTENED)
def test_matches_committed_file(name):
    committed = (GEMINI_DIR / f"{name}.json").read_text(encoding="utf-8")
    produced = json.dumps(oc.gemini_schema(name), ensure_ascii=False, indent=2) + "\n"
    assert produced == committed


def test_flatten_script_matches_committed_files(tmp_path):
    """flatten.py geçici dizine üretir (commit edilen dosyalara dokunmaz); iki çalıştırma ve
    commit edilen schemas/gemini bayt bayt aynıdır."""
    committed_before = {p.name: p.read_bytes() for p in GEMINI_DIR.glob("*.json")}
    script = str(CONTRACTS / "scripts" / "flatten.py")
    outs = []
    for run in ("a", "b"):
        out = tmp_path / run
        subprocess.run([sys.executable, script, "--out", str(out)], check=True, capture_output=True)
        outs.append({p.name: p.read_bytes() for p in out.glob("*.json")})
    assert outs[0] == outs[1]
    assert outs[0] == committed_before
    assert {p.name: p.read_bytes() for p in GEMINI_DIR.glob("*.json")} == committed_before


def test_flatten_script_removes_stale_files_only_in_out_dir(tmp_path):
    (tmp_path / "eski.json").write_text("{}", encoding="utf-8")
    subprocess.run(
        [sys.executable, str(CONTRACTS / "scripts" / "flatten.py"), "--out", str(tmp_path)],
        check=True,
        capture_output=True,
    )
    assert not (tmp_path / "eski.json").exists()
    assert sorted(p.stem for p in tmp_path.glob("*.json")) == sorted(FLATTENED)


def test_rules():
    qi = oc.gemini_schema("question-item")
    assert qi["properties"]["schema_version"] == {"enum": ["1.0"], "type": "string"}
    assert qi["properties"]["figure"]["nullable"] is True
    assert qi["properties"]["id"] == {"type": "string"}
    assert "allOf" not in qi and "additionalProperties" not in json.dumps(qi)
    plan = oc.gemini_schema("https://ogrenmen.easy/schemas/exam-priority-plan.json")
    assert plan["properties"]["generated_at"]["format"] == "date-time"
    assert "x-forbidden-words" not in plan
    ak = oc.gemini_schema("answer-key")
    assert "anyOf" not in ak


def test_common_and_unknown_rejected():
    with pytest.raises(oc.GeminiSchemaError):
        oc.gemini_schema("common")
    with pytest.raises(KeyError):
        oc.gemini_schema("yok")
    with pytest.raises(KeyError, match="OGR-SCHEMA-001"):
        oc.gemini_schema("transcript#/$defs/segment")


def test_cycle_detection():
    from ogrenmen_contracts.gemini import flatten

    doc = {
        "$id": "https://ogrenmen.easy/schemas/loop.json",
        "type": "object",
        "properties": {"next": {"$ref": "#/$defs/node"}},
        "$defs": {"node": {"type": "object", "properties": {"next": {"$ref": "#/$defs/node"}}}},
    }
    with pytest.raises(oc.GeminiSchemaError, match="OGR-SCHEMA-003"):
        flatten(doc, [doc])


def test_committed_files_parse():
    for p in GEMINI_DIR.glob("*.json"):
        assert isinstance(read_json(p), dict)
