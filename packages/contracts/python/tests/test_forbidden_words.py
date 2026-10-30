from __future__ import annotations

import copy

import pytest
from conftest import CASES, FIXTURES, read_json

import ogrenmen_contracts as oc
from ogrenmen_contracts import _core

CASE_LIST = read_json(CASES / "forbidden-words.json")["cases"]


@pytest.mark.parametrize("case", CASE_LIST, ids=[c["name"] for c in CASE_LIST])
def test_shared_cases(case):
    assert oc.find_forbidden_word(case["data"], case["words"]) == case["hit"]


def test_normalization():
    assert oc.normalize_tr("İIıi") == "iiii"
    assert oc.normalize_tr("ÇIKACAK") == oc.normalize_tr("çıkacak")
    assert _core.contains_forbidden("KESİNLİKLE", "kesin")
    assert _core.contains_forbidden("dekesin", "kesin")
    assert not _core.contains_forbidden("Kesir problemleri", "kesin")
    assert _core.forbidden_stems("ÇIKACAK") == ["çikacak", "çikacağ"]
    assert _core.forbidden_stems("tahmin") == ["tahmin"]


@pytest.mark.parametrize("text", ["Tahmini sorular", "Bu konu kesin çıkacak", "GARANTİ puan", "çıkacak sorular"])
def test_priority_plan_rejects_forbidden_words(text):
    plan = read_json(FIXTURES / "exam-priority-plan" / "valid" / "two-years.json")
    bad = copy.deepcopy(plan)
    bad["rows"][0]["topic"] = text
    issues = oc.errors("exam-priority-plan", bad)
    hits = [i for i in issues if i.keyword == "x-forbidden-words"]
    assert hits
    assert isinstance(hits[0].params["word"], str)


def test_instructor_alert_words():
    alert = read_json(FIXTURES / "instructor-alert" / "valid" / "morale.json")
    assert oc.errors("instructor-alert", alert) == []
    for w in ["depresif", "Tembel", "BAŞARISIZ", "umutsuz"]:
        assert not oc.is_valid("instructor-alert", {**alert, "detail": f"Öğrenci {w} görünüyor."}), w


def test_schema_without_list_accepts_same_words():
    tr = read_json(FIXTURES / "tutor-reply" / "valid" / "escalation.json")
    assert oc.errors("tutor-reply", {**tr, "reply": "Bu kesin bir sonuç değil, tahmin de yapmıyoruz."}) == []
