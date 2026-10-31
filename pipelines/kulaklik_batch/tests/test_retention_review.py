"""Saklama raporu ve dışa aktarım; işaretli cevap örneklemi."""

from __future__ import annotations

import json

from conftest import KULAKLIK, STUDENT_A, STUDENT_B, make_rt, read_jsonl, run_cli
from ogrenmen_kulaklik import review as V
from ogrenmen_kulaklik.common import select_window, week_window


def test_retention_report_runs_jobs(tmp_path):
    assert run_cli("retention", "--report", "--dry-run", "--fixtures", str(KULAKLIK), "--out", str(tmp_path)) == 0
    rep = json.loads((tmp_path / "retention_report.json").read_text())
    assert {r["policy_id"] for r in rep["runs"]} >= {"messages.hard_delete", "memory_facts.stale",
                                                      "students.anonymize"}
    assert rep["total_bytes"] > 0
    md = (tmp_path / "retention-report.md").read_text(encoding="utf-8")
    assert md.startswith("# Saklama raporu") and "Depolama silme kuyruğu" in md
    assert (tmp_path / "retention_runs.jsonl").is_file()


def test_export_md_matches_policies(tmp_path):
    target = tmp_path / "gen" / "saklama-sureleri.md"
    assert run_cli("retention", "--export-md", str(target), "--dry-run", "--fixtures", str(KULAKLIK),
                   "--out", str(tmp_path / "out")) == 0
    md = target.read_text(encoding="utf-8")
    assert "Bu gruptaki mesajlar Öğrenmen tarafından kaydedilir ve 90 gün sonra silinir." in md
    assert "| `memory_facts.stale` |" in md and "Hafıza olguları 180 gün sonra silinir." in md
    assert "`prompt_text`" in md  # null_columns
    assert "{days}" not in md
    assert not (tmp_path / "out" / "retention_runs.jsonl").exists()  # yalnız dışa aktarım: işler çalışmaz


def test_review_sample_flagged_plus_twenty(tmp_path):
    rt = make_rt(tmp_path)
    for i in range(40):
        rt.db.seed("bot_responses", {"id": 1000 + i, "chat_id": 700000002, "student_id": STUDENT_B,
                                     "purpose": "chat", "prompt_text": f"İstem {i}. Bana 0532 123 45 67'den ulaş.",
                                     "response_text": "Kısa cevap.", "flagged": False, "cost_usd": 0.0002,
                                     "created_at": "2026-10-16T12:00:00Z"})
    week = week_window(None, rt.clock())
    rep, md = V.run_review(rt, week)
    assert len(rep.flagged) == 4 and len(rep.sampled) == 20
    assert set(rep.flagged).isdisjoint(rep.sampled)
    rows = select_window(rt.db, "bot_responses", "created_at", week)
    again = V.pick(rows, week.start.isoformat())
    assert [int(r["id"]) for r in again[1]] == rep.sampled  # deterministik tohum (hafta başlangıcı)
    updated = {int(r["id"]) for r in rt.db.written("bot_responses")}
    assert updated == set(rep.flagged) | set(rep.sampled)
    assert all(r["review_week"] == "2026-10-13" for r in rt.db.written("bot_responses"))
    assert STUDENT_B not in md and STUDENT_A not in md and "0532" not in md
    rt.close()


def test_review_sample_cli_writes_markdown(tmp_path):
    assert run_cli("review-sample", "--dry-run", "--fixtures", str(KULAKLIK), "--out", str(tmp_path)) == 0
    md = (tmp_path / "review-2026-10-13.md").read_text(encoding="utf-8")
    assert md.startswith("# İşaretli cevap örneklemi")
    assert md.count("İşaret nedeni:") == 4
    rows = read_jsonl(tmp_path / "bot_responses.jsonl")
    assert len(rows) == 24 and all(r["review_week"] == "2026-10-13" for r in rows)
    first = V.pick(read_jsonl(tmp_path / "bot_responses.jsonl"), "2026-10-13")
    assert len(first[0]) == 4
