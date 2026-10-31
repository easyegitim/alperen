"""check_spend iki bütçesi (tests/11_spend.sql vakalarının eşleniği), set_runtime_flag, rollup_spend."""

from __future__ import annotations

import pytest

from conftest import as_admin
from ogrenmen_common.errors import RpcError


def _spend(db, purpose, cost, at="2026-10-20T08:00:00Z", provider="gemini-paid"):
    with as_admin(db):  # created_at batch_worker'ın INSERT yetkisinde yok; geçmiş saat yalnız kurulumda verilir
        db.insert("llm_calls", {"purpose": purpose, "provider": provider, "model": "gemini-2.5-pro", "status": "ok",
                                "cost_usd": cost, "created_at": at})


def _gate(db, purpose):
    rows = db.rpc("check_spend", {"p_purpose": purpose})
    assert isinstance(rows, list) and len(rows) == 1
    return rows[0]


def test_dev_seed_baseline(db):
    chat = _gate(db, "chat")
    assert set(chat) == {"paid_allowed", "degraded", "day_usd", "month_usd", "daily_cap", "monthly_cap", "state",
                         "lesson_month_usd", "lesson_cap"}
    assert chat["state"] == "normal" and chat["paid_allowed"] is True
    assert chat["day_usd"] == 0  # 'şimdi' 20 Ekim; tohumdaki son harcama 19 Ekim
    assert chat["month_usd"] == pytest.approx(0.004299, abs=1e-6)  # ders hariç Ekim toplamı
    assert chat["lesson_month_usd"] == pytest.approx(0.2535)
    assert (chat["daily_cap"], chat["monthly_cap"], chat["lesson_cap"]) == (0.8, 24.0, 30.0)


def test_lesson_spend_does_not_change_chat_state(db):
    _spend(db, "lesson_analysis", 5.0)
    chat = _gate(db, "chat")
    assert chat["state"] == "normal" and chat["day_usd"] == 0
    assert chat["lesson_month_usd"] == pytest.approx(5.2535)


def test_lesson_cap_blocks_only_lesson_purposes(db):
    _spend(db, "lesson_analysis", 5.0)
    with as_admin(db):
        db.update("runtime_flags", {"value": 4}, where={"key": "lesson_monthly_cap_usd"})
    assert _gate(db, "lesson_analysis")["paid_allowed"] is False
    assert _gate(db, "transcribe")["paid_allowed"] is False
    chat = _gate(db, "chat")
    assert chat["paid_allowed"] is True and chat["state"] == "normal"


def test_chat_spend_over_daily_cap_gives_free_only(db):
    _spend(db, "chat", 0.90)
    chat = _gate(db, "chat")
    assert chat["state"] == "free_only" and chat["paid_allowed"] is False and chat["day_usd"] == pytest.approx(0.9)
    assert _gate(db, "lesson_analysis")["paid_allowed"] is True  # ders bütçesi ayrı
    assert _gate(db, "nightly_facts")["paid_allowed"] is False


def test_monthly_cap_and_previous_month_excluded(db):
    _spend(db, "nightly_facts", 30.0, at="2026-09-29T10:00:00Z")
    assert _gate(db, "chat")["state"] == "normal"
    _spend(db, "weekly_summary", 24.0, at="2026-10-02T10:00:00Z")
    assert _gate(db, "chat")["state"] == "free_only"


def test_degraded_and_paid_disabled(db):
    with as_admin(db):
        db.update("runtime_flags", {"value": True}, where={"key": "degraded_mode"})
    assert _gate(db, "chat")["state"] == "degraded"
    with as_admin(db):
        db.update("runtime_flags", {"value": False}, where={"key": "degraded_mode"})
        db.update("runtime_flags", {"value": False}, where={"key": "paid_llm_enabled"})
    g = _gate(db, "chat")
    assert g["state"] == "free_only" and g["paid_allowed"] is False
    assert _gate(db, "lesson_analysis")["paid_allowed"] is False


def test_set_runtime_flag_one_way_kill_switch(db):
    db.rpc("set_runtime_flag", {"p_key": "paid_llm_enabled", "p_value": False})
    assert db.tables["runtime_flags"][0]["value"] is False
    with pytest.raises(RpcError, match="OGR-AUTH-003"):
        db.rpc("set_runtime_flag", {"p_key": "paid_llm_enabled", "p_value": True})
    with pytest.raises(RpcError, match="OGR-AUTH-003"):
        db.rpc("set_runtime_flag", {"p_key": "daily_cap_usd", "p_value": 5})
    db.rpc("set_runtime_flag", {"p_key": "facts_lag_days", "p_value": 1})
    assert next(r for r in db.tables["runtime_flags"] if r["key"] == "facts_lag_days")["value"] == 1
    actions = [e["action"] for e in db.tables["audit.events"]]
    assert actions.count("RPC:set_runtime_flag") == 2


def test_rollup_spend_recomputes_from_llm_calls(db):
    led = next(r for r in db.tables["spend_ledger"] if r["day"] == "2026-10-18" and r["purpose"] == "chat")
    led["cost_usd"] = 99.0
    changed = db.rpc("rollup_spend", {})
    assert changed >= 1
    fixed = next(r for r in db.tables["spend_ledger"] if r["day"] == "2026-10-18" and r["purpose"] == "chat")
    expected = sum(c["cost_usd"] for c in db.tables["llm_calls"] if c["purpose"] == "chat"
                   and c["provider"] == "gemini-paid" and c["created_at"].startswith("2026-10-18"))
    assert fixed["cost_usd"] == pytest.approx(expected, abs=1e-6)
    assert db.rpc("rollup_spend", {}) == 0
