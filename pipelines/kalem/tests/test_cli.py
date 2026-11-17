"""CLI uçtan uca (dry-run): ağ yok, çıktı ``--out``'ta; ortak bayraklar alt komuttan önce ve sonra."""

from __future__ import annotations

import json
import subprocess
import sys

import httpx
import pytest
from ogrenmen_common.fakes import FakeEmbedding
from ogrenmen_pii.scrub import token_hash

from conftest import FIXTURES, KALEM, SOURCE_2022, SOURCE_2023, read_jsonl, run_cli


@pytest.fixture(autouse=True)
def _no_network(monkeypatch):
    def refuse(*args, **kwargs):
        raise AssertionError("dry-run ağa çıkmaz")

    monkeypatch.setattr(httpx.Client, "send", refuse)


def test_nightly_chain_ingest_queue_then_cluster_changed(tmp_path, shared_runtime, capsys):
    """Gece zinciri ``ingest --queue && cluster --changed`` aynı veritabanında (tek Runtime); üçüncü adım SKIP."""
    out = tmp_path / "out"
    common = ("--dry-run", "--fixtures", str(KALEM), "--out", str(out))
    assert run_cli("ingest", "--queue", "--limit", "1", *common) == 0
    assert run_cli("cluster", "--changed", *common) == 0
    assert "DEMO: 5 madde" in capsys.readouterr().out
    assert run_cli("cluster", "--changed", *common) == 0
    assert "SKIP: no changed courses" in capsys.readouterr().out
    shared_runtime.close()
    statuses = {s["id"]: s["status"] for s in read_jsonl(out / "exam_sources.jsonl")}
    assert statuses == {SOURCE_2022: "clustered", SOURCE_2023: "clustered"}
    clusters = read_jsonl(out / "exam_clusters.jsonl")
    assert clusters and sum(c["item_count"] for c in clusters) == 5
    items = read_jsonl(out / "exam_items.jsonl")
    assert len(items) == 5 and all(i["cluster_id"] in {c["id"] for c in clusters} for i in items)


def test_embed_scrubs_names_before_provider(tmp_path, monkeypatch):
    """``embed --name-hashes``: madde metnindeki ad gömme sağlayıcısına gitmez (``FakeEmbedding.embed`` casusu)."""
    fx = tmp_path / "fx"
    fx.mkdir()
    seed = json.loads((FIXTURES / "db" / "dev-seed.json").read_text(encoding="utf-8"))
    items = [dict(i) for i in seed["exam_items"]]
    items[0]["ocr_text"] = "Öğrenci: Zeynep Kaya. " + items[0]["ocr_text"]
    for i in items:
        i["embedding"] = None
    (fx / "exam_items.json").write_text(json.dumps(items, ensure_ascii=False), encoding="utf-8")
    hashes = tmp_path / "hashes.json"
    hashes.write_text(json.dumps([token_hash("Zeynep"), token_hash("Kaya")]), encoding="utf-8")
    sent: list[str] = []
    real_embed = FakeEmbedding.embed

    def spy(self, texts):
        sent.extend(texts)
        return real_embed(self, texts)

    monkeypatch.setattr(FakeEmbedding, "embed", spy)
    out = tmp_path / "out"
    assert run_cli("embed", "--course", "TYT-MAT", "--name-hashes", str(hashes), "--dry-run", "--fixtures", str(fx),
                   "--out", str(out)) == 0
    assert len(sent) == len(items)
    assert not [t for t in sent if "Zeynep" in t or "Kaya" in t]
    assert any(t.startswith("Öğrenci: [AD] [AD].") for t in sent)


def test_embed_and_align_commands(tmp_path, capsys):
    out = tmp_path / "out"
    assert run_cli("--dry-run", "--fixtures", str(KALEM), "--out", str(out), "align", "--course", "DEMO",
                   "--syllabus", str(KALEM / "syllabus.json")) == 0
    assert len(read_jsonl(out / "syllabus_topics.jsonl")) == 9
    rep = json.loads((out / "alignment.json").read_text())
    assert rep["has_syllabus"] and rep["clusters"] == [] and len(rep["uncovered_topics"]) == 9
    out2 = tmp_path / "out2"
    assert run_cli("embed", "--course", "TYT-MAT", "--dry-run", "--out", str(out2)) == 0
    assert json.loads((out2 / "embed_report.json").read_text())["embedded"] == 13


def test_unknown_course_is_one_line_error(tmp_path):
    proc = subprocess.run([sys.executable, "-m", "ogrenmen_kalem", "plan", "--course", "YOK", "--period", "2026",
                           "--dry-run", "--fixtures", str(KALEM), "--out", str(tmp_path / "o")],
                          capture_output=True, text=True, timeout=120)
    assert proc.returncode == 1
    assert proc.stderr.strip() == "HATA: OGR-KALEM-001 ders bulunamadı: YOK"


def test_plan_requires_course_and_period(tmp_path):
    with pytest.raises(SystemExit):
        run_cli("plan", "--period", "2026", "--dry-run", "--out", str(tmp_path / "o"))
