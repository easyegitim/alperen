"""``kinds.py`` tür eşleme tablosu (§6.4) ve tek kaynak kuralı."""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from ogrenmen_common.paths import repo_root

from ogrenmen_kalem import kinds

SRC = Path(__file__).resolve().parents[1] / "src" / "ogrenmen_kalem"


def test_table_matches_blueprint():
    assert [(r.exam_kind, r.plan_kind, r.question_kind) for r in kinds.KIND_TABLE] == [
        ("mc", "çoktan seçmeli", "mcq"),
        ("calc", "hesap", "numeric"),
        ("other", "diğer", "mcq"),
        ("proof", "ispat", None),
    ]


def test_mappings_round_trip():
    for row in kinds.KIND_TABLE:
        assert kinds.plan_kind(row.exam_kind) == row.plan_kind
        assert kinds.exam_kind_of_plan(row.plan_kind) == row.exam_kind
        assert kinds.question_kind(row.exam_kind) == row.question_kind
        assert kinds.question_kind_for_plan(row.plan_kind) == row.question_kind
    assert kinds.variant_allowed("ispat") is False
    assert all(kinds.variant_allowed(k) for k in ("çoktan seçmeli", "hesap", "diğer"))


@pytest.mark.parametrize("raw,expected", [("MC", "mc"), (" calc ", "calc"), ("essay", "other"), (None, "other"),
                                          ("", "other"), ("proof", "proof")])
def test_normalize_exam_kind(raw, expected):
    assert kinds.normalize_exam_kind(raw) == expected


def test_unknown_plan_kind_raises():
    with pytest.raises(KeyError):
        kinds.question_kind_for_plan("deneme")


def test_enums_agree_with_contracts_and_sql():
    schemas = repo_root() / "packages" / "contracts" / "schemas"
    plan = json.loads((schemas / "exam-priority-plan.schema.json").read_text(encoding="utf-8"))
    row_kinds = plan["properties"]["rows"]["items"]["properties"]["kind"]["enum"]
    assert sorted(row_kinds) == sorted(kinds.PLAN_KINDS)
    item = json.loads((schemas / "exam-item.schema.json").read_text(encoding="utf-8"))
    assert sorted(item["properties"]["kind"]["enum"]) == sorted(kinds.EXAM_KINDS)
    sql = (repo_root() / "supabase" / "migrations" / "0009_exams.sql").read_text(encoding="utf-8")
    assert "check (kind in ('proof', 'calc', 'mc', 'other'))" in sql
    gen = json.loads((schemas / "generation-request.schema.json").read_text(encoding="utf-8"))
    qk = gen["properties"]["question_kind"]["oneOf"][1]["enum"]
    assert {k for k in (r.question_kind for r in kinds.KIND_TABLE) if k} == set(qk)


def test_kinds_is_single_source():
    """Plan türü dizeleri yalnız kinds.py'de yazılır (diğer modüller tabloyu kullanır)."""
    for path in sorted(SRC.glob("*.py")):
        if path.name == "kinds.py":
            continue
        text = path.read_text(encoding="utf-8")
        for literal in ('"çoktan seçmeli"', '"hesap"', '"ispat"', '"diğer"', '"numeric"', '"mcq"'):
            assert literal not in text, f"{path.name} {literal} değerini kendisi yazıyor"
