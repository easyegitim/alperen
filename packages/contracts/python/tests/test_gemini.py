"""gemini_schema: JSON Schema'dan anında düzleştirme (eski Gemini bağdaştırıcıları için).

v2'de Gemini şema kopyaları (schemas/gemini) ve üreteç betiği kaldırıldı; `gemini_schema` yalnız, henüz budanmamış
`pipelines/common` adaptörlerinin içe aldığı bir yardımcı olarak kalır ve dosya yazmaz.
"""

from __future__ import annotations

import json

import pytest
from conftest import SCHEMA_DIR

import ogrenmen_contracts as oc

FLATTENED = [n for n in oc.SCHEMA_NAMES if n != "common"]


def test_no_committed_copies():
    assert not (SCHEMA_DIR / "gemini").exists()


@pytest.mark.parametrize("name", FLATTENED)
def test_flattens_every_schema(name):
    flat = oc.gemini_schema(name)
    assert flat["type"] in ("object", "array")
    text = json.dumps(flat)
    assert '"$ref"' not in text and "x-forbidden-words" not in text


def test_rules():
    qi = oc.gemini_schema("question-item")
    assert qi["properties"]["schema_version"] == {"enum": ["1.0"], "type": "string"}
    assert qi["properties"]["figure"]["nullable"] is True
    assert qi["properties"]["id"] == {"type": "string"}
    assert "allOf" not in qi
    plan = oc.gemini_schema("https://ogrenmen.easy/schemas/exam-priority-plan.json")
    assert plan["properties"]["generated_at"]["format"] == "date-time"
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
