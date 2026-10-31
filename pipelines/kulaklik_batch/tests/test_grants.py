"""Canlı yetki taklidi: tüm komutlar ``batch_worker``'ın grants_matrix.json sütun yetkileriyle çalışır.

``GrantedDb`` (tests/grants.py) JsonlDb'nin denetlemediği sütun düzeyi SELECT/INSERT yetkisini ve PostgREST'in
``RETURNING *`` davranışını uygular; burada her komut bu veritabanıyla uçtan uca koşar ve hiçbir ret olmamalıdır.
"""

from __future__ import annotations

import json

import pytest
from ogrenmen_common import runtime as runtime_module
from ogrenmen_common.errors import DbPermissionError

from conftest import KULAKLIK, make_rt, read_jsonl, run_cli
from grants import GrantedDb, enforce, grant
from ogrenmen_kulaklik import alerts as A
from ogrenmen_kulaklik import facts as F
from ogrenmen_kulaklik import pilot as P
from ogrenmen_kulaklik.common import week_window


@pytest.fixture
def granted(monkeypatch):
    """CLI'nin kurduğu sahte Runtime'ın veritabanı ``GrantedDb`` olur."""
    monkeypatch.setattr(runtime_module, "JsonlDb", GrantedDb)


def test_double_rejects_what_live_postgres_rejects(tmp_path):
    rt = make_rt(tmp_path)
    db = enforce(rt.db)
    with pytest.raises(DbPermissionError):
        db.select("messages", columns=("id", "expires_at"))
    with pytest.raises(DbPermissionError):
        db.select("staff")  # yalnız (id, role)
    with pytest.raises(DbPermissionError):
        db.select("pilot_metrics")  # w u, SELECT yok
    with pytest.raises(DbPermissionError):
        db.insert("instructor_alerts", {"kind": "ops", "severity": "warning", "detail": "x", "status": "open"})
    with pytest.raises(DbPermissionError):
        db.update("messages", {"is_question": True}, where={"id": 27})  # RETURNING * → text_raw
    db.update_minimal("messages", {"is_question": True}, where={"id": 27})
    rt.close()


def test_open_alerts_within_grants(tmp_path):
    rt = make_rt(tmp_path)
    db = enforce(rt.db)
    rep = A.open_alerts(db, rt.clock())
    assert rep.opened > 0 and not rep.rejected
    assert db.denials == []  # status gönderilmez (varsayılan 'open'), expires_at okunmaz
    assert all(r["status"] == "open" for r in db.select("instructor_alerts", where={"status": "open"}))
    rt.close()


def test_pilot_write_falls_back_to_plain_insert(tmp_path):
    rt = make_rt(tmp_path)
    db = enforce(rt.db)
    now = rt.clock()
    # dev-seed'de 2026-10-12 dönemi zaten var: upsert yetkisi yok → düz ekleme → hepsi "zaten yazılmış"
    rows = P.compute(db, week_window(None, now))
    assert all(not (r["detail"] or {}).get("unavailable") for r in rows)
    rep = P.write(db, rows, now)
    assert rep["mode"] == "insert" and rep["written"] == 0 and len(rep["already_written"]) == 8
    assert not rep["errors"]
    # yeni dönem yazılır
    fresh = P.compute(db, week_window(week_window(None, now).end, now))
    rep2 = P.write(db, fresh, now)
    assert rep2["written"] == 8 and not rep2["already_written"]
    rt.close()


def test_facts_within_grants(tmp_path):
    from ogrenmen_kulaklik.fixture_llm import install

    rt = make_rt(tmp_path)
    db = enforce(rt.db)
    F.reembed(rt, missing=True)
    install(rt, KULAKLIK)
    rep = F.run_facts(rt, F.date(2026, 10, 18))
    assert rep.inserted == 8 and db.denials == []
    rt.close()


def test_all_commands_run_with_batch_worker_grants(granted, tmp_path, capsys):
    out = tmp_path / "out"
    common = ("--dry-run", "--fixtures", str(KULAKLIK), "--out")
    assert run_cli("facts", "--day", "2026-10-18", *common, str(out / "facts")) == 0
    assert all(r["source_message_ids"] for r in read_jsonl(out / "facts" / "memory_facts.jsonl"))
    assert run_cli("summaries", "--week", "2026-10-13", *common, str(out / "summaries")) == 0
    assert run_cli("metrics", "--gate", *common, str(out / "metrics")) == 0
    report = json.loads((out / "metrics" / "metrics_report.json").read_text())
    assert report["pilot_metrics_write"]["mode"] == "insert"
    assert len(report["pilot_metrics_write"]["already_written"]) == 8
    gate = (out / "metrics" / "pilot_gate.md").read_text(encoding="utf-8")
    assert gate.rstrip().endswith("Kapı: KAPALI")
    assert run_cli("cost-report", "--month", "2026-10", "--check", *common, str(out / "cost")) == 0
    md = (out / "cost" / "cost-report.md").read_text(encoding="utf-8")
    assert "yeniden hesaplandı" in md and "## Pilot ölçütleri (dönem 2026-10-12)" in md
    assert run_cli("review-sample", "--week", "2026-10-13", *common, str(out / "review")) == 0
    assert run_cli("retention", "--report", *common, str(out / "retention")) == 0
    assert run_cli("check-spend", *common, str(out / "spend")) == 0
    assert run_cli("reembed", "--missing", *common, str(out / "reembed")) == 0
    assert "permission denied" not in capsys.readouterr().err


def test_static_message_columns_within_grant():
    granted_cols = set(grant("messages", "select"))
    assert set(F.MESSAGE_COLUMNS) <= granted_cols
    assert "expires_at" not in granted_cols and "text_raw" not in granted_cols
    assert set(grant("instructor_alerts", "insert")) == {"detail", "kind", "ref", "severity", "since", "staff_id",
                                                         "student_id"}
    assert grant("pilot_metrics", "select") is None  # README "Sapma notları": upsert için SELECT gerekir


def test_upstream_tolerances_are_only_the_reported_ones():
    from grants import UPSTREAM_TOLERATED

    # yalnız M05 CostLedger.record'un llm_calls.created_at'i (README "Sapma notları"); M07 kodu için istisna yok
    assert UPSTREAM_TOLERATED == {("llm_calls", "insert"): frozenset({"created_at"})}
    assert "created_at" not in grant("llm_calls", "insert")
