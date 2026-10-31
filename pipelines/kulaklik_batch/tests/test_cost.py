"""Maliyet raporu: iki bütçe, defter denetimi (ledger drift → 2), kill-switch; check-spend."""

from __future__ import annotations

import json
import shutil

import pytest
from ogrenmen_common.errors import DbPermissionError, RpcError

from conftest import KULAKLIK, make_rt, run_cli
from ogrenmen_kulaklik import cost as C
from ogrenmen_kulaklik.common import month_window


def test_cost_report_separates_lesson_costs(tmp_path):
    out = tmp_path / "out"
    assert run_cli("cost-report", "--month", "2026-10", "--dry-run", "--fixtures", str(KULAKLIK),
                   "--out", str(out)) == 0
    data = json.loads((out / "cost-report.json").read_text())
    assert data["chat"]["month_usd"] == 3.0
    assert data["lesson"]["month_usd"] == 0.9
    assert data["lesson"]["lessons"] == 2 and data["lesson"]["per_lesson_usd"] == 0.45
    assert data["chat"]["cost_per_student"] == round(3.0 / data["chat"]["active_students"], 4)
    md = (out / "cost-report.md").read_text(encoding="utf-8")
    assert "| Kalem | Sohbet ve toplu işler | Ders analizi |" in md
    assert "| Ay toplamı | 3,00 $ | 0,90 $ |" in md
    # aynı fixture ile pilot ölçütü: lesson_usd ayrı anahtar, öğrenci başına maliyete dahil değil
    assert run_cli("metrics", "--dry-run", "--fixtures", str(KULAKLIK), "--out", str(out)) == 0
    cps = next(json.loads(line) for line in (out / "pilot_metrics.jsonl").read_text().splitlines()
               if json.loads(line)["metric"] == "cost_per_student")
    assert cps["detail"]["lesson_usd"] == 0.9 and cps["detail"]["month_usd"] == 3.0


def test_check_consistent_ledger_exits_zero(tmp_path):
    out = tmp_path / "out"
    assert run_cli("cost-report", "--month", "2026-10", "--check", "--dry-run", "--fixtures", str(KULAKLIK),
                   "--out", str(out)) == 0
    data = json.loads((out / "cost-report.json").read_text())
    assert data["check"]["drift"]["drift"] is False and data["check"]["kill_switch"] is False
    assert "tutarlı" in (out / "cost-report.md").read_text(encoding="utf-8")


def test_check_ledger_drift_exits_two(tmp_path):
    rt = make_rt(tmp_path)
    # tetikleyiciyi atlayan satır: llm_calls toplamı defterden %5'ten fazla ayrışır
    rt.db.seed("llm_calls", {"purpose": "chat", "provider": "gemini-paid", "model": "gemini-2.5-flash-lite",
                             "tokens_in": 1, "tokens_out": 1, "status": "ok", "cost_usd": 0.5,
                             "created_at": "2026-10-19T10:00:00Z"})
    data = C.compute(rt.db, month_window("2026-10"), rt.models)
    check = C.run_check(rt.db, data, rt.clock())
    assert check["drift"]["drift"] is True and check["exit_code"] == 2
    rt.close()


def test_lesson_spend_never_drifts_chat_budget(tmp_path):
    rt = make_rt(tmp_path)
    # created_at batch_worker'ın INSERT yetkisinde yok: geriye tarihli kurulum satırı yönetici rolüyle yazılır
    # (insert, seed'den farklı olarak spend_ledger tetikleyicisini çalıştırır — defter llm_calls'la tutarlı kalır)
    rt.db.role = "postgres"
    try:
        rt.db.insert("llm_calls", {"purpose": "lesson_analysis", "provider": "gemini-paid",
                                   "model": "gemini-2.5-pro", "tokens_in": 1, "tokens_out": 1, "status": "ok",
                                   "cost_usd": 5.0, "ref_table": "lessons",
                                   "ref_id": "00000000-0000-0000-0000-000000000009",
                                   "created_at": "2026-10-19T10:00:00Z"})
    finally:
        rt.db.role = "batch_worker"
    data = C.compute(rt.db, month_window("2026-10"), rt.models)
    assert data["chat"]["month_usd"] == 3.0 and data["lesson"]["month_usd"] == 5.9 and data["lesson"]["lessons"] == 3
    assert C.run_check(rt.db, data, rt.clock())["kill_switch"] is False
    assert rt.db.rpc("check_spend", {"p_purpose": "chat"})[0]["state"] == "normal"
    rt.close()


def test_kill_switch_at_full_monthly_cap(tmp_path):
    rt = make_rt(tmp_path)
    rt.db.role = "postgres"
    rt.db.update("runtime_flags", {"value": 3.0}, where={"key": "monthly_cap_usd"})
    rt.db.role = "batch_worker"
    data = C.compute(rt.db, month_window("2026-10"), rt.models)
    check = C.run_check(rt.db, data, rt.clock())
    assert check["kill_switch"] is True
    assert rt.db.get("runtime_flags", key="paid_llm_enabled")["value"] is False
    rt.close()


def test_kill_switch_refusal_is_not_silent(tmp_path):
    rt = make_rt(tmp_path)

    def refuse(name, params=None):
        raise RpcError("OGR-AUTH-003 bu bayrak batch_worker ile değiştirilemez")

    rt.db.role = "postgres"
    rt.db.update("runtime_flags", {"value": 1.0}, where={"key": "monthly_cap_usd"})
    rt.db.role = "batch_worker"
    data = C.compute(rt.db, month_window("2026-10"), rt.models)
    rt.db.rpc = refuse
    with pytest.raises(RpcError, match="OGR-AUTH-003"):
        C.run_check(rt.db, data, rt.clock())
    rt.close()


def test_check_spend_command(tmp_path):
    assert run_cli("check-spend", "--dry-run", "--fixtures", str(KULAKLIK), "--out", str(tmp_path)) == 0
    rep = json.loads((tmp_path / "check_spend.json").read_text())
    assert rep["purposes"]["nightly_facts"]["state"] == "normal"
    assert rep["purposes"]["lesson_analysis"]["lesson_month_usd"] == 0.9
    assert rep["purposes"]["nightly_facts"]["month_usd"] == 3.0


def test_cli_check_returns_two_on_ledger_drift(tmp_path, capsys):
    folder = tmp_path / "fixtures"
    shutil.copytree(KULAKLIK, folder)
    path = folder / "llm-calls-month.json"
    calls = json.loads(path.read_text(encoding="utf-8"))
    # spend_ledger fixture'ına yansımamış ek çağrı: llm_calls toplamı defterden %5'ten fazla ayrışır
    calls.append(dict(calls[0], id=max(c["id"] for c in calls) + 1, cost_usd=0.5,
                      created_at="2026-10-19T10:00:00Z"))
    path.write_text(json.dumps(calls, ensure_ascii=False), encoding="utf-8")
    out = tmp_path / "out"
    code = run_cli("cost-report", "--month", "2026-10", "--check", "--dry-run", "--fixtures", str(folder),
                   "--out", str(out))
    assert code == C.EXIT_DRIFT == 2
    captured = capsys.readouterr()
    assert "ledger drift" in captured.err
    assert "sohbet ve toplu 3,00 $, ders analizi 0,90 $" in captured.out  # Türkçe biçim (tr_usd)
    md = (out / "cost-report.md").read_text(encoding="utf-8")
    assert "→ ledger drift" in md
    data = json.loads((out / "cost-report.json").read_text())
    assert data["check"]["exit_code"] == 2 and data["check"]["drift"]["drift"] is True


def test_pilot_section_survives_unreadable_pilot_metrics(tmp_path):
    rt = make_rt(tmp_path)
    original = rt.db.select

    def select(table, **kwargs):
        if table == "pilot_metrics":
            raise DbPermissionError("OGR-DB-001 permission denied for table pilot_metrics")
        return original(table, **kwargs)

    rt.db.select = select
    data = C.compute(rt.db, month_window("2026-10"), rt.models, now=rt.clock())
    assert data["pilot_metrics"]["source"] == "yeniden hesaplandı"
    assert len(data["pilot_metrics"]["rows"]) == 8
    assert "yeniden hesaplandı" in C.render(data)
    data2 = C.compute(rt.db, month_window("2026-10"), rt.models)
    assert data2["pilot_metrics"]["source"] == "okunamadı" and "okunamadı (yetki yok)" in C.render(data2)
    rt.close()
