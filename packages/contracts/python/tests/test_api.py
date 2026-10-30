from __future__ import annotations

import pytest
from conftest import FIXTURES, read_json

import ogrenmen_contracts as oc


def test_schema_name_and_id():
    assert oc.schema_name("question-item") == "question-item"
    assert oc.schema_name("https://ogrenmen.easy/schemas/question-item.json") == "question-item"
    assert oc.schema_name("question-item.schema.json") == "question-item"
    assert oc.schema_id("tutor-reply") == "https://ogrenmen.easy/schemas/tutor-reply.json"
    with pytest.raises(KeyError):
        oc.schema_name("question-item-v9")


def test_validate_raises_with_all_issues():
    plan = read_json(FIXTURES / "exam-priority-plan" / "valid" / "four-years.json")
    bad = {**plan, "title": "Tahminler", "extra": 1}
    with pytest.raises(oc.ContractValidationError) as info:
        oc.validate("exam-priority-plan", bad)
    err = info.value
    assert err.schema_id == "https://ogrenmen.easy/schemas/exam-priority-plan.json"
    assert {"const", "additionalProperties", "x-forbidden-words"} <= {i.keyword for i in err.issues}
    assert str(err).startswith("OGR-CONTRACT-001")


def test_issue_paths_are_json_pointers():
    tr = read_json(FIXTURES / "tutor-reply" / "valid" / "escalation.json")
    issues = oc.errors("tutor-reply", {**tr, "reply": "", "confidence": 2})
    assert {(i.path, i.keyword) for i in issues} >= {("/reply", "minLength"), ("/confidence", "maximum")}


def test_schema_returns_copy():
    s = oc.schema("tutor-reply")
    s["properties"].clear()
    assert oc.schema("tutor-reply")["properties"]


def test_answer_key_never_in_question_item():
    item = read_json(FIXTURES / "question-item" / "valid" / "mcq-diagnostic.json")
    issues = oc.errors("question-item", {**item, "correct_option": "B"})
    assert [i.keyword for i in issues] == ["additionalProperties"]


@pytest.mark.parametrize(("nulls", "ok"), [(0, False), (1, False), (2, True), (3, True), (4, True)])
def test_options_null_rule(nulls, ok):
    item = read_json(FIXTURES / "question-item" / "valid" / "mcq-diagnostic.json")
    tags = [
        "rasyonel.pay-payda-ayri-toplama",
        "rasyonel.payda-esitlemeden-toplama",
        "rasyonel.bolmede-ters-cevirmeme",
        "genel.soruyu-yarim-okuma",
    ]
    for i, opt in enumerate(item["options"]):
        opt["misconception_tag"] = None if i < nulls else tags[i]
    assert oc.is_valid("question-item", item) is ok
