"""v2 check_spend (supabase/tests/11_spend.sql vakalarının eşleniği), set_runtime_flag, log_llm_call."""

from __future__ import annotations

import pytest

from ogrenmen_common.errors import RpcError


def _spend(db, purpose, cost, at="2026-10-20T08:00:00Z", provider="gemini-paid", student_ref=None):
    db.insert("llm_calls", {"purpose": purpose, "provider": provider, "model": "gemini-2.5-pro", "status": "ok",
                            "cost_usd": cost, "created_at": at, "student_ref": student_ref})


def _gate(db, purpose, student_ref=None):
    rows = db.rpc("check_spend", {"p_purpose": purpose, "p_student_ref": student_ref})
    assert isinstance(rows, list) and len(rows) == 1
    return rows[0]


def _flag(db, key, value):
    db.update("runtime_flags", {"value": value}, where={"key": key})


def test_dev_seed_baseline(db):
    chat = _gate(db, "chat")
    assert set(chat) == {"paid_allowed", "degraded", "downgrade", "state", "day_usd", "month_usd", "daily_cap",
                         "monthly_cap", "student_month_usd", "student_cap", "alert_level"}
    assert chat["state"] == "normal" and chat["paid_allowed"] is True and chat["downgrade"] is False
    assert chat["day_usd"] == 0  # 'şimdi' 20 Ekim; tohumdaki son harcama 19 Ekim
    assert chat["month_usd"] == pytest.approx(0.257799, abs=1e-6)  # Ekim toplamı (ders dahil)
    assert (chat["daily_cap"], chat["monthly_cap"]) == (0.8, 24.0)


def test_student_param_is_optional(db):
    assert db.rpc("check_spend", {"p_purpose": "chat"})[0] == _gate(db, "chat")


def test_over_daily_cap_downgrades_but_does_not_block(db):
    _spend(db, "chat", 0.90)
    chat = _gate(db, "chat")
    assert chat["state"] == "soft_cap" and chat["downgrade"] is True and chat["paid_allowed"] is True
    assert chat["day_usd"] == pytest.approx(0.9)
    assert chat["alert_level"] == 1.0
    assert _gate(db, "lesson_analysis")["downgrade"] is False  # cap_excluded_purposes tavana takılmaz


def test_monthly_cap_and_previous_month_excluded(db):
    _spend(db, "nightly_facts", 30.0, at="2026-09-29T10:00:00Z")
    assert _gate(db, "chat")["state"] == "normal"
    _spend(db, "weekly_summary", 24.0, at="2026-10-02T10:00:00Z")
    g = _gate(db, "chat")
    assert g["state"] == "soft_cap" and g["downgrade"] is True


def test_student_monthly_cap(db):
    db.insert("runtime_flags", {"key": "student_monthly_cap_usd", "value": 0.8})
    base = _gate(db, "coach", "s_qk7m2rx4tn5a")["student_month_usd"]  # tohumdaki Ekim harcaması
    assert base < 0.8 and _gate(db, "coach", "s_qk7m2rx4tn5a")["downgrade"] is False
    _spend(db, "coach", 0.6, student_ref="s_qk7m2rx4tn5a")
    g = _gate(db, "coach", "s_qk7m2rx4tn5a")
    assert g["state"] == "student_cap" and g["downgrade"] is True
    assert g["student_month_usd"] == pytest.approx(base + 0.6, abs=1e-5)
    other = _gate(db, "coach", "s_baska0000000")
    assert other["downgrade"] is False and other["student_month_usd"] == 0


def test_degraded_and_paid_disabled(db):
    _flag(db, "degraded_mode", True)
    g = _gate(db, "chat")
    assert g["state"] == "degraded" and g["degraded"] is True and g["paid_allowed"] is False
    _flag(db, "degraded_mode", False)
    _flag(db, "paid_llm_enabled", False)
    g = _gate(db, "chat")
    assert g["state"] == "disabled" and g["paid_allowed"] is False
    assert _gate(db, "lesson_analysis")["paid_allowed"] is False


def test_set_runtime_flag_upserts_and_audits(db):
    db.rpc("set_runtime_flag", {"p_key": "paid_llm_enabled", "p_value": False})
    assert next(r for r in db.tables["runtime_flags"] if r["key"] == "paid_llm_enabled")["value"] is False
    db.rpc("set_runtime_flag", {"p_key": "yeni_bayrak", "p_value": {"a": 1}})
    assert next(r for r in db.tables["runtime_flags"] if r["key"] == "yeni_bayrak")["value"] == {"a": 1}
    assert [e["action"] for e in db.tables["audit.events"]].count("runtime_flag.set") == 2
    with pytest.raises(RpcError, match="OGR-FLAG-001"):
        db.rpc("set_runtime_flag", {"p_key": " ", "p_value": 1})
    db.role = "authenticated"
    with pytest.raises(RpcError, match="OGR-AUTH-002"):
        db.rpc("set_runtime_flag", {"p_key": "daily_cap_usd", "p_value": 99})


def test_log_llm_call_writes_ledger_row_and_rolls_up(db):
    before = max(r["id"] for r in db.tables["llm_calls"])
    new_id = db.rpc("log_llm_call", {"p_call": {
        "route": "coach.chat", "purpose": "coach", "model": "claude-haiku-4-5", "status": "ok", "tokens_in": 10,
        "cache_read_tokens": 5, "cost_usd": 0.002, "student_ref": "s_qk7m2rx4tn5a"}})
    assert new_id == before + 1
    row = db.get("llm_calls", id=new_id)
    assert row["provider"] == "anthropic" and row["route"] == "coach.chat" and row["cache_read_tokens"] == 5
    assert any(r["purpose"] == "coach" and r["provider"] == "anthropic" for r in db.tables["spend_ledger"])
    with pytest.raises(RpcError, match="OGR-LLM-001"):
        db.rpc("log_llm_call", {"p_call": {"purpose": "coach"}})
