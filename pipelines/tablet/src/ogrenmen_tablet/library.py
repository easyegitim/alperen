"""Ders notu kütüphanesi: ``notes ingest`` (PDF → parça → embedding → ``library_documents/library_chunks``) ve
``generate`` adım (3)'ün kazanıma en yakın 3 parçayı bulan araması (BLUEPRINT §6.1, §3.6 ``0010_kitap.sql``).

* Metin ``pypdf`` ile sayfa sayfa çıkarılır, ~800 token'lık (≈ 3.200 karakter; 1 token ≈ 4 karakter) parçalara
  paragraf/cümle sınırından bölünür; her parça başladığı sayfayı taşır.
* Parça metni veritabanına ve embedding sağlayıcısına gitmeden önce ``scrub_for_llm``'den geçer (§9.1).
* Embedding ``Runtime.embedding`` (``LedgeredEmbedding``: ``check_spend('embedding')`` + ``llm_calls``); dry-run'da
  ``FakeEmbedding`` (sha256 → 768). Vektör pgvector ``halfvec`` metin biçiminde yazılır.
* Arama: aynı ``curriculum_id``'li belgelerin parçaları; puan = FTS benzeri terim örtüşmesi (Türkçe için 5 harflik
  kök öneki; ``plainto_tsquery('turkish', skills.name)`` karşılığı) ve kazanım adının embedding'iyle kosinüs
  benzerliğinin ortalaması; ilk 3 parça, toplam ≤ 600 token.
"""

from __future__ import annotations

import hashlib
import re
import uuid
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from ogrenmen_common.adapters.base import in_, insert_minimal
from ogrenmen_common.errors import OgrError
from ogrenmen_common.fakes.embedding import cosine, to_halfvec

from . import prompts as P
from . import shared

CHUNK_TOKENS = 800
CHARS_PER_TOKEN = 4
PROMPT_TOKENS = 600
TOP_K = 3
STEM_PREFIX = 5
_WORD = re.compile(r"[0-9a-zçğıöşüâîû]+", re.IGNORECASE)
STOPWORDS = frozenset({"ve", "ile", "bir", "bu", "şu", "da", "de", "için", "olan", "gibi", "ya", "veya", "en",
                       "çok", "her", "ne", "mi", "mı", "ki", "o"})


class LibraryError(OgrError):
    """Ders notu alımı/araması hatası."""


def turkish_lower(text: str) -> str:
    return text.replace("I", "ı").replace("İ", "i").lower()


def terms(text: str) -> set[str]:
    """Küçük harf, durak kelimesiz, 5 harflik kök öneki (Türkçe ekleri kabaca atar)."""
    out = set()
    for w in _WORD.findall(turkish_lower(text)):
        if w in STOPWORDS or len(w) < 2:
            continue
        out.add(w[:STEM_PREFIX])
    return out


def chunk_pages(pages: Sequence[str], *, max_chars: int = CHUNK_TOKENS * CHARS_PER_TOKEN) -> list[dict[str, Any]]:
    """Sayfa metinlerini paragraf → cümle sınırından ``max_chars``'ı aşmayan parçalara böler."""
    chunks: list[dict[str, Any]] = []
    buf: list[str] = []
    size = 0
    start_page: int | None = None

    def flush() -> None:
        nonlocal buf, size, start_page
        text = " ".join(" ".join(buf).split())
        if text:
            chunks.append({"page": start_page, "text": text})
        buf, size, start_page = [], 0, None

    for page_no, page in enumerate(pages, start=1):
        paragraphs = [p for p in re.split(r"\n\s*\n", page or "") if p.strip()]
        for para in paragraphs:
            pieces = [para] if len(para) <= max_chars else re.split(r"(?<=[.!?])\s+", para)
            for piece in pieces:
                while len(piece) > max_chars:  # cümlesi bile uzun: sert bölme
                    head, piece = piece[:max_chars], piece[max_chars:]
                    if size:
                        flush()
                    start_page = page_no
                    buf, size = [head], len(head)
                    flush()
                if size + len(piece) + 1 > max_chars and size:
                    flush()
                if start_page is None:
                    start_page = page_no
                buf.append(piece)
                size += len(piece) + 1
    flush()
    return chunks


def read_pdf(path: Path) -> list[str]:
    from pypdf import PdfReader

    try:
        reader = PdfReader(str(path))
        return [(page.extract_text() or "") for page in reader.pages]
    except Exception as exc:  # noqa: BLE001 - pypdf birçok tür fırlatır
        raise LibraryError(f"OGR-LIB-001 PDF okunamadı: {path.name}: {exc}") from exc


def active_curriculum(db: Any, code: str) -> dict[str, Any]:
    """``code`` (``TYT-MAT``) ya da ``code@version`` (``TYT-MAT@2026.1``) → müfredat satırı (aktif sürüm)."""
    try:
        return shared.active_curriculum(db, code)
    except shared.CurriculumError as exc:
        raise LibraryError(exc.message) from exc


@dataclass
class IngestResult:
    document_id: str
    title: str
    curriculum: str
    pages: int
    chunks: int
    status: str
    """``ingested`` | ``exists`` (aynı PDF ve müfredat daha önce parçalarıyla alındı) | ``repaired`` (belge satırı
    vardı ama parçası yoktu — önceki alım parça yazımında düştü; parçalar yeniden yazıldı) | ``empty`` (metin
    çıkmadı)"""
    replacements: int = 0


def ingest(rt: Any, pdf: Path, *, curriculum: str, title: str | None = None) -> IngestResult:
    pdf = Path(pdf)
    if not pdf.is_file():
        raise LibraryError(f"OGR-LIB-001 PDF yok: {pdf}")
    data = pdf.read_bytes()
    digest = hashlib.sha256(data).hexdigest()
    cur = active_curriculum(rt.db, curriculum)
    doc_id = str(uuid.uuid5(shared.NAMESPACE_OGRENMEN, f"library:{cur['id']}:{digest}"))
    storage_path = f"library/{digest[:16]}/{pdf.name}"
    title = (title or pdf.stem).strip()
    label = f"{cur['code']}@{cur['version']}"
    doc_exists = bool(rt.db.select("library_documents", where={"id": doc_id}, columns=["id"]))
    if doc_exists:
        existing = rt.db.select("library_chunks", where={"document_id": doc_id}, columns=["id"])
        if existing:
            return IngestResult(doc_id, title, label, 0, len(existing), "exists")
    pages = read_pdf(pdf)
    raw_chunks = chunk_pages(pages)
    if not raw_chunks:
        return IngestResult(doc_id, title, label, len(pages), 0, "empty")
    cleaned: list[dict[str, Any]] = []
    replacements = 0
    from ogrenmen_common.pii import scrub_for_llm

    for c in raw_chunks:
        res = scrub_for_llm(c["text"], [])
        replacements += res.replacements
        cleaned.append({"page": c["page"], "text": res.text})
    vectors = rt.embedding.embed([c["text"] for c in cleaned])
    if not doc_exists:
        insert_minimal(rt.db, "library_documents", {"id": doc_id, "curriculum_id": cur["id"], "title": title,
                                                    "storage_path": storage_path, "pages": len(pages)})
    rows = [{"document_id": doc_id, "page": c["page"], "text": c["text"], "embedding": to_halfvec(v)}
            for c, v in zip(cleaned, vectors, strict=True)]
    insert_minimal(rt.db, "library_chunks", rows)
    return IngestResult(doc_id, title, label, len(pages), len(rows), "repaired" if doc_exists else "ingested",
                        replacements)


def parse_vector(value: Any) -> list[float] | None:
    if value is None:
        return None
    if isinstance(value, list | tuple):
        return [float(x) for x in value]
    text = str(value).strip().lstrip("[").rstrip("]")
    if not text:
        return None
    return [float(x) for x in text.split(",")]


class Library:
    """Bir çalışma boyunca müfredatın ders notu parçalarını bir kez okur; kazanım başına en yakın parçaları verir."""

    def __init__(self, rt: Any, curriculum_id: str):
        self.rt = rt
        self.curriculum_id = curriculum_id
        self._chunks: list[dict[str, Any]] | None = None

    def chunks(self) -> list[dict[str, Any]]:
        if self._chunks is None:
            docs = self.rt.db.select("library_documents", where={"curriculum_id": self.curriculum_id},
                                     columns=["id"])
            ids = [d["id"] for d in docs]
            rows = (self.rt.db.select("library_chunks", where={"document_id": in_(ids)},
                                      columns=["id", "document_id", "page", "text", "embedding"], order="id")
                    if ids else [])
            self._chunks = [dict(r) for r in rows]
        return self._chunks

    def nearest(self, query: str, *, k: int = TOP_K, budget_tokens: int = PROMPT_TOKENS) -> list[dict[str, Any]]:
        """Kazanım adına en yakın ``k`` parça (toplam ≤ ``budget_tokens``); kütüphane boşsa ``[]`` (adım atlanır)."""
        rows = self.chunks()
        if not rows:
            return []
        q_terms = terms(query)
        q_vec = self.rt.embedding.embed([P.scrub(query)])[0]
        scored = []
        for row in rows:
            c_terms = terms(row["text"])
            fts = len(q_terms & c_terms) / len(q_terms) if q_terms else 0.0
            vec = parse_vector(row.get("embedding"))
            cos = cosine(q_vec, vec) if vec else 0.0
            if fts <= 0 and cos <= 0:
                continue
            scored.append((0.5 * fts + 0.5 * max(cos, 0.0), row))
        scored.sort(key=lambda s: (-s[0], int(s[1]["id"])))
        budget = budget_tokens * CHARS_PER_TOKEN
        out: list[dict[str, Any]] = []
        for score, row in scored[:k]:
            share = budget // max(1, min(k, len(scored)))
            text = row["text"] if len(row["text"]) <= share else row["text"][: share - 1].rstrip() + "…"
            out.append({"id": int(row["id"]), "page": row.get("page"), "text": text, "score": round(score, 4)})
        return out
