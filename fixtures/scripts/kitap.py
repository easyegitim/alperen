"""Kitap (araştırma ajanı) fixture'ları: OpenAlex / Semantic Scholar / arXiv / Crossref / Unpaywall sahte yanıtları,
research_requests kuyruğu ve research-output örnekleri.

Gerçek yayınlar (Cepeda 2006, Rohrer & Taylor 2007, Dunlosky 2013) yalnız üst verileriyle yer alır.
`10.9999/fake` DOI'si ve `10.5555/ogrenmen.mismatch` bilerek sahtedir (Crossref 404 ve başlık uyuşmazlığı
yolları); arXiv kayıtları sentetiktir (ay alanı 13 olan kimlikler gerçek bir arXiv kaydına denk gelmez).
"""

from __future__ import annotations

from typing import Any

from fxlib import STAFF, STUDENTS, uid

QUERY = "spaced repetition matematik"

P1 = {"doi": "10.1037/0033-2909.132.3.354",
      "title": "Distributed practice in verbal recall tasks: A review and quantitative synthesis",
      "authors": [("Nicholas J.", "Cepeda"), ("Harold", "Pashler"), ("Edward", "Vul"), ("John T.", "Wixted"),
                  ("Doug", "Rohrer")], "venue": "Psychological Bulletin", "year": 2006, "cited": 3150}
P2 = {"doi": "10.1007/s11251-007-9015-8", "title": "The shuffling of mathematics problems improves learning",
      "authors": [("Doug", "Rohrer"), ("Kelli", "Taylor")], "venue": "Instructional Science", "year": 2007, "cited": 640}
P3 = {"doi": "10.1177/1529100612453266",
      "title": "Improving Students' Learning With Effective Learning Techniques: Promising Directions From Cognitive "
               "and Educational Psychology",
      "authors": [("John", "Dunlosky"), ("Katherine A.", "Rawson"), ("Elizabeth J.", "Marsh"), ("Mitchell J.", "Nathan"),
                  ("Daniel T.", "Willingham")], "venue": "Psychological Science in the Public Interest", "year": 2013,
      "cited": 4200}
P4 = {"doi": "10.9999/fake", "title": "Aralıklı tekrarın matematik başarısına etkisi: bir meta-analiz",
      "authors": [("A.", "Yazar")], "venue": "Uydurma Eğitim Dergisi", "year": 2021, "cited": 3}
P5 = {"doi": "10.5555/ogrenmen.mismatch", "title": "Spaced practice in algebra homework",
      "authors": [("B.", "Örnek")], "venue": "Örnek Dergi", "year": 2019, "cited": 12}
A1 = {"arxiv_id": "2513.00017", "doi": P2["doi"], "title": P2["title"], "authors": ["Doug Rohrer", "Kelli Taylor"],
      "published": "2025-12-01", "pdf_url": "https://arxiv.org/pdf/2513.00017"}
A2 = {"arxiv_id": "2513.00042", "doi": None,
      "title": "Interleaved and spaced retrieval practice for secondary school algebra",
      "authors": ["Sentetik Yazar", "Örnek Araştırmacı"], "published": "2025-12-02",
      "pdf_url": "https://arxiv.org/pdf/2513.00042"}


def _authors_str(p: dict[str, Any]) -> str:
    return "; ".join(f"{fam}, {giv}" for giv, fam in p["authors"])


def openalex() -> dict[str, Any]:
    def work(p: dict[str, Any], wid: str, oa: str | None) -> dict[str, Any]:
        return {"id": f"https://openalex.org/{wid}", "doi": f"https://doi.org/{p['doi']}", "title": p["title"],
                "display_name": p["title"], "publication_year": p["year"], "cited_by_count": p["cited"],
                "authorships": [{"author": {"display_name": f"{g} {f}"}} for g, f in p["authors"]],
                "primary_location": {"source": {"display_name": p["venue"]}},
                "open_access": {"is_oa": oa is not None, "oa_url": oa}, "language": "en", "type": "article"}
    return {"meta": {"count": 4, "page": 1, "per_page": 25, "query": QUERY},
            "results": [work(P1, "W2105935416", None), work(P2, "W2040781230", "https://example.org/oa/rohrer-2007.pdf"),
                        work(P3, "W2147186036", "https://example.org/oa/dunlosky-2013.pdf"),
                        work(P5, "W4999999901", None)]}


def s2() -> dict[str, Any]:
    def paper(p: dict[str, Any], pid: str, tldr: str | None) -> dict[str, Any]:
        return {"paperId": pid, "title": p["title"], "year": p["year"], "citationCount": p["cited"],
                "externalIds": {"DOI": p["doi"]}, "authors": [{"name": f"{g} {f}"} for g, f in p["authors"]],
                "venue": p["venue"], "tldr": {"text": tldr} if tldr else None, "openAccessPdf": None}
    return {"total": 3, "offset": 0, "query": QUERY,
            "data": [paper(P1, "s2-0001", "Aralıklı çalışma, toplu çalışmaya göre uzun süreli hatırlamayı artırır."),
                     paper(P3, "s2-0002", "Aralıklı tekrar ve kendini sınama yüksek fayda sağlayan tekniklerdir."),
                     paper(P4, "s2-0003", None)]}


def arxiv() -> dict[str, Any]:
    """arXiv Atom yanıtının normalize JSON hâli (adapters/arxiv.py çıktısı biçimi): 2 kayıt, biri DOI'siz."""
    return {"query": QUERY, "source": "arxiv", "total": 2,
            "entries": [dict(e, summary="Sentetik özet: aralıklı ve karışık pratik etkisini inceleyen çalışma.",
                             primary_category="math.HO") for e in (A1, A2)]}


def crossref_ok() -> dict[str, Any]:
    def msg(p: dict[str, Any], title: str | None = None) -> dict[str, Any]:
        return {"status": "ok", "message-type": "work", "message": {
            "DOI": p["doi"], "title": [title or p["title"]], "type": "journal-article",
            "author": [{"given": g, "family": f} for g, f in p["authors"]], "container-title": [p["venue"]],
            "issued": {"date-parts": [[p["year"]]]}, "URL": f"https://doi.org/{p['doi']}",
            "is-referenced-by-count": p["cited"]}}
    return {P1["doi"]: msg(P1), P2["doi"]: msg(P2), P3["doi"]: msg(P3),
            P5["doi"]: msg(P5, "Soil moisture dynamics in semi-arid grasslands")}


def crossref_404() -> dict[str, Any]:
    return {P4["doi"]: {"status": 404, "body": "Resource not found."}}


def unpaywall() -> dict[str, Any]:
    def rec(p: dict[str, Any], url: str | None) -> dict[str, Any]:
        return {"doi": p["doi"], "is_oa": url is not None,
                "best_oa_location": {"url_for_pdf": url, "host_type": "repository", "license": None} if url else None}
    return {P1["doi"]: rec(P1, None), P2["doi"]: rec(P2, "https://example.org/oa/rohrer-2007.pdf"),
            P3["doi"]: rec(P3, "https://example.org/oa/dunlosky-2013.pdf"), P5["doi"]: rec(P5, None)}


def _cit(n: int, p: dict[str, Any], sim: float, tldr: str, source: str, oa: str | None = None) -> dict[str, Any]:
    return {"ordinal": n, "doi": p["doi"], "title": p["title"], "authors": _authors_str(p), "venue": p["venue"],
            "year": p["year"], "crossref_status": "verified", "title_similarity": sim,
            "verified_at": "2026-10-18T00:20:00Z", "oa_pdf_url": oa, "tldr": tldr, "source": source}


def _bib(p: dict[str, Any], key: str) -> str:
    auth = " and ".join(f"{f}, {g}" for g, f in p["authors"])
    return (f"@article{{{key},\n  title = {{{p['title']}}},\n  author = {{{auth}}},\n  journal = {{{p['venue']}}},\n"
            f"  year = {{{p['year']}}},\n  doi = {{{p['doi']}}}\n}}\n")


def _apa(p: dict[str, Any]) -> str:
    auth = ", ".join(f"{f}, {g[0]}." for g, f in p["authors"])
    return f"{auth} ({p['year']}). {p['title']}. {p['venue']}. https://doi.org/{p['doi']}"


def research_llm_1() -> dict[str, Any]:
    """LLM'in döndürdüğü ham çıktı: 5. atıf (10.9999/fake) Crossref'te çözülmez; ona dayanan paragraf atılır."""
    c4 = {"ordinal": 4, "title": A2["title"], "authors": "; ".join(A2["authors"]), "venue": None, "year": 2025,
          "crossref_status": "no_doi", "oa_pdf_url": A2["pdf_url"],
          "tldr": "Cebirde aralıklı ve karışık tekrarın sınav performansına etkisini tartışır.", "source": "arxiv"}
    c5 = _cit(5, P4, 0.95, "Aralıklı tekrarın matematik başarısını artırdığını öne sürer.", "semantic_scholar")
    return {
        "schema_version": "1.0", "request_id": uid("research_request", "elif-1"), "query": QUERY,
        "expanded_queries": ["spaced repetition mathematics learning", "distributed practice math achievement",
                             "aralıklı tekrar matematik öğrenme", "interleaved practice mathematics problems"],
        "synthesis": [
            {"text": "Aralıklı çalışma, aynı sürenin tek oturumda toplanmasına göre uzun süreli hatırlamayı "
                     "güvenilir biçimde artırır; etki, tekrarlar arasındaki aralık sınav tarihine göre ayarlandığında "
                     "en yüksektir.", "cites": [1, 3]},
            {"text": "Matematikte problem türlerinin karıştırılarak ve aralıklı çalışılması, aynı türün art arda "
                     "çözülmesine göre gecikmeli testte daha iyi sonuç vermiştir.", "cites": [2, 4]},
            {"text": "Türkiye'deki öğrencilerde aralıklı tekrarın başarıyı kesin olarak iki katına çıkardığı "
                     "bildirilmiştir.", "cites": [5]},
        ],
        "citations": [
            _cit(1, P1, 0.98, "Aralıklı çalışma, toplu çalışmaya göre uzun süreli hatırlamayı artırır.", "openalex"),
            _cit(2, P2, 0.97, "Karışık sıralanmış matematik problemleri gecikmeli testte daha iyi sonuç verir.",
                 "openalex", "https://example.org/oa/rohrer-2007.pdf"),
            _cit(3, P3, 0.96, "Aralıklı tekrar ve kendini sınama yüksek fayda sağlayan tekniklerdir.",
                 "semantic_scholar", "https://example.org/oa/dunlosky-2013.pdf"),
            c4, c5,
        ],
        "matrix": [
            {"ordinal": 1, "method": "Meta-analiz", "sample": "317 deney", "finding": "Aralıklı çalışma hatırlamayı artırır",
             "limitation": "Çoğunlukla sözel materyal"},
            {"ordinal": 2, "method": "Deney", "sample": "Üniversite öğrencileri",
             "finding": "Karışık problem sırası gecikmeli testte üstün", "limitation": "Tek konu (hacim problemleri)"},
            {"ordinal": 3, "method": "Derleme", "sample": "10 öğrenme tekniği",
             "finding": "Aralıklı tekrar yüksek fayda", "limitation": "Sınıf içi uygulama verisi sınırlı"},
            {"ordinal": 4, "method": "Gözlemsel", "sample": "Sentetik platform verisi",
             "finding": "Aralıklı tekrar cebirde tutarlı", "limitation": "Hakem değerlendirmesi yok"},
        ],
        "removed": [], "bibtex": _bib(P1, "cepeda2006") + _bib(P2, "rohrer2007") + _bib(P3, "dunlosky2013"),
        "apa": [_apa(P1), _apa(P2), _apa(P3)], "model": "gemini-2.5-flash", "cost_usd": 0.0275,
    }


def research_llm_2() -> dict[str, Any]:
    return {
        "schema_version": "1.0", "request_id": uid("research_request", "staff-1"),
        "query": "kesirlerde aralıklı tekrar ve kendini sınama",
        "expanded_queries": ["retrieval practice fractions", "spacing effect fraction learning",
                             "kendini sınama kesirler"],
        "synthesis": [
            {"text": "Kendini sınama ve aralıklı tekrar, öğrenme tekniklerinin karşılaştırıldığı derlemede yüksek "
                     "fayda sağlayan iki teknik olarak öne çıkar.", "cites": [1]},
            {"text": "Aralıklar arttıkça hatırlama süresi uzar; bu bulgu kesir gibi işlem ağırlıklı konulara "
                     "doğrudan aktarılmadan önce sınıf içinde denenmelidir.", "cites": [2]},
        ],
        "citations": [
            _cit(1, P3, 0.96, "Aralıklı tekrar ve kendini sınama yüksek fayda sağlayan tekniklerdir.", "openalex",
                 "https://example.org/oa/dunlosky-2013.pdf"),
            _cit(2, P1, 0.98, "Aralıklı çalışma, toplu çalışmaya göre uzun süreli hatırlamayı artırır.", "crossref"),
        ],
        "matrix": [
            {"ordinal": 1, "method": "Derleme", "sample": "10 öğrenme tekniği", "finding": "Kendini sınama yüksek fayda",
             "limitation": "Kesir özelinde veri yok"},
            {"ordinal": 2, "method": "Meta-analiz", "sample": "317 deney", "finding": "Aralık arttıkça hatırlama uzar",
             "limitation": "Çoğunlukla sözel materyal"},
        ],
        "removed": [], "bibtex": _bib(P3, "dunlosky2013") + _bib(P1, "cepeda2006"), "apa": [_apa(P3), _apa(P1)],
        "model": "gemini-2.5-flash", "cost_usd": 0.021,
    }


def research_verified() -> dict[str, Any]:
    """Pipeline sonrası hâl (dev-seed research_outputs): sahte DOI ve ona dayanan paragraf çıkarılmış."""
    out = research_llm_1()
    out["citations"] = [c for c in out["citations"] if c["ordinal"] != 5]
    out["synthesis"] = [p for p in out["synthesis"] if 5 not in p["cites"]]
    out["removed"] = [{"doi_or_title": P4["doi"], "reason": "crossref_unresolved"},
                      {"doi_or_title": P5["doi"], "reason": "title_mismatch"},
                      {"doi_or_title": A1["title"], "reason": "duplicate"}]
    return out


def query_expand() -> list[tuple[str, dict[str, Any]]]:
    return [
        ("01-spaced-repetition.json", {"queries": ["spaced repetition mathematics learning",
                                                   "distributed practice math achievement",
                                                   "aralıklı tekrar matematik öğrenme",
                                                   "interleaved practice mathematics problems"]}),
        ("02-kesirler.json", {"queries": ["retrieval practice fractions", "spacing effect fraction learning",
                                          "kendini sınama kesirler"]}),
        ("03-sinav-kaygisi.json", {"queries": ["math anxiety secondary students", "test anxiety mathematics performance",
                                               "matematik kaygısı lise", "sınav kaygısı ve matematik başarısı",
                                               "anxiety intervention mathematics"]}),
    ]


def requests() -> list[dict[str, Any]]:
    """research_requests: 2 queued + 1 done (`kitap run --queued` testi)."""
    return [
        {"id": uid("research_request", "elif-2"), "student_id": STUDENTS["elif"]["id"], "staff_id": None,
         "query": QUERY, "expanded_queries": [], "status": "queued", "cost_usd": 0,
         "created_at": "2026-10-19T17:40:00Z", "finished_at": None},
        {"id": uid("research_request", "staff-1"), "student_id": None, "staff_id": STAFF["inst"]["id"],
         "query": "kesirlerde aralıklı tekrar ve kendini sınama", "expanded_queries": [], "status": "queued",
         "cost_usd": 0, "created_at": "2026-10-19T18:10:00Z", "finished_at": None},
        {"id": uid("research_request", "elif-1"), "student_id": STUDENTS["elif"]["id"], "staff_id": None,
         "query": QUERY, "expanded_queries": research_llm_1()["expanded_queries"], "status": "done",
         "cost_usd": 0.0275, "created_at": "2026-10-17T18:00:00Z", "finished_at": "2026-10-18T00:30:00Z"},
    ]
