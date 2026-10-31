"""Metin yardımcıları: Türkçe duyarlı normalleştirme, belirteçler, DOI biçimi, ASCII katlama."""

from __future__ import annotations

import re
import unicodedata

from ogrenmen_contracts import normalize_tr

_WORD = re.compile(r"[0-9a-zçğıöşü]+")
DOI_RE = re.compile(r"^10\.[0-9]{4,9}/\S+$")
_DOI_PREFIXES = ("https://doi.org/", "http://doi.org/", "https://dx.doi.org/", "http://dx.doi.org/", "doi:")
STOPWORDS = frozenset({
    "the", "and", "for", "with", "from", "into", "that", "this", "are", "its", "their", "how", "what", "does",
    "bir", "ile", "için", "ve", "veya", "olan", "gibi", "daha", "nasıl", "nedir", "mı", "mi", "mu", "mü",
})


def norm(text: str | None) -> str:
    return normalize_tr(text or "")


def tokens(text: str | None) -> list[str]:
    """3+ karakterlik, durak sözcüğü olmayan belirteçler (normalize edilmiş)."""
    return [t for t in _WORD.findall(norm(text)) if len(t) >= 3 and t not in STOPWORDS]


def stem(token: str) -> str:
    """Kaba gövde: ilk 5 karakter (problems/problem, öğrenme/öğrenmek aynı gövdeye düşer)."""
    return token[:5]


def normalize_doi(doi: str | None) -> str | None:
    """``https://doi.org/10.x/Y`` → ``10.x/y`` (DOI büyük/küçük harf duyarsızdır); geçersizse ``None``."""
    if not doi:
        return None
    text = doi.strip()
    low = text.lower()
    for prefix in _DOI_PREFIXES:
        if low.startswith(prefix):
            text = text[len(prefix):]
            break
    text = text.strip().lower()
    return text if DOI_RE.match(text) else None


def ascii_fold(text: str) -> str:
    """BibTeX anahtarı için: Türkçe harfler ASCII karşılığına, aksanlar atılır, yalnız [a-z0-9]."""
    table = str.maketrans({"ı": "i", "İ": "i", "ş": "s", "Ş": "s", "ğ": "g", "Ğ": "g", "ç": "c", "Ç": "c",
                           "ö": "o", "Ö": "o", "ü": "u", "Ü": "u"})
    text = unicodedata.normalize("NFKD", text.translate(table))
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    return re.sub(r"[^a-z0-9]", "", text.lower())


def estimate_tokens(text: str) -> int:
    """Kaba belirteç tahmini (≈ 4 karakter/belirteç; ledger'daki tahminle aynı ölçek)."""
    return max(1, len(text) // 4) if text else 0
