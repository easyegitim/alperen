"""register_answer_key ve register_template_question eşlenikleri (tests/03_answer_keys.sql, §3.9)."""

from __future__ import annotations

import copy

import pytest

from conftest import as_admin, seed_json
from ogrenmen_common.errors import RpcError

SEED = seed_json("db/dev-seed.json")
CUR = "7a988b84-8937-5242-8c35-ddbc4ea9216d"
OPTIONS = [{"key": "A", "text": "7/8", "misconception_tag": None},
           {"key": "B", "text": "4/12", "misconception_tag": "rasyonel.pay-payda-ayri-toplama"},
           {"key": "C", "text": "1", "misconception_tag": None},
           {"key": "D", "text": "5/8", "misconception_tag": None}]


def _key(db, qid):
    with as_admin(db):
        rows = db.select("secure.answer_keys", where={"question_id": qid})
    return rows[0] if rows else None


def _new_llm_question(db, kind="mcq", h="h1"):
    row = {"curriculum_id": CUR, "skill_ids": ["tyt.mat.temel.rasyonel-sayilar"], "kind": kind,
           "stem": "3/4 + 1/8 toplamı kaçtır?", "source": "llm", "content_hash": h, "status": "draft"}
    if kind == "mcq":
        row["options"] = copy.deepcopy(OPTIONS)
    return db.insert("questions", row)[0]["id"]


def test_seed_key_is_locked(db):
    diag = next(q for q in SEED["questions"] if q["source"] == "diagnostic")
    before = copy.deepcopy(_key(db, diag["id"]))
    with pytest.raises(RpcError, match="OGR-KEY-003"):
        db.rpc("register_answer_key", {"p_question": diag["id"], "p_key": {
            "correct_option": "B", "solution": "Yanlış anahtar yazma denemesi.", "sympy_status": "verified"}})
    assert _key(db, diag["id"]) == before


def test_approved_llm_question_is_immutable(db):
    approved = next(q for q in SEED["questions"] if q["source"] == "llm" and q["status"] == "approved")
    with pytest.raises(RpcError, match="OGR-KEY-003"):
        db.rpc("register_answer_key", {"p_question": approved["id"], "p_key": {
            "correct_option": "A", "solution": "Çözüm metni burada.", "sympy_status": "verified"}})


def test_unknown_question_and_bad_status(db):
    with pytest.raises(RpcError, match="OGR-KEY-004"):
        db.rpc("register_answer_key", {"p_question": "00000000-0000-0000-0000-00000000dead", "p_key": {
            "solution": "Çözüm metni burada.", "sympy_status": "verified", "correct_option": "A"}})
    qid = _new_llm_question(db)
    with pytest.raises(RpcError, match="OGR-KEY-002"):
        db.rpc("register_answer_key", {"p_question": qid, "p_key": {"solution": "x" * 12, "sympy_status": "ok"}})


def test_not_applicable_downgraded_to_failed_for_numeric(db):
    qid = _new_llm_question(db, kind="numeric", h="num")
    db.rpc("register_answer_key", {"p_question": qid, "p_key": {
        "numeric_value": "7/8", "solution": "Paydaları eşitle: 6/8 + 1/8.", "sympy_status": "not_applicable"}})
    q = db.get("questions", id=qid)
    assert q["status"] == "rejected" and q["review_note"] == "SymPy doğrulaması başarısız"
    assert q["verification"]["sympy"] == "failed"
    assert _key(db, qid) is None


def test_verbal_mcq_not_applicable_is_unverified(db):
    qid = _new_llm_question(db)
    db.rpc("register_answer_key", {"p_question": qid, "p_key": {
        "correct_option": "A", "solution": "Paydaları eşitleyip topla.", "sympy_status": "not_applicable"}})
    assert _key(db, qid)["written_by"] == "batch_worker:unverified"
    assert db.get("questions", id=qid)["status"] == "pending_review"


def test_verified_key_overwrites_own_key_and_audits_without_value(db):
    qid = _new_llm_question(db)
    for opt in ("C", "A"):
        db.rpc("register_answer_key", {"p_question": qid, "p_key": {
            "correct_option": opt, "canonical_expr": "Rational(3,4)+Rational(1,8)", "numeric_value": "7/8",
            "solution": "3/4 = 6/8; 6/8 + 1/8 = 7/8.", "sympy_status": "verified"}})
    key = _key(db, qid)
    assert key["correct_option"] == "A" and key["written_by"] == "batch_worker:tablet" and key["verified_at"]
    audits = [e for e in db.tables["audit.events"] if e["action"] == "RPC:register_answer_key"]
    assert [a["diff"] for a in audits] == [{"sympy_status": "verified", "had_key": False},
                                           {"sympy_status": "verified", "had_key": True}]
    assert "correct_option" not in str(audits) and "7/8" not in str(audits)


def _template_item(template_id="kesir-modeli-toplama", h="tpl-1", **over):
    item = {"schema_version": "1.0", "curriculum_code": "TYT-MAT@2026.1", "kind": "mcq",
            "skill_ids": ["tyt.mat.temel.rasyonel-sayilar"], "stem": "Şekildeki iki kesrin toplamı kaçtır?",
            "figure": None, "options": copy.deepcopy(OPTIONS), "difficulty": 0.4, "source": "template",
            "template": {"id": template_id, "params": {"a": 3, "b": 4}}, "content_hash": h,
            "verification": {"schema": True, "sympy": "verified", "render": "ok", "vision": "not_applicable",
                             "attempts": 0, "status": "draft"}}
    item.update(over)
    return item


KEY = {"correct_option": "A", "numeric_value": "7/8", "canonical_expr": "Rational(3,4)+Rational(1,8)",
       "solution": "3/4 = 6/8; 6/8 + 1/8 = 7/8.", "sympy_status": "verified"}
FIG = {"code": "# şablon kodu", "code_hash": "fig-hash-1", "alt_text": "İki dikdörtgen kesir modeli yan yana.",
       "png_path": "figures/x.png", "width_px": 800, "height_px": 400, "bytes": 30000}


def test_template_question_approved_through_rpc_only(db):
    qid = db.rpc("register_template_question", {"p_item": _template_item(), "p_key": KEY, "p_figure": FIG})
    q = db.get("questions", id=qid)
    assert q["status"] == "approved" and q["source"] == "template" and q["review_note"] == "şablon: otomatik onay"
    assert q["verification"]["sympy"] == "verified" and "status" not in q["verification"]
    fig = db.get("figures", id=q["figure_id"])
    assert fig["review_status"] == "verified" and fig["vision_status"] == "not_applicable"
    assert _key(db, qid)["written_by"] == "batch_worker:template"
    assert all(w["via"] == "rpc:register_template_question" for w in db.write_log if w["table"] in (
        "questions", "figures"))
    assert db.rpc("register_template_question", {"p_item": _template_item(), "p_key": KEY, "p_figure": FIG}) is None


def test_template_figureless(db):
    item = _template_item("islem-onceligi", h="tpl-2", skill_ids=["tyt.mat.temel.sayilar"])
    qid = db.rpc("register_template_question", {"p_item": item, "p_key": KEY, "p_figure": None})
    assert db.get("questions", id=qid)["figure_id"] is None


@pytest.mark.parametrize("item,key,fig,code", [
    (_template_item(source="llm"), KEY, FIG, "OGR-TPL-001"),
    (_template_item("yok-boyle"), KEY, FIG, "OGR-TPL-002"),
    (_template_item(), {**KEY, "sympy_status": "not_applicable"}, FIG, "OGR-TPL-003"),
    (_template_item(curriculum_code="TYT-MAT@2027.1"), KEY, FIG, "OGR-TPL-004"),
    (_template_item(), KEY, None, "OGR-TPL-005"),
    (_template_item(options=[{**o, "misconception_tag": "rasyonel.pay-payda-ayri-toplama"} if o["key"] != "A" else o
                             for o in OPTIONS]), KEY, FIG, "OGR-Q-002"),
    (_template_item(options=OPTIONS[:3]), KEY, FIG, "OGR-Q-002"),
    (_template_item(skill_ids=["tyt.mat.yok-boyle"]), KEY, FIG, "OGR-CURR-001"),
])
def test_template_rejections_leave_no_writes(db, item, key, fig, code):
    before = {t: len(db.tables[t]) for t in ("questions", "figures", "secure.answer_keys")}
    with pytest.raises(RpcError, match=code):
        db.rpc("register_template_question", {"p_item": item, "p_key": key, "p_figure": fig})
    assert {t: len(db.tables[t]) for t in before} == before


def test_disabled_template(db):
    with as_admin(db):
        db.update("question_templates", {"enabled": False}, where={"id": "kesir-modeli-toplama"})
    with pytest.raises(RpcError, match="OGR-TPL-002"):
        db.rpc("register_template_question", {"p_item": _template_item(), "p_key": KEY, "p_figure": FIG})
