"""BibTeX ve APA (§6.5 adım 7): **şablonla**, Crossref üst verisinden (``verified``) ya da kaynağın kendi üst
verisinden (``no_doi``; arXiv için ``eprint``); LLM kullanılmaz.

* Anahtar: ilk yazarın soyadı (ASCII'ye katlanmış) + yıl; çakışmada ``a``, ``b``, … soneki (benzersiz).
* Alan değerleri BibTeX özel karakterlerinden kaçırılır (``& % $ # _ { } ~ ^ \\``).
* ``validate_bibtex`` üretilen metni ``bibtexparser`` (2.x ``parse_string``) ile ayrıştırır: ayrıştırılamayan blok
  (``failed_blocks`` — kopya anahtar dahil) olmamalı, kayıt sayısı beklenen kadar olmalı, her kaydın başlığı dolu
  olmalı; aksi ``OGR-KITAP-007``.
* APA 7'ye yakın düz metin: ``Soyadı, A. B., Soyadı, C., & Soyadı, D. (Yıl). Başlık. Yayın. https://doi.org/…``.
"""

from __future__ import annotations

import re
from collections.abc import Mapping, Sequence

import bibtexparser

from .errors import KitapError
from .text import ascii_fold
from .verify import Checked, person_text

_SPECIAL = {"\\": r"\textbackslash{}", "&": r"\&", "%": r"\%", "$": r"\$", "#": r"\#", "_": r"\_",
            "{": r"\{", "}": r"\}", "~": r"\textasciitilde{}", "^": r"\textasciicircum{}"}
_SPECIAL_RE = re.compile(r"[\\&%$#_{}~^]")


def escape(value: str) -> str:
    return _SPECIAL_RE.sub(lambda m: _SPECIAL[m.group(0)], " ".join(str(value).split()))


def _family(person: Mapping[str, str]) -> str:
    return (person.get("family") or person.get("name") or person.get("given") or "").strip()


def entry_type(c: Checked) -> str:
    kind = (c.kind or "").lower()
    if c.crossref_status == "no_doi":
        return "misc"
    if kind in ("journal-article", "article"):
        return "article"
    if kind in ("proceedings-article",):
        return "inproceedings"
    if kind in ("book",):
        return "book"
    if kind in ("book-chapter",):
        return "incollection"
    return "article" if c.venue else "misc"


def make_keys(cits: Sequence[Checked]) -> list[str]:
    bases = []
    for c in cits:
        fam = ascii_fold(_family(c.authors[0])) if c.authors else ""
        if not fam:
            fam = ascii_fold(c.title.split()[0]) if c.title.split() else "kaynak"
        bases.append(f"{fam or 'kaynak'}{c.year or 'nd'}")
    counts: dict[str, int] = {}
    for b in bases:
        counts[b] = counts.get(b, 0) + 1
    seen: dict[str, int] = {}
    keys = []
    for b in bases:
        if counts[b] == 1:
            keys.append(b)
            continue
        i = seen.get(b, 0)
        seen[b] = i + 1
        keys.append(f"{b}{_suffix(i)}")
    return keys


def _suffix(i: int) -> str:
    letters = ""
    i += 1
    while i:
        i, r = divmod(i - 1, 26)
        letters = chr(ord("a") + r) + letters
    return letters


def arxiv_id(c: Checked) -> str | None:
    for e in c.cand.external_ids:
        if e.startswith("arXiv:"):
            return e.removeprefix("arXiv:")
    return None


def bibtex_entry(c: Checked, key: str) -> str:
    fields: list[tuple[str, str]] = [("title", c.title)]
    authors = [a for a in (person_text(p) for p in c.authors) if a]
    if authors:
        fields.append(("author", " and ".join(authors)))
    etype = entry_type(c)
    if c.venue and c.venue != "arXiv":
        fields.append(("journal" if etype == "article" else "booktitle" if etype in (
            "inproceedings", "incollection") else "howpublished", c.venue))
    if c.year:
        fields.append(("year", str(c.year)))
    if c.cand.doi and c.crossref_status == "verified":
        fields.append(("doi", c.cand.doi))
    aid = arxiv_id(c)
    if aid:
        fields.extend([("eprint", aid), ("archiveprefix", "arXiv")])
    if c.crossref_status == "no_doi" and c.oa_pdf_url:
        fields.append(("url", c.oa_pdf_url))
    body = ",\n".join(f"  {name} = {{{escape(value)}}}" for name, value in fields)
    return f"@{etype}{{{key},\n{body}\n}}\n"


def bibtex(cits: Sequence[Checked]) -> str:
    keys = make_keys(cits)
    text = "".join(bibtex_entry(c, k) for c, k in zip(cits, keys, strict=True))
    validate_bibtex(text, expected=len(cits))
    return text


def split_entries(text: str) -> list[str]:
    """``bibtex()`` çıktısını kayıt metinlerine böler (her kayıt satır başındaki ``@`` ile başlar; alan satırları
    iki boşlukla başladığından alan değeri içinde satır başı ``@`` olmaz)."""
    return [e for e in re.split(r"(?m)^(?=@)", text or "") if e.strip()]


def validate_bibtex(text: str, *, expected: int | None = None) -> list[str]:
    """Ayrıştırır; anahtarlar benzersiz ve sayı beklenen kadar olmalı. Dönüş: anahtarlar."""
    raw_keys = re.findall(r"^@\w+\{([^,\s]+),", text, flags=re.MULTILINE)
    if len(raw_keys) != len(set(raw_keys)):
        raise KitapError("OGR-KITAP-007 BibTeX anahtarları benzersiz değil")
    try:
        lib = bibtexparser.parse_string(text)
    except Exception as exc:  # bibtexparser ayrıştırma hataları tek türde toplanmaz
        raise KitapError(f"OGR-KITAP-007 BibTeX ayrıştırılamadı: {exc}") from exc
    if lib.failed_blocks:
        kinds = sorted({type(b).__name__ for b in lib.failed_blocks})
        raise KitapError(f"OGR-KITAP-007 BibTeX ayrıştırılamayan blok: {', '.join(kinds)}")
    keys = [e.key for e in lib.entries]
    if keys != raw_keys or (expected is not None and len(keys) != expected):
        raise KitapError(f"OGR-KITAP-007 BibTeX kayıt sayısı tutmuyor ({len(keys)} ayrıştı, {len(raw_keys)} yazıldı)")
    for e in lib.entries:
        title = e.fields_dict.get("title")
        if title is None or not str(title.value).strip():
            raise KitapError("OGR-KITAP-007 başlıksız BibTeX kaydı")
    return keys


def _initials(given: str) -> str:
    parts = [p for p in re.split(r"[\s\-]+", given.strip()) if p]
    return " ".join(f"{p[0].upper()}." for p in parts if p[0].isalpha())


def apa_author(person: Mapping[str, str]) -> str:
    family, given = (person.get("family") or "").strip(), (person.get("given") or "").strip()
    if family and given:
        return f"{family}, {_initials(given)}"
    return family or given or (person.get("name") or "").strip()


def apa_entry(c: Checked) -> str:
    names = [a for a in (apa_author(p) for p in c.authors) if a]
    if len(names) >= 2:
        who = ", ".join(names[:-1]) + ", & " + names[-1]
    else:
        who = names[0] if names else ""
    year = f"({c.year})" if c.year else "(t.y.)"
    title = c.title.rstrip(".")
    parts = [f"{who} {year}." if who else f"{title}. {year}."]
    if who:
        parts.append(f"{title}.")
    if c.venue:
        parts.append(f"{c.venue}.")
    if c.cand.doi and c.crossref_status == "verified":
        parts.append(f"https://doi.org/{c.cand.doi}")
    elif c.oa_pdf_url:
        parts.append(c.oa_pdf_url)
    return " ".join(parts)


def apa(cits: Sequence[Checked]) -> list[str]:
    return [apa_entry(c) for c in cits]
