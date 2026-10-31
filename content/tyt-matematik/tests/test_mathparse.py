"""templates/_common.py matematik ayrıştırma ve karşılaştırma."""

from __future__ import annotations

import pytest
import sympy

from templates import _common as C


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("`7/8`", sympy.Rational(7, 8)),
        ("`-11`", -11),
        ("`3√3`", 3 * sympy.sqrt(3)),
        ("`√45`", 3 * sympy.sqrt(5)),
        ("%25", 25),
        ("`%125`", 125),
        ("`0,045`", sympy.Rational(9, 200)),
        ("`0,4258`", sympy.Rational(2129, 5000)),
        ("`2^(-15)`", sympy.Rational(1, 32768)),
        ("`-2^8`", -256),
        ("`2^5 · 2^(-3)`", 4),
        ("`450 TL`", 450),
        ("`12 - 3 · (2 - 5)`", 21),
        ("`4,2 · 10 + 0,58 · 100`", 100),
    ],
)
def test_parse_numbers(text, expected):
    assert C.values_equal(C.parse_math(text), expected)


def test_parse_symbolic_and_relations():
    a = C._SYMBOLS["a"]
    assert C.values_equal(C.parse_math("`a^5`"), a**5)
    assert not C.values_equal(C.parse_math("`a^5`"), a**6)
    # eşitsizlik → çözüm kümesi
    assert C.values_equal(C.parse_math("`5 - 2x > -3`"), C.sympify_expr("Interval.open(-oo, 4)"))
    assert not C.values_equal(C.parse_math("`5 - 2x < -3`"), C.sympify_expr("Interval.open(-oo, 4)"))
    assert C.values_equal(C.parse_math("`5 - 2x >= -3`"), C.parse_math("`x ≤ 4`"))
    assert C.values_equal(C.parse_math("`|x - 3| < 4`"), C.sympify_expr("Interval.open(-1, 7)"))
    # küme ile sayı eşit sayılmaz
    assert not C.values_equal(C.parse_math("`x < 4`"), sympy.Integer(4))


def test_parse_errors():
    with pytest.raises(C.MathParseError):
        C.parse_math("``")
    with pytest.raises(C.MathParseError):
        C.parse_math("`3 +* `")
    with pytest.raises(C.MathParseError):
        C.parse_math("`|x - 3 < 4`")


def test_match_options_finds_only_equal_values():
    options = [{"key": "A", "text": "`4/12`"}, {"key": "B", "text": "`7/8`"}, {"key": "C", "text": "`14/16`"},
               {"key": "D", "text": "`3/32`"}]
    assert C.match_options(sympy.Rational(7, 8), options) == ["B", "C"]
    assert C.match_options(sympy.Rational(1, 3), options) == ["A"]


def test_content_hash_matches_fixture_formula():
    # fixtures/scripts/content.py ile aynı normalleştirme: boşluk sadeleşir, küçük harf
    opts = [{"key": "A", "text": "`4/12`"}, {"key": "B", "text": "`7/8`"}]
    assert C.content_hash("`3/4 +  1/8`  ISLEM", opts) == C.content_hash("`3/4 + 1/8` islem", opts)
    assert C.content_hash("a", opts) != C.content_hash("b", opts)
    # dev-seed'deki aynı madde (DIAG-2026.1-07) aynı özeti taşır
    import json

    from conftest import REPO_ROOT

    seed = json.loads((REPO_ROOT / "fixtures" / "db" / "dev-seed.json").read_text(encoding="utf-8"))
    row = next(q for q in seed["questions"] if q["id"] == C.uid("question", "DIAG-2026.1-07"))
    assert C.content_hash(row["stem"], row["options"]) == row["content_hash"]


def test_deterministic_ids():
    assert C.curriculum_uuid("TYT-MAT@2026.1") == "7a988b84-8937-5242-8c35-ddbc4ea9216d"
    assert C.uid("question", "DIAG-2026.1-07") == C.uid("question", "DIAG-2026.1-07")
    assert C.uid("question", "DIAG-2026.1-07") != C.uid("question", "DIAG-2026.1-08")
