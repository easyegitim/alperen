"""Öğrenmen Kitap (M10) — araştırma ajanı (BLUEPRINT §6.5).

Akış: kapı (``research_enabled``, ``check_spend('research')``, ``research_monthly_cap``) → ``query_expand`` (3–5
sorgu) → OpenAlex + Semantic Scholar + arXiv adayları (skor, DOI'ye göre tekilleştirme, ilk 30) → her DOI Crossref
(``verified`` | ``crossref_unresolved`` | ``title_mismatch``; DOI'siz kurumsal bağlantı ``no_doi``) → Unpaywall PDF'leri
(≤ 6, ≤ 40 sayfa, toplam ≤ 150k token) → ``research`` sentezi (her paragraf doğrulanmış kaynağa bağlı) → BibTeX/APA
(Crossref üst verisinden şablonla) → ``research_outputs(pending_review)`` + ``citations``.
"""

__version__ = "0.1.0"
