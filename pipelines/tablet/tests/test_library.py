"""``notes ingest``: PDF → parça → embedding → library_documents/library_chunks; arama (§6.1, §3.6)."""

from __future__ import annotations

import json

import pytest
from ogrenmen_common.runtime import Runtime

from conftest import FIXTURES, read_jsonl
from ogrenmen_tablet import cli
from ogrenmen_tablet import library as L

SAMPLE_PDF = FIXTURES / "kitap" / "sample.pdf"


def test_chunk_pages_respects_budget_and_pages():
    pages = ["Birinci paragraf. " * 50, "", "İkinci sayfa kısa.\n\nÜçüncü paragraf " + "uzun cümle. " * 400]
    chunks = L.chunk_pages(pages, max_chars=800)
    assert chunks and all(len(c["text"]) <= 800 for c in chunks)
    assert chunks[0]["page"] == 1 and chunks[-1]["page"] == 3
    joined = " ".join(c["text"] for c in chunks)
    assert joined.count("uzun cümle.") == 400


def test_notes_ingest_writes_documents_and_chunks(tmp_path):
    out = tmp_path / "out"
    assert cli.main(["notes", "ingest", "--pdf", str(SAMPLE_PDF), "--curriculum", "TYT-MAT", "--title",
                     "Aralıklı tekrar notu", "--dry-run", "--out", str(out)], env={}) == 0
    [doc] = read_jsonl(out / "library_documents.jsonl")
    chunks = read_jsonl(out / "library_chunks.jsonl")
    assert doc["title"] == "Aralıklı tekrar notu" and doc["pages"] >= 1
    assert doc["storage_path"].startswith("library/") and doc["storage_path"].endswith("sample.pdf")
    assert chunks and all(c["document_id"] == doc["id"] for c in chunks)
    assert all(c["embedding"].startswith("[") and len(c["embedding"].split(",")) == 768 for c in chunks)
    calls = [c for c in read_jsonl(out / "llm_calls.jsonl") if c["purpose"] == "embedding"]
    assert len(calls) == 1  # tek toplu embed çağrısı, defterden geçer
    report = json.loads((out / "notes_ingest.json").read_text(encoding="utf-8"))
    assert report["status"] == "ingested" and report["chunks"] == len(chunks)


def test_ingest_scrubs_pii_and_is_idempotent(tmp_path, monkeypatch):
    monkeypatch.setattr(L, "read_pdf", lambda path: [
        "Rasyonel sayılarda paydalar eşitlenir. Soru için ayse.hoca@example.org adresine yaz ya da "
        "0532 123 45 67 numarasını ara."])
    rt = Runtime.from_env(dry_run=True, out=tmp_path / "out", env={})
    pdf = tmp_path / "not.pdf"
    pdf.write_bytes(b"%PDF-1.4 test")
    first = L.ingest(rt, pdf, curriculum="TYT-MAT@2026.1")
    assert first.status == "ingested" and first.replacements >= 2
    text = rt.db.tables["library_chunks"][-1]["text"]
    assert "example.org" not in text and "0532" not in text and "[E-POSTA]" in text and "[TELEFON]" in text
    again = L.ingest(rt, pdf, curriculum="TYT-MAT")
    assert again.status == "exists" and again.document_id == first.document_id
    hits = L.Library(rt, rt.db.select("curricula", where={"status": "active"})[0]["id"]).nearest(
        "Rasyonel sayılarda dört işlem")
    assert hits and hits[0]["text"].startswith("Rasyonel") and len(hits) <= L.TOP_K
    with pytest.raises(L.LibraryError, match="OGR-LIB-002"):
        L.ingest(rt, pdf, curriculum="AYT-FIZ")
    rt.close()


def test_ingest_repairs_document_without_chunks(tmp_path, monkeypatch):
    """Belge satırı yazılıp parça yazımı düşerse sonraki alım ``exists`` demez, parçaları yeniden yazar."""
    monkeypatch.setattr(L, "read_pdf", lambda path: ["Kesirlerde paydalar eşitlenir ve paylar toplanır."])
    rt = Runtime.from_env(dry_run=True, out=tmp_path / "out", env={})
    pdf = tmp_path / "not.pdf"
    pdf.write_bytes(b"%PDF-1.4 onarim")
    real_insert = L.insert_minimal

    def failing(db, table, rows, **kw):
        if table == "library_chunks":
            raise L.LibraryError("OGR-DB-001 bağlantı koptu")
        return real_insert(db, table, rows, **kw)

    monkeypatch.setattr(L, "insert_minimal", failing)
    with pytest.raises(L.LibraryError):
        L.ingest(rt, pdf, curriculum="TYT-MAT")
    assert len(rt.db.tables["library_documents"]) == 1 and not rt.db.tables.get("library_chunks")
    monkeypatch.setattr(L, "insert_minimal", real_insert)
    repaired = L.ingest(rt, pdf, curriculum="TYT-MAT")
    assert repaired.status == "repaired" and repaired.chunks == 1
    assert len(rt.db.tables["library_documents"]) == 1
    assert [c["document_id"] for c in rt.db.tables["library_chunks"]] == [repaired.document_id]
    again = L.ingest(rt, pdf, curriculum="TYT-MAT")
    assert again.status == "exists" and again.chunks == 1
    rt.close()
