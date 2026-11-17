"""Biçimler: Python çekirdeği TS çekirdeği ve ajv-formats ile aynı kararı verir (ortak vaka dosyası)."""

from __future__ import annotations

import pytest
from conftest import CASES, read_json

from ogrenmen_contracts import _core

CASE_LIST = read_json(CASES / "formats.json")["cases"]


@pytest.mark.parametrize("case", CASE_LIST, ids=[f"{c['format']} {c['value']!r}" for c in CASE_LIST])
def test_shared_format_cases(case):
    assert _core.FORMATS[case["format"]](case["value"]) is case["valid"]


@pytest.mark.parametrize(
    ("pattern", "value", "expected"),
    [
        (r"^[0-9]{2}:[0-9]{2}:[0-9]{2}$", "12:00:00", True),
        (r"^[0-9]{2}:[0-9]{2}:[0-9]{2}$", "12:00:00\n", False),
        (r"^s_[a-z2-7]{12}$", "s_k3m7q2x4z6ab", True),
        (r"^s_[a-z2-7]{12}$", "s_k3m7q2x4z6ab\n", False),
        (r"^≈[0-9]+ puan$", "≈15 puan", True),
        (r"^\d+$", "١٢٣", False),
        (r"^[^!]*$", "ünlemsiz metin", True),
        (r"^[^!]*$", "ünlem!", False),
        (r"^10\.[0-9]{4,9}/\S+$", "10.1037/a0020082", True),
        (r"^[\d$]+$", "12$", True),
    ],
)
def test_js_pattern_semantics(pattern, value, expected):
    assert _core.js_pattern_search(pattern, value) is expected


def test_pattern_keyword_uses_js_semantics():
    import ogrenmen_contracts as oc

    seg = {"segments": [{"t": "00:00:04\n", "speaker": "EĞİTMEN", "text": "Merhaba"}]}
    assert [i.keyword for i in oc.errors("transcript", seg)] == ["pattern"]


def test_min_length_counts_code_points():
    import ogrenmen_contracts as oc

    assert oc.is_valid("query-expand", {"queries": ["a😀b", "spaced repetition", "aralıklı tekrar"]})
    assert not oc.is_valid("query-expand", {"queries": ["😀😀", "spaced repetition", "aralıklı tekrar"]})
