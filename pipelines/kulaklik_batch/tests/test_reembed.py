"""Eksik embedding doldurma (``reembed --missing``) — §6.2 ``test_missing_embeddings_filled``."""

from __future__ import annotations

from ogrenmen_common.fakes.embedding import hash_vector

from conftest import KULAKLIK, make_rt, read_jsonl, run_cli
from ogrenmen_kulaklik.facts import parse_vec, reembed

LESSON_MORALE = KULAKLIK / "lesson-morale.json"


def test_missing_embeddings_filled(tmp_path):
    assert run_cli("reembed", "--missing", "--dry-run", "--fixtures", str(LESSON_MORALE), "--out", str(tmp_path)) == 0
    rows = read_jsonl(tmp_path / "memory_facts.jsonl")
    assert len(rows) == 3  # approve_lesson_analysis'in embedding'siz yazdığı 3 moral olgusu
    for row in rows:
        vec = parse_vec(row["embedding"])
        assert vec is not None and len(vec) == 768
        assert vec == [float(f"{x:.6g}") for x in hash_vector(row["text"])]  # aynı metin → aynı vektör
    calls = read_jsonl(tmp_path / "llm_calls.jsonl")
    assert [c for c in calls if c["purpose"] != "embedding"] == []  # LLM çağrısı 0
    assert len([c for c in calls if c["purpose"] == "embedding" and c["status"] == "ok"]) == 3  # embedding çağrısı 3


def test_missing_skips_already_embedded_and_inactive(tmp_path):
    rt = make_rt(tmp_path)
    first = reembed(rt, missing=True)
    assert first["embedded"] == 15
    rt.db.role = "postgres"
    rt.db.update("memory_facts", {"status": "retracted", "embedding": None}, where={"id": 5})
    rt.db.role = "batch_worker"
    again = reembed(rt, missing=True)
    assert again["selected"] == 0 and again["embedded"] == 0
    full = reembed(rt, missing=False)  # model değişince tüm aktif olgular
    assert full["embedded"] == 14
    assert rt.embedding.inner.calls == [1] * (15 + 14)
    rt.close()


def test_embedding_cap_block_stops_without_writing(tmp_path):
    rt = make_rt(tmp_path)
    rt.db.role = "postgres"
    rt.db.update("runtime_flags", {"value": True}, where={"key": "degraded_mode"})
    rt.db.role = "batch_worker"
    rep = reembed(rt, missing=True)
    assert rep["embedded"] == 0 and rep["error"].startswith("OGR-LLM-002")
    assert all(r["embedding"] is None for r in rt.db.select("memory_facts"))
    rt.close()
