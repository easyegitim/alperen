"""Desen anlamı (ECMAScript ``$``) ve parçalı başvurular: test/cases/patterns.json (TS ile aynı)."""

from __future__ import annotations

import pytest
from conftest import CASES, FIXTURES, read_json

import ogrenmen_contracts as oc

CASE_LIST = read_json(CASES / "patterns.json")["cases"]


@pytest.mark.parametrize("case", CASE_LIST, ids=[c["name"] for c in CASE_LIST])
def test_shared_cases(case):
    assert oc.is_valid(case["ref"], case["data"]) is case["valid"]
    assert (oc.errors(case["ref"], case["data"]) == []) is case["valid"]


def test_pattern_properties_use_js_semantics():
    """patternProperties ve ona bağlı additionalProperties da ``$``'ı ECMAScript gibi yorumlar."""
    cls = oc._validator_class()
    schema = {
        "type": "object",
        "patternProperties": {"^k[0-9]$": {"type": "integer"}},
        "additionalProperties": False,
    }
    v = cls(schema)
    assert v.is_valid({"k1": 1})
    assert not v.is_valid({"k1": "x"})
    assert not v.is_valid({"k1\n": 1})
    assert [e.validator for e in v.iter_errors({"k1\n": 1})] == ["additionalProperties"]
    v2 = cls({"type": "object", "patternProperties": {"^k$": {"type": "integer"}}})
    assert v2.is_valid({"k\n": "x"})


def test_fragment_refs_and_ids():
    seg = {"t": "00:01:05", "speaker": "EĞİTMEN", "text": "Paydaları eşitleyelim."}
    assert oc.schema_name("transcript#/$defs/segment") == "transcript"
    assert (
        oc.schema_id("transcript.json#/$defs/segment") == "https://ogrenmen.easy/schemas/transcript.json#/$defs/segment"
    )
    assert oc.validate("transcript#/$defs/segment", seg) is seg
    assert not oc.is_valid("transcript", seg)
    skill = read_json(FIXTURES / "curriculum" / "valid" / "active-slice.json")["skills"][0]
    assert oc.is_valid("curriculum#/$defs/skill", skill)
    with pytest.raises(oc.ContractValidationError) as exc:
        oc.validate("curriculum#/$defs/skill", {**skill, "extra": 1})
    assert exc.value.schema_id == "https://ogrenmen.easy/schemas/curriculum.json#/$defs/skill"
    for bad in ("transcript#/$defs/yok", "transcript#/properties/segments", "yok#/$defs/segment"):
        with pytest.raises(KeyError, match="OGR-SCHEMA-001"):
            oc.is_valid(bad, seg)


@pytest.mark.parametrize("order", [["A", "A", "C", "D"], ["B", "A", "D", "C"], ["A", "B", "D", "C"]])
def test_option_keys_must_be_a_b_c_d_in_order(order):
    item = read_json(FIXTURES / "question-item" / "valid" / "mcq-diagnostic.json")
    for opt, key in zip(item["options"], order, strict=True):
        opt["key"] = key
    assert not oc.is_valid("question-item", item)
    assert "const" in {i.keyword for i in oc.errors("question-item", item)}


def test_every_schema_format_is_implemented():
    used = oc._used_formats(list(oc._documents().values()))
    assert used <= set(oc._core.FORMATS)
    assert {"uuid", "date-time", "date"} <= used
    assert oc._used_formats({"properties": {"format": {"type": "string"}}, "x": [{"format": "uri"}]}) == {"uri"}
