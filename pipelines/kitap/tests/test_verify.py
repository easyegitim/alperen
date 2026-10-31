"""``verify --output``: yalnız Crossref yeniden denetimi (LLM yok); düşen atıf ve ona dayanan paragraf çıkar."""

from __future__ import annotations

import json
import shutil

import ogrenmen_contracts as contracts
import pytest

from conftest import KITAP, QUEUED_1, QUEUED_2, make_rt, only_fixture, read_jsonl, run_cli
from ogrenmen_kitap import bib
from ogrenmen_kitap import pipeline as P
from ogrenmen_kitap.errors import KitapError


def _stored(tmp_path):  # noqa: ANN001
    llm = only_fixture(tmp_path, {"research": "01-spaced-repetition.json"})
    rt = make_rt(tmp_path / "out", llm_options={"root": llm})
    res = P.run_request(rt, QUEUED_1)
    assert res.status == "done"
    return rt, res


def test_verify_removes_unresolved_and_drops_citing_paragraph(tmp_path):
    rt, res = _stored(tmp_path)
    out = res.output
    assert [p["cites"] for p in out["synthesis"]] == [[1, 3], [2, 4]]
    third = next(c for c in out["citations"] if c["ordinal"] == 3)
    assert third["crossref_status"] == "verified"
    rt.doi._missing[third["doi"]] = {"status": 404}
    # kayıtlı BibTeX'in ilk kaydı kitap türünde olsun: verify türü (Crossref ``type``) kaybetmemeli
    record = next(r for r in rt.db.tables["research_outputs"] if str(r["id"]) == res.output_id)
    record["output"]["bibtex"] = record["output"]["bibtex"].replace("@article{", "@book{", 1)
    entries = bib.split_entries(record["output"]["bibtex"])
    assert entries[0].startswith("@book{") and len(entries) == len(out["citations"])
    ordinals = [c["ordinal"] for c in out["citations"]]
    llm_before = len(rt.llm.calls)
    v = P.verify_output(rt, res.output_id)
    assert len(rt.llm.calls) == llm_before          # LLM yok
    assert v.removed == [{"ordinal": 3, "reason": "crossref_unresolved", "title": third["title"]}]
    assert v.paragraphs_dropped == 1 and not v.alert
    contracts.validate("research-output", v.output)
    assert [p["cites"] for p in v.output["synthesis"]] == [[2, 4]]
    assert 3 not in {c["ordinal"] for c in v.output["citations"]}
    assert third["doi"] not in json.dumps(v.output)
    stored = rt.db.select("research_outputs", where={"id": res.output_id})[0]
    assert stored["output"] == v.output and third["doi"] not in stored["bibtex"]
    # kalan kayıtlar metniyle (tür, anahtar) aynen durur; yalnız düşen kayıt silinir
    assert stored["bibtex"] == "".join(e for e, o in zip(entries, ordinals, strict=True) if o != 3)
    assert stored["bibtex"].startswith("@book{")
    assert v.output["apa"] == [a for a, o in zip(out["apa"], ordinals, strict=True) if o != 3]
    row = rt.db.select("citations", where={"output_id": res.output_id, "ordinal": 3})[0]
    assert (row["status"], row["crossref_status"], row["removed_reason"]) == ("removed", "unresolved",
                                                                              "crossref_unresolved")
    assert v.checked == sum(1 for c in out["citations"] if c["crossref_status"] == "verified")


def test_verify_all_removed_opens_ops_alert(tmp_path):
    rt, res = _stored(tmp_path)
    for c in res.output["citations"]:
        if c.get("doi"):
            rt.doi._missing[c["doi"]] = {"status": 404}
    before = rt.db.select("research_outputs", where={"id": res.output_id})[0]["output"]
    v = P.verify_output(rt, res.output_id)
    assert v.alert and v.output["synthesis"] == []
    # şemaya aykırı (boş sentezli) çıktı yazılmaz
    assert rt.db.select("research_outputs", where={"id": res.output_id})[0]["output"] == before
    alerts = rt.db.written("instructor_alerts")
    assert len(alerts) == 1 and alerts[0]["kind"] == "ops" and alerts[0]["ref"] == {}
    assert res.output_id[:8] in alerts[0]["detail"][:24] and len(alerts[0]["detail"]) <= 240
    contracts.validate("instructor-alert", P.alert_contract_view(alerts[0]))
    # aynı çıktı için açık alarm varken ikinci alarm yazılmaz (alerts_dedup çakışması olmaz)
    assert P.open_ops_alert(rt, res.output_id, "2026-10-21T09:00:00Z") is False
    assert len(rt.db.written("instructor_alerts")) == 1


def test_verify_two_outputs_losing_everything_open_two_valid_alerts(tmp_path):
    llm = only_fixture(tmp_path, {"research": "01-spaced-repetition.json"})
    rt = make_rt(tmp_path / "out", llm_options={"root": llm})
    results = P.run_queued(rt, limit=5)
    assert [(r.request_id, r.status) for r in results] == [(QUEUED_1, "done"), (QUEUED_2, "done")]
    for r in results:
        for c in r.output["citations"]:
            if c.get("doi"):
                rt.doi._missing[c["doi"]] = {"status": 404}
    for r in results:
        assert P.verify_output(rt, r.output_id).alert
    alerts = [a for a in rt.db.select("instructor_alerts", where={"kind": "ops", "status": "open"})
              if a["detail"].startswith("Araştırma ")]
    assert len(alerts) == 2 and len(rt.db.written("instructor_alerts")) == 2
    for a, r in zip(sorted(alerts, key=lambda a: a["detail"]),
                    sorted(results, key=lambda r: r.output_id), strict=True):
        assert r.output_id[:8] in a["detail"]
        contracts.validate("instructor-alert", P.alert_contract_view(a))
    # alerts_dedup anahtarı: tür + öğrenci + ref anahtarı + left(detail, 24) — iki alarm farklı
    keys = {(a["kind"], a.get("student_id"), json.dumps(a["ref"]), a["detail"][:24]) for a in alerts}
    assert len(keys) == 2


def test_verify_unknown_output():
    rt = make_rt(None)
    with pytest.raises(KitapError) as exc:
        P.verify_output(rt, "00000000-0000-4000-8000-000000000000")
    assert exc.value.code == "OGR-KITAP-008"


def test_verify_cli_on_stored_fixture(tmp_path, capsys):
    rt, res = _stored(tmp_path)
    rt.close()
    fixtures = tmp_path / "fx"
    shutil.copytree(KITAP, fixtures)
    for table in ("research_outputs", "citations"):
        rows = read_jsonl(tmp_path / "out" / f"{table}.jsonl")
        (fixtures / f"{table}.json").write_text(json.dumps(rows, ensure_ascii=False), encoding="utf-8")
    out = tmp_path / "vout"
    assert run_cli("verify", "--output", res.output_id, "--dry-run", "--fixtures", str(fixtures),
                   "--out", str(out)) == 0
    rep = json.loads((out / "verify_report.json").read_text(encoding="utf-8"))
    assert rep["checked"] >= 1 and rep["removed"] == [] and rep["paragraphs_dropped"] == 0
    updated = read_jsonl(out / "citations.jsonl")
    assert updated and all(set(r) >= {"verified_at", "title_similarity"} for r in updated)
    assert "Yeniden denetim" in capsys.readouterr().out
