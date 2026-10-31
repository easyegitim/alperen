"""Sorgu genişletme ve aday toplama (§6.5 adım 2–3).

* ``expand_queries`` — zincir ``query_expand`` (``query-expand`` sözleşmesi; 3–5 sorgu). Modele giden istem tek
  çıkış noktasında ``scrub_for_llm(prompt, name_hashes)``'ten geçer.
* ``gather`` — OpenAlex + Semantic Scholar (gerçek kipte yalnız ``S2_API_KEY`` varsa) + arXiv
  (``ogrenmen_common.adapters.arxiv.ArxivScholar``; sahtesi ``FakeArxiv``) her sorgu için aranır. Akademik
  kaynaklara yalnız genişletilmiş sorgular ve temizlenmiş soru gider. Bir kaynağın hatası işi düşürmez
  (``source_errors``'a yazılır); hiçbir kaynaktan aday gelmezse ``OGR-KITAP-003``.
* ``merge`` — DOI'ye göre tekilleştirme (aynı yayın birden çok kaynakta: üst veri birleşir, ``cited_by`` en
  büyüğü, S2 ``tldr``'ı korunur); DOI'siz kayıt bir DOI'li kaydın başlığıyla aynıysa ``duplicate``.
* ``score`` — §6.5 formülü ``0.5·alaka + 0.3·log(atıf+1)/log(max) + 0.2·yıl yakınlığı`` (``max`` = havuzdaki en
  büyük atıf sayısı; ``max ≤ 1`` iken ``log(max)`` sıfır ya da tanımsız olduğundan payda ``log 2``'dir). En çok
  atıflı kaydın terimi 1'i biraz aşar (``log(max+1)/log(max)``); sıralama için önemsizdir. Alaka = sorgu
  gövdelerinin başlık+özet gövdelerinde kapsanma oranı (sorgular arasında en büyüğü), yıl yakınlığı =
  ``1 − min(1, yaş/30)``.
* ``top`` — skora göre ilk 30 aday (eşitlikte başlık sırası; deterministik).
"""

from __future__ import annotations

import math
import os
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any

from ogrenmen_common.adapters.base import LLMRequest, Scholar, ScholarRecord
from ogrenmen_common.errors import AdapterError
from ogrenmen_common.ledger import CostLedger
from ogrenmen_common.pii import scrub_for_llm
from rapidfuzz import fuzz, utils

from .errors import KitapError
from .text import normalize_doi, stem, tokens

MAX_CANDIDATES = 30
PER_QUERY_LIMIT = 10
YEAR_HORIZON = 30
DUPLICATE_TITLE_RATIO = 95
SOURCE_ORDER = ("openalex", "semantic_scholar", "arxiv", "crossref", "manual")

EXPAND_SYSTEM = (
    "Sen Öğrenmen'in araştırma yardımcısısın. Öğrencinin ya da eğitmenin sorusunu akademik veri tabanlarında "
    "(OpenAlex, Semantic Scholar, arXiv) aranacak 3 ile 5 arasında kısa sorguya çevir. En az ikisi İngilizce olsun, "
    "biri Türkçe kalabilir. Her sorgu 3–12 kelime, konu terimleri içersin; kişi, okul ya da kurum adı yazma. "
    'Yalnız şemaya uygun JSON döndür: {"queries": ["…", "…", "…"]}.'
)


def expand_queries(ledger: CostLedger, question: str, *, ref_id: str | None,
                   name_hashes: Sequence[str] = ()) -> tuple[list[str], Any]:
    """Dönüş: (3–5 tekil sorgu, ``CallResult``). İstem modele gitmeden ``scrub_for_llm``'den geçer."""
    prompt = scrub_for_llm(f"Soru: {question}", list(name_hashes)).text
    req = LLMRequest(purpose="query_expand", model="", system=EXPAND_SYSTEM, prompt=prompt,
                     schema_id="query-expand", max_tokens=512, temperature=0.2)
    result = ledger.call("query_expand", req, ref_table="research_requests", ref_id=ref_id)
    seen: set[str] = set()
    queries: list[str] = []
    for q in result.data["queries"]:
        text = " ".join(str(q).split())
        key = text.lower()
        if text and key not in seen:
            seen.add(key)
            queries.append(text)
    if len(queries) < 3 and question.strip().lower() not in seen:
        queries.append(" ".join(question.split()))
    if len(queries) < 3:
        raise KitapError("OGR-KITAP-003 sorgu genişletme 3 farklı sorgu üretmedi")
    return queries[:5], result


@dataclass
class Candidate:
    """Tekilleştirilmiş aday kaynak."""

    title: str
    authors: tuple[str, ...]
    year: int | None
    doi: str | None
    venue: str | None
    cited_by: int
    sources: list[str]
    abstract: str | None = None
    oa_pdf_url: str | None = None
    tldr: str | None = None
    external_ids: list[str] = field(default_factory=list)
    relevance: float = 0.0
    score: float = 0.0

    @property
    def source(self) -> str:
        """``research-output.citations[].source``: kaynakların sabit önceliğine göre ilki."""
        return min(self.sources, key=lambda s: SOURCE_ORDER.index(s) if s in SOURCE_ORDER else len(SOURCE_ORDER))

    @property
    def label(self) -> str:
        return self.doi or self.title

    def as_dict(self) -> dict[str, Any]:
        return {"title": self.title, "authors": list(self.authors), "year": self.year, "doi": self.doi,
                "venue": self.venue, "cited_by": self.cited_by, "sources": list(self.sources),
                "oa_pdf_url": self.oa_pdf_url, "tldr": self.tldr, "relevance": round(self.relevance, 4),
                "score": round(self.score, 4)}


def active_scholars(scholars: Sequence[Scholar], *, fake: bool, env: Mapping[str, str] | None = None) -> list[Scholar]:
    """Semantic Scholar gerçek kipte yalnız ``S2_API_KEY`` varsa (§6.5 "anahtar varsa"); sahte kipte hep."""
    env = os.environ if env is None else env
    out = []
    for s in scholars:
        if s.source == "semantic_scholar" and not fake and not env.get("S2_API_KEY"):
            continue
        out.append(s)
    return out


def gather(scholars: Sequence[Scholar], queries: Sequence[str], *,
           per_query_limit: int = PER_QUERY_LIMIT) -> tuple[list[ScholarRecord], list[dict]]:
    records: list[ScholarRecord] = []
    errors: list[dict] = []
    for scholar in scholars:
        for q in queries:
            try:
                records.extend(scholar.search(q, limit=per_query_limit))
            except AdapterError as exc:
                errors.append({"source": scholar.source, "query": q, "error": exc.message[:200]})
    if not records:
        detail = f" ({len(errors)} kaynak hatası)" if errors else ""
        raise KitapError(f"OGR-KITAP-003 hiçbir akademik kaynaktan aday gelmedi{detail}")
    return records, errors


def _richer(a: str | None, b: str | None) -> str | None:
    if not a:
        return b
    if not b:
        return a
    return a if len(a) >= len(b) else b


def merge(records: Iterable[ScholarRecord]) -> tuple[list[Candidate], list[Candidate]]:
    """DOI'ye göre birleştirir. Dönüş: (adaylar, DOI'siz ve başlığı DOI'li bir adayla aynı olan kopyalar)."""
    by_doi: dict[str, Candidate] = {}
    no_doi: list[Candidate] = []
    for r in records:
        doi = normalize_doi(r.doi)
        if not r.title.strip():
            continue
        cand = Candidate(title=" ".join(r.title.split()), authors=tuple(a for a in r.authors if a), year=r.year,
                         doi=doi, venue=r.venue, cited_by=int(r.cited_by or 0), sources=[r.source],
                         abstract=r.abstract, oa_pdf_url=r.oa_pdf_url, tldr=r.tldr,
                         external_ids=[r.external_id] if r.external_id else [])
        if doi is None:
            same = next((c for c in no_doi if utils.default_process(c.title) == utils.default_process(cand.title)),
                        None)
            if same is None:
                no_doi.append(cand)
            else:
                _absorb(same, cand)
            continue
        if doi in by_doi:
            _absorb(by_doi[doi], cand)
        else:
            by_doi[doi] = cand
    candidates = list(by_doi.values())
    duplicates: list[Candidate] = []
    for c in no_doi:
        if any(fuzz.token_set_ratio(c.title, d.title, processor=utils.default_process) >= DUPLICATE_TITLE_RATIO
               for d in candidates):
            duplicates.append(c)
        else:
            candidates.append(c)
    return candidates, duplicates


def _absorb(into: Candidate, other: Candidate) -> None:
    for s in other.sources:
        if s not in into.sources:
            into.sources.append(s)
    for e in other.external_ids:
        if e not in into.external_ids:
            into.external_ids.append(e)
    into.cited_by = max(into.cited_by, other.cited_by)
    into.year = into.year or other.year
    into.venue = into.venue if into.venue and into.venue != "arXiv" else (other.venue or into.venue)
    into.abstract = _richer(into.abstract, other.abstract)
    into.tldr = into.tldr or other.tldr
    into.oa_pdf_url = into.oa_pdf_url or other.oa_pdf_url
    if len(other.authors) > len(into.authors):
        into.authors = other.authors


def relevance(cand: Candidate, queries: Sequence[str]) -> float:
    doc = {stem(t) for t in tokens(f"{cand.title} {cand.abstract or ''} {cand.tldr or ''}")}
    best = 0.0
    for q in queries:
        qs = {stem(t) for t in tokens(q)}
        if qs:
            best = max(best, len(qs & doc) / len(qs))
    return best


def score(candidates: list[Candidate], queries: Sequence[str], *, current_year: int) -> list[Candidate]:
    max_cited = max((c.cited_by for c in candidates), default=0)
    denom = math.log(max_cited) if max_cited > 1 else math.log(2)
    for c in candidates:
        c.relevance = relevance(c, queries)
        cites = math.log(c.cited_by + 1) / denom
        recency = 0.0 if c.year is None else 1.0 - min(1.0, max(0, current_year - int(c.year)) / YEAR_HORIZON)
        c.score = 0.5 * c.relevance + 0.3 * cites + 0.2 * recency
    return candidates


def top(candidates: list[Candidate], n: int = MAX_CANDIDATES) -> list[Candidate]:
    ordered = sorted(candidates, key=lambda c: (-round(c.score, 9), utils.default_process(c.title), c.doi or ""))
    return ordered[:n]
