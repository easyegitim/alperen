"""Canlı Postgres: LLM soru yolu ve ders notu kütüphanesi gerçek şema, RLS ve ``batch_worker`` yetkileriyle
(§3.8, §6.1).

Yalnız ``OGRENMEN_DATABASE_URL`` tanımlıysa koşar (yoksa SKIP). ``generate.run`` ve ``library.ingest`` aynen çalışır;
yalnız veritabanı adaptörü PostgREST yerine ``psql`` + ``SET LOCAL ROLE batch_worker`` (``tests/psqldb.py``) olur.
Model senaryoludur (ağ yok).
"""

from __future__ import annotations

import pytest
from ogrenmen_common.errors import DbPermissionError
from ogrenmen_common.runtime import Runtime

from conftest import FIXTURES, psql
from ogrenmen_tablet import generate as G
from ogrenmen_tablet import library as L
from psqldb import PsqlDb
from scripted import ScriptedLLM

pytestmark = pytest.mark.live


def _rt(tmp_path, url: str, llm) -> tuple[Runtime, PsqlDb]:
    rt = Runtime.from_env(dry_run=True, out=tmp_path / "out", env={})
    db = PsqlDb(url)
    rt.db = db
    rt.ledger.db = db
    rt.llm = llm
    rt.ledger.llm = llm
    return rt, db


def _one(url: str, sql: str) -> str:
    return psql(url, sql=sql).stdout.strip()


def test_live_generate_writes_through_batch_worker_grants(live_db, tmp_path):
    cur = _one(live_db, "select id from public.curricula where code = 'TYT-MAT' and status = 'active'")
    req = _one(live_db, (
        "insert into public.generation_requests (kind, curriculum_id, skill_id, difficulty_band, question_kind, "
        f"needs_generation) values ('pool_miss', '{cur}', 'tyt.mat.problem.kesir', 'mid', 'mcq', true) returning id"))
    llm = ScriptedLLM({"tyt.mat.problem.kesir": ["figure"], "tyt.mat.problem.yas": ["bad_sympy", "bad_sympy"]},
                      vision=["match"])
    rt, db = _rt(tmp_path, live_db, llm)
    report = G.run(rt, G.Options(count=1))
    [target] = report["targets"]
    assert target["source"] == "request" and target["status"] == "generated", target
    qid = target["question_id"]
    row = _one(live_db, (
        "select q.status, q.source, k.sympy_status, k.written_by, k.correct_option, f.render_status, f.vision_status, "
        "f.review_status, f.png_path, g.served_question_id from public.questions q "
        "join secure.answer_keys k on k.question_id = q.id join public.figures f on f.id = q.figure_id "
        f"join public.generation_requests g on g.id = '{req}' where q.id = '{qid}'"))
    status, source, sympy_status, written_by, correct, render, vision, review, png, served = row.split("|")
    assert (status, source, sympy_status, written_by, correct) == ("pending_review", "llm", "verified",
                                                                   "batch_worker:tablet", "A")
    assert (render, vision, review) == ("rendered", "match", "pending") and png.startswith("figures/")
    assert served == qid
    calls = _one(live_db, "select count(*) from public.llm_calls where purpose = 'question_gen' and status = 'ok'")
    assert int(calls) >= 1
    audit = _one(live_db, f"select count(*) from audit.events where action = 'RPC:register_answer_key' "
                          f"and row_id = '{qid}'")
    assert audit == "1"

    # iki başarısız SymPy denemesi: pending_review + verification notu, anahtar yok
    report2 = G.run(rt, G.Options(skill="tyt.mat.problem.yas", count=1))
    [t2] = report2["targets"]
    assert t2["status"] == "review"
    row2 = _one(live_db, (
        "select q.status, q.verification->>'sympy', q.verification->>'review_note' is not null, q.review_note is null, "
        f"(select count(*) from secure.answer_keys k where k.question_id = q.id) from public.questions q "
        f"where q.id = '{t2['question_id']}'"))
    assert row2 == "pending_review|failed|t|t|0"

    # batch_worker inceleme sütunlarını doğrudan yazamaz; onaylı soru ekleyemez
    with pytest.raises(DbPermissionError):
        db.update("questions", {"review_note": "elle not"}, where={"id": qid})
    with pytest.raises(DbPermissionError):
        db.insert("figures", {"tool": "matplotlib", "code": "x", "code_hash": "canli-dogrudan",
                              "alt_text": "Doğrudan onaylı şekil denemesi", "review_status": "verified"},
                  returning="minimal")
    rt.close()


def test_live_notes_ingest_and_search(live_db, tmp_path):
    rt, _db = _rt(tmp_path, live_db, ScriptedLLM())
    result = L.ingest(rt, FIXTURES / "kitap" / "sample.pdf", curriculum="TYT-MAT", title="Canlı not")
    assert result.status == "ingested" and result.chunks >= 1
    again = L.ingest(rt, FIXTURES / "kitap" / "sample.pdf", curriculum="TYT-MAT")
    assert again.status == "exists"
    row = _one(live_db, (
        "select count(*), bool_and(vector_dims(embedding::vector) = 768) from public.library_chunks "
        f"where document_id = '{result.document_id}'"))
    assert row == f"{result.chunks}|t"
    cur = _one(live_db, "select id from public.curricula where code = 'TYT-MAT' and status = 'active'")
    hits = L.Library(rt, cur).nearest("Aralıklı tekrar")
    assert hits and len(hits) <= 3
    rt.close()
