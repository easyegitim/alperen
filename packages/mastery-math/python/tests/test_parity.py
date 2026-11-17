"""BKT parite testleri: bkt-vectors.json (41 vektör) Python'da 1e-9 toleransla; canlı DB varsa SQL'de de."""

from __future__ import annotations

import json
import math
import os
import shutil
import subprocess
from pathlib import Path

import pytest

from ogrenmen_mastery import (
    NUMERIC_GUESS,
    P_MAX,
    P_MIN,
    MasteryMathError,
    bkt_step,
    bktStep,
    blend_step,
    inferred_guess,
    observation_step,
)

ROOT = Path(__file__).resolve().parents[2]
DOC = json.loads((ROOT / "fixtures" / "bkt-vectors.json").read_text(encoding="utf-8"))
VECTORS = DOC["vectors"]
TOL = 1e-9

BLUEPRINT_FIRST_NINE = [
    ("bkt", 0.30, 0.6460674157),
    ("bkt", 0.30, 0.8967213115),
    ("bkt", 0.30, 0.1486486486),
    ("bkt", 0.70, 0.9042553191),
    ("bkt", 0.70, 0.3135593220),
    ("inferred", 0.30, 0.1923076923),
    ("blend", 0.30, 0.4200000000),
    ("bkt", 0.99, 0.9900000000),
    ("bkt", 0.01, 0.1012104909),
]


def compute(v: dict) -> float:
    if v["method"] == "blend":
        return blend_step(v["p"], v["m"], v["c"])
    if v["method"] == "inferred":
        return bkt_step(v["p"], False, v["g"], v["s"], v["t"])
    return bkt_step(v["p"], v["correct"], v["g"], v["s"], v["t"])


def test_vector_count_and_ids():
    assert len(VECTORS) == 41
    assert [v["id"] for v in VECTORS] == list(range(1, 42))
    assert DOC["tolerance"] == 1e-9


def test_g_column_explicit_and_numeric_row_present():
    for v in VECTORS:
        assert "g" in v
        if v["method"] == "blend":
            assert v["g"] is None
        else:
            assert isinstance(v["g"], float)
    numeric = [v for v in VECTORS if v["method"] == "bkt" and v["g"] == NUMERIC_GUESS]
    assert numeric, "g=0.05 satırı yok"
    assert all(v["guess_override"] == NUMERIC_GUESS for v in numeric)


def test_first_nine_match_blueprint_table():
    for (method, p, expected), v in zip(BLUEPRINT_FIRST_NINE, VECTORS[:9], strict=True):
        assert v["method"] == method
        assert v["p"] == p
        assert abs(v["expected"] - expected) < 1e-10


@pytest.mark.parametrize("v", VECTORS, ids=[f"{v['id']}-{v['method']}" for v in VECTORS])
def test_vector(v):
    if v["method"] == "inferred":
        assert abs(inferred_guess(v["g_base"], v["w"]) - v["g"]) < TOL
    got = compute(v)
    assert abs(got - v["expected"]) < TOL
    assert P_MIN <= got <= P_MAX


def test_ts_alias_names():
    assert bktStep is bkt_step
    assert abs(bktStep(0.3, True, 0.25, 0.1, 0.1) - 0.6460674157) < 1e-9


def test_errors():
    with pytest.raises(MasteryMathError, match="OGR-MAST-003"):
        bkt_step(0.0, True, 0.0, 0.1, 0.1)
    with pytest.raises(MasteryMathError, match="OGR-MAST-003"):
        bkt_step(math.nan, True, 0.25, 0.1, 0.1)
    with pytest.raises(MasteryMathError, match="OGR-MAST-003"):
        blend_step(0.3, math.inf, 0.8)


SKILL = {"p_guess": 0.25, "p_slip": 0.1, "p_learn": 0.1}


def test_observation_step_binary_mcq_and_numeric():
    r = observation_step(0.3, {"kind": "diagnostic", "value": 1}, SKILL)
    assert r.method == "bkt" and r.evidence_increment == 1
    assert abs(r.p - 0.6460674157) < 1e-9
    assert r.params["g"] == 0.25 and r.params["guess_override"] is None
    r = observation_step(0.3, {"kind": "practice", "value": 1, "guess_override": 0.05}, SKILL)
    assert abs(r.p - 0.8967213115) < 1e-9 and r.params["g"] == 0.05


def test_observation_step_not_first_attempt():
    r = observation_step(0.3, {"kind": "practice", "value": 0, "counts_for_mastery": False}, SKILL)
    assert r.evidence_increment == 0
    assert abs(r.p - 0.1486486486) < 1e-9


def test_observation_step_chat_does_not_change_anything():
    for kind in ("chat_question", "chat_misconception"):
        r = observation_step(0.3, {"kind": kind, "value": None}, SKILL)
        assert (r.p, r.evidence_increment, r.method, r.params) == (0.3, 0, None, {})


def test_observation_step_blend_and_inferred():
    r = observation_step(0.3, {"kind": "lesson", "value": 0.8, "confidence": 0.8}, SKILL)
    assert r.method == "blend" and r.evidence_increment == 1
    assert abs(r.p - 0.42) < 1e-12 and abs(r.params["w"] - 0.24) < 1e-12
    with pytest.raises(MasteryMathError, match="OGR-MAST-003"):
        observation_step(0.3, {"kind": "instructor", "value": None}, SKILL)
    r = observation_step(0.3, {"kind": "inferred", "value": 0, "weight": 0.5}, SKILL)
    assert r.method == "inferred" and r.evidence_increment == 0
    assert abs(r.params["g_eff"] - 0.625) < 1e-12
    assert abs(r.p - 0.1923076923) < 1e-9


def test_observation_step_unknown_kind():
    with pytest.raises(MasteryMathError, match="OGR-MAST-001"):
        observation_step(0.3, {"kind": "weird", "value": 1}, SKILL)


def test_sql_file_has_functions_and_no_copy_markers():
    sql = (ROOT / "sql" / "bkt.sql").read_text(encoding="utf-8")
    for name in ("app.bkt_step(", "app.blend_step(", "app.inferred_guess("):
        assert f"create or replace function {name}" in sql
    assert "-- begin bkt" not in sql and "-- end bkt" not in sql


def _sql_literal(x):
    if x is None:
        return "null"
    if isinstance(x, bool):
        return "true" if x else "false"
    return repr(float(x)) + "::numeric"


@pytest.mark.skipif(
    not os.environ.get("OGRENMEN_DATABASE_URL") or shutil.which("psql") is None,
    reason="SKIP: no database (OGRENMEN_DATABASE_URL yok ya da psql kurulu değil)",
)
def test_sql_parity_live_database():
    """bkt.sql'i geri alınan bir işlemde yükler ve 41 vektörü SQL'de hesaplar."""
    selects = []
    for v in VECTORS:
        p = _sql_literal(v["p"])
        if v["method"] == "blend":
            expr = f"app.blend_step({p}, {_sql_literal(v['m'])}, {_sql_literal(v['c'])})"
        elif v["method"] == "inferred":
            g = f"app.inferred_guess({_sql_literal(v['g_base'])}, {_sql_literal(v['w'])})"
            expr = f"app.bkt_step({p}, false, {g}, {_sql_literal(v['s'])}, {_sql_literal(v['t'])})"
        else:
            expr = (
                f"app.bkt_step({p}, {_sql_literal(v['correct'])}, {_sql_literal(v['g'])}, "
                f"{_sql_literal(v['s'])}, {_sql_literal(v['t'])})"
            )
        selects.append(f"select {v['id']} as id, ({expr})::text as r")
    script = "\n".join(
        [
            "\\set ON_ERROR_STOP 1",
            "begin;",
            "create schema if not exists app;",
            (ROOT / "sql" / "bkt.sql").read_text(encoding="utf-8"),
            "\\pset format unaligned",
            "\\pset tuples_only on",
            " union all ".join(selects) + " order by id;",
            "select 'null-check', coalesce(app.bkt_step(0, true, 0, 0.1, 0.1)::text, 'NULL');",
            "rollback;",
        ]
    )
    out = subprocess.run(
        ["psql", os.environ["OGRENMEN_DATABASE_URL"], "-X", "-q", "-f", "-"],
        input=script,
        capture_output=True,
        text=True,
        check=True,
        timeout=60,
    ).stdout
    rows = [line.split("|") for line in out.splitlines() if "|" in line]
    got = {r[0]: r[1] for r in rows}
    for v in VECTORS:
        assert abs(float(got[str(v["id"])]) - v["expected"]) < TOL, v
    assert got["null-check"] == "NULL"
