"""SymPy anahtar denetimi ve zarf kuralları (§6.1 (4), (6); §4.1)."""

from __future__ import annotations

import copy
import json
import re

import pytest

from conftest import TABLET_FIXTURES
from ogrenmen_tablet import verify as V
from scripted import envelope


def _load(name: str) -> dict:
    return json.loads((TABLET_FIXTURES / name).read_text(encoding="utf-8"))


def test_sympy_rejects_wrong_key():
    bad = V.check_envelope(_load("llm-question-bad-sympy.json"))
    assert bad.sympy.status == "failed"
    assert bad.sympy.matched_option == "B" and bad.sympy.value == "11/12"
    assert "anahtar D" in bad.sympy.note
    # LLM'in kendi "verified" beyanı ve raporu kullanılmaz, yeniden yazılır
    assert bad.key["sympy_status"] == "failed" and bad.key["sympy_report"]["value"] == "11/12"
    good = V.check_envelope(_load("llm-question.json"))
    assert good.sympy.status == "verified" and good.sympy.matched_option == "B" and good.sympy.value == "7/12"


@pytest.mark.parametrize("mutate,status,needle", [
    (lambda e: e["key"].update(correct_option="D"), "failed", "anahtar D"),
    (lambda e: [o.update(text="`11`") for o in e["item"]["options"][1:3]], "failed", "birden"),
    (lambda e: e["key"].update(canonical_expr="kiz + erkek + 100"), "failed", "hiçbir şık"),
    (lambda e: e["key"].update(canonical_expr="kiz + y"), "failed", "çözülmemiş"),
    (lambda e: e["key"].update(canonical_expr="__import__('os').system('true')"), "failed", "ayrıştırılamadı"),
    (lambda e: e["key"].update(canonical_expr="1/0"), "failed", "sonlu"),
    (lambda e: e["item"]["options"][0].update(misconception_tag="genel.soruyu-yarim-okuma"), "failed", "etiket"),
    (lambda e: e["key"].pop("canonical_expr"), "not_applicable", "sözel"),
])
def test_sympy_rules(mutate, status, needle):
    env = envelope("tyt.mat.problem.sayi", 1)  # kiz=4, erkek=7 → doğru cevap 11 (A)
    mutate(env)
    check = V.check_envelope(env)
    assert check.sympy.status == status, check.sympy
    assert needle in check.sympy.note, check.sympy.note


def test_numeric_key_requires_canonical_expr():
    env = envelope("tyt.mat.temel.ondalik", 2, kind="numeric")
    env["key"].pop("canonical_expr")
    env["key"]["numeric_value"] = "999"
    check = V.check_envelope(env)
    assert check.sympy.status == "failed" and "canonical_expr" in check.sympy.note
    assert check.key["sympy_status"] == "failed"  # register_answer_key'e "verified" gitmez
    # ondalık virgül demet sanılmaz
    ok = V.verify_key({"kind": "numeric"}, {"canonical_expr": "Rational(1, 8)", "numeric_value": "0,125"})
    assert ok.status == "verified"


def test_untrusted_expression_is_bounded():
    import time

    for expr, stem in [("10**(10**10)", {}), ("a**(a**10)", {"a": 10}), ("2^(3^40)", {}), ("10**100000", {})]:
        start = time.monotonic()
        check = V.verify_key({"kind": "numeric", "stem_values": stem}, {"canonical_expr": expr, "numeric_value": "1"})
        assert check.status == "failed" and "ön denetim" in check.note, (expr, check)
        assert time.monotonic() - start < V.SYMPY_TIMEOUT_S
    assert V.verify_key({"kind": "numeric"}, {"canonical_expr": "2**10 - 1000", "numeric_value": "24"}).status == \
        "verified"
    # ön denetimden geçen ama süren hesap: ayrı süreç zaman sınırında kesilir, çağıran beklemede kalmaz
    start = time.monotonic()
    assert V.run_limited(time.sleep, 30, timeout=0.5) == ("timeout", None)
    assert time.monotonic() - start < 5
    assert V.run_limited(bytearray, 4 * 1024 ** 3, timeout=10)[0] == "memory"
    assert V.run_limited(divmod, 7, 2) == ("ok", (3, 1))


def test_public_note_hides_key_values():
    env = envelope("tyt.mat.problem.sayi", 1, mode="bad_sympy")  # 4 + 7 = 11 → A; anahtar C
    check = V.check_envelope(env)
    assert check.sympy.status == "failed" and "A" in check.sympy.note and "C" in check.sympy.note
    assert not re.search(r"\b[A-D]\b", check.sympy.public_note) and "11" not in check.sympy.public_note
    numeric = V.check_envelope(envelope("tyt.mat.temel.ondalik", 2, kind="numeric", mode="bad_sympy"))
    assert "eşit değil" in numeric.sympy.public_note
    assert numeric.sympy.value not in numeric.sympy.public_note


def test_numeric_key_requires_equal_value():
    env = envelope("tyt.mat.temel.ondalik", 2, kind="numeric")
    assert V.check_envelope(env).sympy.status == "verified"
    wrong = envelope("tyt.mat.temel.ondalik", 2, kind="numeric", mode="bad_sympy")
    check = V.check_envelope(wrong)
    assert check.sympy.status == "failed" and "eşit değil" in check.sympy.note
    fixture = V.check_envelope(json.loads(
        (TABLET_FIXTURES.parent / "llm" / "question_gen" / "04-ondalik-numeric.json").read_text(encoding="utf-8")))
    assert fixture.sympy.status == "verified" and fixture.sympy.value == "1/8"


def test_stem_values_substitution_is_textual_and_safe():
    assert V.substitute_stem_values("pay1/payda1 - pay2/payda2", {"pay1": 5, "payda1": 6, "pay2": 1,
                                                                   "payda2": 4}) == "(5)/(6) - (1)/(4)"
    assert V.substitute_stem_values("a + b", {"a": "0,5", "b": "x"}) == "(Rational('0.5')) + b"


def test_envelope_rules():
    with pytest.raises(V.VerifyError) as exc:
        V.check_envelope(_load("llm-question-bad-schema.json"))
    assert exc.value.code == "schema"
    env = envelope("tyt.mat.problem.sayi", 3)
    with pytest.raises(V.VerifyError) as exc:
        V.check_envelope(env, target_skill="tyt.mat.problem.yas")
    assert exc.value.code == "skill"
    with pytest.raises(V.VerifyError) as exc:
        V.check_envelope(env, curriculum_code="TYT-MAT@2027.1")
    assert exc.value.code == "curriculum"
    with pytest.raises(V.VerifyError) as exc:
        V.check_envelope(env, question_kind="numeric")
    assert exc.value.code == "kind"
    two_tags = copy.deepcopy(env)
    for opt in two_tags["item"]["options"][1:]:
        opt["misconception_tag"] = "genel.soruyu-yarim-okuma"
    with pytest.raises(V.VerifyError) as exc:
        V.check_envelope(two_tags)
    assert exc.value.code in ("options", "schema")  # şık kuralı (en az iki null) şemada ya da yerel kuralda düşer
    leaked = copy.deepcopy(env)
    leaked["item"]["stem_values"]["correct_option"] = "A"
    with pytest.raises(V.VerifyError) as exc:
        V.check_envelope(leaked)
    assert exc.value.code == "key_leak"


def test_key_payload_is_schema_checked():
    check = V.check_envelope(envelope("tyt.mat.problem.sayi", 4))
    payload = V.key_payload(check.key, "00000000-0000-4000-8000-000000000001")
    assert "question_id" not in payload and payload["sympy_status"] == "verified"
    broken = dict(check.key, solution="kısa")
    with pytest.raises(V.VerifyError):
        V.key_payload(broken, "00000000-0000-4000-8000-000000000001")
