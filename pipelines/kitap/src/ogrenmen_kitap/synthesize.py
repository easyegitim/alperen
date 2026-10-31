"""Kaynaklı sentez (§6.5 adım 6): zincir ``research`` → ``research-output``.

Modele yalnız **doğrulanmış** kaynak listesi (``verified`` | ``no_doi``; sıra numarası = ``ordinal``) ve açık
erişim PDF alıntıları gider. İstemin tamamı (soru, sorgular, başlık/yazar/özet listesi, PDF alıntıları, yeniden
üretim istemindeki model metni) tek çıkış noktasında (``_call``) ``scrub_for_llm(prompt, name_hashes)``'ten geçer.

Modelden ``citations: []`` istenir ve dönen ``citations`` **kullanılmaz** (uydurma DOI riski): atıflar boru
hattının Crossref listesidir. Bu yüzden ``CostLedger.call``'a tam ``research-output`` şeması değil, yalnız boru
hattının okuduğu alanların yapısını denetleyen ``response_errors`` doğrulayıcısı verilir (``synthesis`` dizisi,
``matrix`` satırları); modelin eksik ``request_id``/``verified_at``/DOI alanları onarım çağrısı tetiklemez.

Paragraf kuralı: ``cites`` boş olmamalı ve her ordinal doğrulanmış listede olmalı; metin ≤ 1200 karakter ve
yasaklı kelime (``tahmin/çıkacak/kesin/garanti`` — sözleşmelerin ``x-forbidden-words`` listesi, ilke 10)
içermemeli. Kurala uymayan **her** paragraf **bir kez** yeniden üretilir (ayrı ``research`` çağrısı), yine uymazsa
atılır. Maliyet koruması: bir sentezde en çok ``MAX_REGENERATIONS`` (6 — istenen paragraf sayısının üst sınırı)
yeniden üretim; kurala uyan bir yanıtta her paragraf bu sınırın içindedir. Sentez boş kalırsa ``OGR-KITAP-005``
(istek ``failed``).
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass, field
from typing import Any

import ogrenmen_contracts as contracts
from ogrenmen_common.adapters.base import LLMRequest
from ogrenmen_common.errors import LedgerError
from ogrenmen_common.ledger import CallResult, CostLedger
from ogrenmen_common.pii import scrub_for_llm

from .errors import KitapError
from .pdfs import PdfText
from .verify import Checked

MAX_REGENERATIONS = 6
MAX_PARAGRAPH = 1200


def forbidden_words() -> list[str]:
    """İlke 10 listesi sözleşmelerden okunur (tek kaynak: ``exam-priority-plan`` ``x-forbidden-words``)."""
    return list(contracts.schema("exam-priority-plan").get("x-forbidden-words") or [])


SYSTEM = (
    "Sen Öğrenmen'in araştırma sentezi yazarısın. Yalnız aşağıda numaralandırılmış, doğrulanmış kaynaklara "
    "dayanarak Türkçe, sade ve tarafsız bir sentez yaz. Kurallar: (1) her paragraf en az bir kaynağa dayanır ve "
    "'cites' alanında yalnız listedeki numaraları kullanır; listede olmayan kaynak, DOI ya da yazar uydurma; "
    "(2) bir kaynağın iddiasını abartma, çalışmanın örneklemini ve sınırlılığını belirt; (3) 'tahmin', 'çıkacak', "
    "'kesin', 'garanti' kelimelerini ve kesinlik iddialarını kullanma; (4) kişi, okul ya da kurum adı yazma; "
    "(5) 'matrix' alanında her kaynak için yöntem, örneklem, bulgu ve sınırlılık yaz; (6) yalnız şemaya uygun "
    "JSON döndür; 'citations' alanını boş dizi ([]) bırak — atıf listesini sistem doğrulanmış kaynaklardan kendisi "
    "ekler, DOI ya da kaynak bilgisi yazma."
)

MATRIX_KEYS = ("ordinal", "method", "sample", "finding", "limitation")


def response_errors(data: Any) -> list[str]:
    """Model yanıtının yalnız boru hattının okuduğu kısmı: ``synthesis`` boş olmayan nesne dizisi (her öğede
    ``text`` metin, ``cites`` dizi) ve varsa ``matrix`` nesne dizisi. İçerik kuralları (``cites`` geçerliliği,
    uzunluk, yasaklı kelime) paragraf başına ``paragraph_problem``'dadır; ``citations`` ve diğer alanlar
    denetlenmez (kullanılmaz)."""
    if not isinstance(data, dict):
        return ["yanıt JSON nesnesi değil"]
    errs: list[str] = []
    syn = data.get("synthesis")
    if not isinstance(syn, list) or not syn:
        errs.append("/synthesis boş olmayan dizi olmalı")
    else:
        for i, p in enumerate(syn):
            if not isinstance(p, dict) or not isinstance(p.get("text"), str) or not isinstance(p.get("cites"), list):
                errs.append(f"/synthesis/{i} {{text: metin, cites: dizi}} olmalı")
    matrix = data.get("matrix", [])
    if not isinstance(matrix, list) or not all(isinstance(r, dict) for r in matrix):
        errs.append("/matrix nesne dizisi olmalı")
    return errs


def matrix_row(row: Any, valid: set[int]) -> dict | None:
    """Sözleşmeye uyan matris satırı ya da ``None``."""
    if not isinstance(row, dict) or row.get("ordinal") not in valid or isinstance(row.get("ordinal"), bool):
        return None
    if not all(isinstance(row.get(k), str) for k in MATRIX_KEYS[1:]):
        return None
    return {k: row[k] for k in MATRIX_KEYS}


def source_block(cits: Sequence[Checked]) -> str:
    lines = []
    for c in cits:
        bits = [f"[{c.ordinal}] {c.title}", c.authors_text or "yazar bilgisi yok", str(c.year)]
        if c.venue:
            bits.append(c.venue)
        lines.append(" — ".join(bits))
        summary = c.cand.tldr or c.cand.abstract
        if summary:
            lines.append(f"    Özet: {' '.join(summary.split())[:600]}")
    return "\n".join(lines)


def build_prompt(question: str, queries: Sequence[str], cits: Sequence[Checked], excerpts: Sequence[PdfText]) -> str:
    parts = [f"Araştırma sorusu: {question}", "Arama sorguları: " + "; ".join(queries), "",
             "Doğrulanmış kaynaklar (yalnız bunları kullan):", source_block(cits)]
    if excerpts:
        parts += ["", "Açık erişim metinlerinden alıntılar:"]
        for e in excerpts:
            parts += [f"--- [{e.ordinal}] ({e.pages_read}/{e.pages_total} sayfa) ---", e.text]
    parts += ["", "İstenen: 3–6 paragraflık sentez (her paragraf ≤ 1200 karakter, 'cites' ile kaynak numaraları) ve "
                  "her kaynak için bir 'matrix' satırı."]
    return "\n".join(parts)


@dataclass
class Synthesis:
    paragraphs: list[dict]
    matrix: list[dict]
    model: str
    results: list[CallResult] = field(default_factory=list)
    dropped: list[dict] = field(default_factory=list)
    regenerated: int = 0


def paragraph_problem(p: Any, valid: set[int], words: Sequence[str]) -> str | None:
    """Paragraf geçerliyse ``None``, değilse Türkçe neden."""
    if not isinstance(p, dict) or not isinstance(p.get("text"), str) or not p["text"].strip():
        return "paragraf metni yok"
    cites = p.get("cites")
    if not isinstance(cites, list) or not cites:
        return "paragraf hiçbir kaynağa bağlı değil"
    bad = [c for c in cites if not isinstance(c, int) or c not in valid]
    if bad:
        return f"doğrulanmış listede olmayan kaynak numarası: {', '.join(str(b) for b in bad)}"
    if len(p["text"]) > MAX_PARAGRAPH:
        return "paragraf 1200 karakteri aşıyor"
    hit = contracts.find_forbidden_word(p["text"], list(words))
    if hit:
        return f"yasaklı kelime: {hit}"
    return None


def _clean(p: dict) -> dict:
    cites: list[int] = []
    for c in p["cites"]:
        if c not in cites:
            cites.append(c)
    return {"text": " ".join(p["text"].split()), "cites": cites}


def _call(ledger: CostLedger, prompt: str, *, ref_id: str | None, name_hashes: Sequence[str]) -> CallResult:
    """Tek çıkış noktası: istemin tamamı ``scrub_for_llm``'den geçer; yanıt ``response_errors`` ile denetlenir
    (``schema_id`` yapılandırılmış çıktı ipucu olarak kalır)."""
    clean = scrub_for_llm(prompt, list(name_hashes)).text
    req = LLMRequest(purpose="research", model="", system=SYSTEM, prompt=clean, schema_id="research-output",
                     max_tokens=8192, temperature=0.2, timeout_s=180.0)
    return ledger.call("research", req, ref_table="research_requests", ref_id=ref_id, validator=response_errors)


def synthesize(ledger: CostLedger, question: str, queries: Sequence[str], cits: Sequence[Checked],
               excerpts: Sequence[PdfText], *, ref_id: str | None, name_hashes: Sequence[str] = ()) -> Synthesis:
    valid = {c.ordinal for c in cits}
    words = forbidden_words()
    base_prompt = build_prompt(question, queries, cits, excerpts)
    first = _call(ledger, base_prompt, ref_id=ref_id, name_hashes=name_hashes)
    out = Synthesis(paragraphs=[], matrix=[], model=first.model, results=[first])
    raw = list((first.data or {}).get("synthesis") or [])
    for index, p in enumerate(raw):
        problem = paragraph_problem(p, valid, words)
        if problem is None:
            cleaned = _clean(p)
            if cleaned["text"] not in {q["text"] for q in out.paragraphs}:
                out.paragraphs.append(cleaned)
            continue
        replacement = None
        if out.regenerated < MAX_REGENERATIONS:
            out.regenerated += 1
            replacement = _regenerate(ledger, base_prompt, p, problem, valid, words, out, ref_id=ref_id,
                                      name_hashes=name_hashes)
        if replacement is None:
            out.dropped.append({"index": index, "reason": problem})
        else:
            out.paragraphs.append(replacement)
    seen: set[int] = set()
    for raw_row in (first.data or {}).get("matrix") or []:
        row = matrix_row(raw_row, valid)
        if row is not None and row["ordinal"] not in seen and contracts.find_forbidden_word(row, list(words)) is None:
            seen.add(row["ordinal"])
            out.matrix.append(row)
    out.matrix.sort(key=lambda r: r["ordinal"])
    if not out.paragraphs:
        raise KitapError("OGR-KITAP-005 sentez boş kaldı: hiçbir paragraf doğrulanmış kaynağa dayanmıyor")
    return out


def _regenerate(ledger: CostLedger, base_prompt: str, bad: Any, problem: str, valid: set[int], words: Sequence[str],
                out: Synthesis, *, ref_id: str | None, name_hashes: Sequence[str]) -> dict | None:
    text = bad.get("text") if isinstance(bad, dict) else ""
    prompt = (f"{base_prompt}\n\nÖnceki yanıttaki şu paragraf kurala uymadı ({problem}):\n\"{text}\"\n"
              f"Bu paragrafı yalnız şu kaynak numaralarına dayanarak yeniden yaz: {sorted(valid)}. "
              "'synthesis' dizisine yalnız yeniden yazılan paragrafı koy.")
    try:
        res = _call(ledger, prompt, ref_id=ref_id, name_hashes=name_hashes)
    except LedgerError as exc:
        if exc.code == "OGR-LLM-002":   # harcama engeli: paragrafı atmak yerine iş kuyruğa döner
            raise
        return None
    out.results.append(res)
    present = {q["text"] for q in out.paragraphs}
    for p in (res.data or {}).get("synthesis") or []:
        if paragraph_problem(p, valid, words) is None:
            cleaned = _clean(p)
            if cleaned["text"] not in present:
                return cleaned
    return None
