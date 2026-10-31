"""Pilot kapısı (``metrics --gate``): eşikler settings.pilot_gate'ten, NO_DATA kapıyı açmaz."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from conftest import KULAKLIK, make_rt, run_cli
from ogrenmen_kulaklik import gate as G
from ogrenmen_kulaklik import pilot as P
from ogrenmen_kulaklik.common import KulaklikError, week_window

ALL_PASS = [
    {"metric": "question_accuracy", "period": "2026-10-12", "value": 0.95, "detail": {"n": 40}},
    {"metric": "diagnostic_agreement", "period": "2026-10-12", "value": 0.7, "detail": {"n": 12}},
    {"metric": "citation_relevance", "period": "2026-10-12", "value": None, "detail": {"n_rated": 0}},
    {"metric": "priority_uplift", "period": "2026-10-12", "value": None, "detail": {}},
    {"metric": "cost_per_student", "period": "2026-10-12", "value": 0.05, "detail": {}},
    {"metric": "flagged_response_share", "period": "2026-10-12", "value": 0.02, "detail": {"n": 300}},
    {"metric": "degraded_share", "period": "2026-10-12", "value": 0.01, "detail": {"n": 300}},
]
CI_OK = {"isolation_tests": "pass", "key_leak_tests": "pass"}


def thresholds(tmp_path):
    rt = make_rt(tmp_path)
    t = G.load_thresholds(rt.db)
    rt.close()
    return t


def test_gate_requires_all_required_metrics(tmp_path):
    assert run_cli("metrics", "--gate", "--dry-run", "--fixtures", str(KULAKLIK), "--out", str(tmp_path)) == 0
    md = (tmp_path / "pilot_gate.md").read_text(encoding="utf-8")
    assert md.rstrip().endswith("Kapı: KAPALI")
    data = json.loads((tmp_path / "pilot_gate.json").read_text())
    rows = {r["metric"]: r for r in data["rows"]}
    assert data["gate"] == "KAPALI"
    qa = rows["question_accuracy"]
    assert qa["verdict"] == "NO_DATA" and qa["n"] == 11 and qa["value"] == 0.7273  # 8/11, n < 30
    assert rows["citation_relevance"]["verdict"] == "NO_DATA" and rows["citation_relevance"]["required"] is False
    assert rows["isolation_tests"]["verdict"] == "NO_DATA"  # --ci-status verilmedi
    assert list(rows) == list(thresholds(tmp_path))  # satır sırası settings.pilot_gate sırası


def test_informational_metric_does_not_affect_decision(tmp_path):
    result = G.evaluate(thresholds(tmp_path), ALL_PASS, CI_OK)
    rows = {r.metric: r for r in result.rows}
    assert rows["citation_relevance"].verdict == "NO_DATA" and not rows["citation_relevance"].required
    assert result.open and result.label == "AÇIK"
    assert G.render_markdown(result).rstrip().endswith("Kapı: AÇIK")


def test_no_data_keeps_gate_closed(tmp_path):
    t = thresholds(tmp_path)
    assert not G.evaluate(t, ALL_PASS, {}).open  # CI satırları NO_DATA
    small = [dict(m, detail={"n": 20}) if m["metric"] == "question_accuracy" else m for m in ALL_PASS]
    res = G.evaluate(t, small, CI_OK)
    assert not res.open and {r.metric: r.verdict for r in res.rows}["question_accuracy"] == "NO_DATA"
    missing = [m for m in ALL_PASS if m["metric"] != "degraded_share"]
    assert not G.evaluate(t, missing, CI_OK).open
    null_value = [dict(m, value=None) if m["metric"] == "cost_per_student" else m for m in ALL_PASS]
    assert not G.evaluate(t, null_value, CI_OK).open


def test_fail_and_ci_fail_close_gate(tmp_path):
    t = thresholds(tmp_path)
    costly = [dict(m, value=0.11) if m["metric"] == "cost_per_student" else m for m in ALL_PASS]
    res = G.evaluate(t, costly, CI_OK)
    assert not res.open and {r.metric: r.verdict for r in res.rows}["cost_per_student"] == "FAIL"
    assert not G.evaluate(t, ALL_PASS, {"isolation_tests": "pass", "key_leak_tests": "fail"}).open


def test_latest_period_is_used(tmp_path):
    old = [dict(m, period="2026-10-05", value=0.0) for m in ALL_PASS]
    res = G.evaluate(thresholds(tmp_path), old + ALL_PASS, CI_OK)
    assert res.period == "2026-10-12" and res.open


def test_thresholds_read_from_settings(tmp_path):
    rt = make_rt(tmp_path)
    rt.db.role = "postgres"
    custom = {"question_accuracy": {"min": 0.7, "n_min": 10}, "flagged_response_share": {"max": 0.2},
              "degraded_share": {"max": 0.2}}
    rt.db.update("settings", {"value": custom}, where={"key": "pilot_gate"})
    rt.db.role = "batch_worker"
    P.write(rt.db, P.compute(rt.db, week_window(None, rt.clock())), rt.clock())
    res = G.evaluate(G.load_thresholds(rt.db), rt.db.select("pilot_metrics"))
    assert [r.metric for r in res.rows] == list(custom)
    assert all(r.verdict == "PASS" for r in res.rows)  # 0,7273 ≥ 0,70 (n=11 ≥ 10); 0,13 ≤ 0,2; 0,17 ≤ 0,2
    assert res.open
    rt.db.role = "postgres"
    rt.db.delete("settings", where={"key": "pilot_gate"})
    rt.db.role = "batch_worker"
    with pytest.raises(KulaklikError, match="OGR-KLK-020"):
        G.load_thresholds(rt.db)
    rt.close()


def test_ci_status_flag(tmp_path):
    ci = tmp_path / "ci.json"
    ci.write_text(json.dumps(CI_OK))
    out = tmp_path / "out"
    assert run_cli("metrics", "--gate", "--ci-status", str(ci), "--dry-run", "--fixtures", str(KULAKLIK),
                   "--out", str(out)) == 0
    rows = {r["metric"]: r for r in json.loads((out / "pilot_gate.json").read_text())["rows"]}
    assert rows["isolation_tests"]["verdict"] == "PASS" and rows["key_leak_tests"]["verdict"] == "PASS"
    with pytest.raises(KulaklikError, match="OGR-KLK-021"):
        G.load_ci_status('{"isolation_tests": "yeşil"}')


CASES = json.loads((Path(__file__).parent / "gate-cases.json").read_text(encoding="utf-8"))["cases"]


@pytest.mark.parametrize("case", CASES, ids=[c["name"] for c in CASES])
def test_shared_gate_cases(case):
    if "error" in case:
        with pytest.raises(KulaklikError, match=case["error"]):
            G.evaluate(case["thresholds"], case["metrics"], case["ci_status"])
        return
    result = G.evaluate(case["thresholds"], case["metrics"], case["ci_status"])
    verdicts = {r.metric: r.verdict for r in result.rows}
    assert result.label == case["expected"]["gate"]
    for metric, verdict in case["expected"]["verdicts"].items():
        assert verdicts[metric] == verdict, metric
    assert G.render_markdown(result).rstrip().endswith(f"Kapı: {case['expected']['gate']}")


@pytest.mark.parametrize("bad", [{"question_accuracy": {"mn": 0.9, "n_min": 30}},
                                 {"degraded_share": {"max": "0.05"}},
                                 {"degraded_share": {}}])
def test_malformed_settings_stop_gate_cli(tmp_path, bad):
    rt = make_rt(tmp_path)
    rt.db.role = "postgres"
    rt.db.update("settings", {"value": bad}, where={"key": "pilot_gate"})
    rt.db.role = "batch_worker"
    with pytest.raises(KulaklikError, match="OGR-KLK-020"):
        G.load_thresholds(rt.db)
    rt.close()


def test_gate_uses_freshly_computed_rows(tmp_path):
    out = tmp_path / "out"
    # --week 2026-10-20: dönem 2026-10-19 (dev-seed'de yalnız 2026-10-12 var); kapı az önce hesaplananı değerlendirir
    assert run_cli("metrics", "--gate", "--week", "2026-10-20", "--dry-run", "--fixtures", str(KULAKLIK),
                   "--out", str(out)) == 0
    data = json.loads((out / "pilot_gate.json").read_text())
    assert data["period"] == "2026-10-19"
    computed = {r["metric"]: r["value"] for r in json.loads((out / "metrics_report.json").read_text())["pilot_metrics"]}
    for row in data["rows"]:
        if row["metric"] in computed and computed[row["metric"]] is not None:
            assert row["value"] == computed[row["metric"]]
