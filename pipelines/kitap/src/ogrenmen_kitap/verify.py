"""Crossref doğrulaması (§6.5 adım 4) ve DOI'siz kaynakların kurumsal bağlantı kuralı.

Her DOI ``GET /works/{doi}`` (``DOIResolver``; gerçek adaptör 404 ve iki denemede zaman aşımında ``None`` döner):

* 200 **ve** başlık benzerliği ≥ 0.6 (``rapidfuzz.fuzz.token_set_ratio / 100``, iki ondalığa **aşağı** yuvarlanır —
  ``citations.title_similarity numeric(3,2)``; 0.596 hiçbir zaman 0.60 sayılmaz) → ``verified``; başlık, yazarlar,
  yayın ve yıl Crossref üst verisinden alınır;
* ``None`` (404/zaman aşımı) → ``removed(crossref_unresolved)``; Crossref kaydında yıl yoksa da (sözleşme yıl ister)
  aynı neden;
* başlık uyuşmazlığı → ``removed(title_mismatch)``;
* DOI yoksa: kurumsal/ön baskı bağlantısı (arXiv, DergiPark, YÖK Tez, ``.edu.tr`` açık arşivleri) **ve** geçerli
  yıl (1800–2100; sözleşme yıl ister) varsa ``no_doi`` + ``oa_pdf_url``, yoksa ``removed(no_doi_no_link)`` —
  yılsız DOI'siz kayıt atıf olarak gösterilemez; şema ``removed_reason`` listesinde ayrı neden yoktur.

Crossref kesintisi (``AdapterError``; 5xx) atıfı düşürmez: ``OGR-KITAP-010`` ile iş başarısız olur ve istek yeniden
denenebilir.
"""

from __future__ import annotations

import math
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any
from urllib.parse import urlsplit

from ogrenmen_common.adapters.base import DOIResolver
from ogrenmen_common.errors import AdapterError
from rapidfuzz import fuzz, utils

from .errors import KitapError
from .search import Candidate

MIN_TITLE_SIMILARITY = 0.6
INSTITUTIONAL_HOSTS = ("arxiv.org", "dergipark.org.tr", "tez.yok.gov.tr", "acikbilim.yok.gov.tr", "edu.tr")
"""DOI'siz kaynağın tutulabilmesi için bağlantının ait olması gereken alanlar (alan adı ya da alt alanı)."""


def title_similarity(a: str, b: str) -> float:
    raw = fuzz.token_set_ratio(a or "", b or "", processor=utils.default_process) / 100.0
    return math.floor(raw * 100 + 1e-9) / 100.0


def institutional_link(url: str | None) -> bool:
    if not url:
        return False
    parts = urlsplit(url)
    if parts.scheme not in ("http", "https") or not parts.hostname:
        return False
    host = parts.hostname.lower()
    return any(host == h or host.endswith("." + h) for h in INSTITUTIONAL_HOSTS)


@dataclass
class CrossrefMeta:
    title: str
    authors: list[dict[str, str]]
    venue: str | None
    year: int | None
    kind: str | None
    url: str | None

    @property
    def authors_text(self) -> str:
        return authors_text(self.authors)


def person_text(a: Mapping[str, str]) -> str:
    """Tek kişi biçimi (``citations.authors``, BibTeX ``author``): "Soyadı, Ad" ya da tek parça ad."""
    family, given = (a.get("family") or "").strip(), (a.get("given") or "").strip()
    if family and given:
        return f"{family}, {given}"
    return family or given or (a.get("name") or "").strip()


def authors_text(people: Sequence[Mapping[str, str]]) -> str:
    return "; ".join(t for t in (person_text(a) for a in people) if t)


def valid_year(year: int | None) -> bool:
    return year is not None and 1800 <= int(year) <= 2100


def crossref_meta(message: Mapping[str, Any]) -> CrossrefMeta:
    titles = message.get("title") or []
    title = " ".join(str(titles[0] if isinstance(titles, list) and titles else titles or "").split())
    authors = []
    for a in message.get("author") or []:
        if isinstance(a, Mapping):
            person = {k: str(a[k]) for k in ("given", "family", "name") if a.get(k)}
            if person:
                authors.append(person)
    venues = message.get("container-title") or []
    venue = (venues[0] if isinstance(venues, list) and venues else venues) or None
    year = None
    for key in ("issued", "published-print", "published-online", "published", "created"):
        parts = ((message.get(key) or {}).get("date-parts") or [[None]])[0]
        if parts and isinstance(parts[0], int):
            year = int(parts[0])
            break
    return CrossrefMeta(title=title, authors=authors, venue=str(venue) if venue else None, year=year,
                        kind=message.get("type"), url=message.get("URL"))


def split_name(name: str) -> dict[str, str]:
    """"Doug Rohrer" → {given: Doug, family: Rohrer}; "Rohrer, Doug" de anlaşılır."""
    name = " ".join(name.split())
    if "," in name:
        family, given = (p.strip() for p in name.split(",", 1))
        return {"family": family, "given": given} if given else {"family": family}
    parts = name.split(" ")
    if len(parts) == 1:
        return {"family": parts[0]}
    return {"family": parts[-1], "given": " ".join(parts[:-1])}


@dataclass
class Checked:
    """Bir adayın doğrulama sonucu (kept ya da removed)."""

    cand: Candidate
    crossref_status: str                # verified | unresolved | no_doi | pending
    kept: bool
    reason: str | None = None           # removed_reason
    title: str = ""
    authors: list[dict[str, str]] = field(default_factory=list)
    venue: str | None = None
    year: int | None = None
    kind: str | None = None
    title_similarity: float | None = None
    verified_at: str | None = None
    oa_pdf_url: str | None = None
    ordinal: int = 0

    @property
    def authors_text(self) -> str:
        return authors_text(self.authors)


def check_candidate(resolver: DOIResolver, cand: Candidate, *, now_iso: str) -> Checked:
    base_authors = [split_name(a) for a in cand.authors]
    if cand.doi is None:
        if institutional_link(cand.oa_pdf_url) and valid_year(cand.year):
            return Checked(cand=cand, crossref_status="no_doi", kept=True, title=cand.title, authors=base_authors,
                           venue=cand.venue, year=cand.year, kind="preprint" if "arxiv" in cand.sources else None,
                           oa_pdf_url=cand.oa_pdf_url)
        return Checked(cand=cand, crossref_status="no_doi", kept=False, reason="no_doi_no_link", title=cand.title,
                       authors=base_authors, venue=cand.venue, year=cand.year, oa_pdf_url=cand.oa_pdf_url)
    try:
        message = resolver.resolve(cand.doi)
    except AdapterError as exc:
        raise KitapError(f"OGR-KITAP-010 Crossref kesintisi, atıflar doğrulanamadı: {exc.message[:160]}") from exc
    if message is None:
        return Checked(cand=cand, crossref_status="unresolved", kept=False, reason="crossref_unresolved",
                       title=cand.title, authors=base_authors, venue=cand.venue, year=cand.year,
                       verified_at=now_iso)
    meta = crossref_meta(message)
    sim = title_similarity(cand.title, meta.title)
    if sim < MIN_TITLE_SIMILARITY:
        return Checked(cand=cand, crossref_status="unresolved", kept=False, reason="title_mismatch",
                       title=cand.title, authors=base_authors, venue=cand.venue, year=cand.year,
                       title_similarity=sim, verified_at=now_iso)
    year = meta.year or cand.year
    if not valid_year(year):
        return Checked(cand=cand, crossref_status="unresolved", kept=False, reason="crossref_unresolved",
                       title=meta.title or cand.title, authors=meta.authors or base_authors, venue=meta.venue,
                       year=None, title_similarity=sim, verified_at=now_iso)
    return Checked(cand=cand, crossref_status="verified", kept=True, title=meta.title or cand.title,
                   authors=meta.authors or base_authors, venue=meta.venue or cand.venue, year=int(year),
                   kind=meta.kind, title_similarity=sim, verified_at=now_iso, oa_pdf_url=cand.oa_pdf_url)


def recheck(resolver: DOIResolver, *, doi: str, title: str) -> tuple[str, str | None, float | None]:
    """``verify --output``: kayıtlı bir ``verified`` atıfı yeniden denetler →
    ``(crossref_status, removed_reason | None, title_similarity)``."""
    try:
        message = resolver.resolve(doi)
    except AdapterError as exc:
        raise KitapError(f"OGR-KITAP-010 Crossref kesintisi, yeniden denetim yapılamadı: {exc.message[:160]}") from exc
    if message is None:
        return "unresolved", "crossref_unresolved", None
    sim = title_similarity(title, crossref_meta(message).title)
    if sim < MIN_TITLE_SIMILARITY:
        return "unresolved", "title_mismatch", sim
    return "verified", None, sim
