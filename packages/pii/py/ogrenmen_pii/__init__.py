"""Öğrenmen PII temizleyici — `scrub()` ve ad-token hash yardımcıları.

TypeScript eşleniği `packages/pii/ts` (`@ogrenmen/pii`); iki uygulama aynı
`packages/pii/cases.json` vakalarını geçer.
"""

from .scrub import (
    ANSWER_WORDS,
    ERROR_CODES,
    FOLD_FROM,
    FOLD_TO,
    KINDS,
    PATTERNS,
    PLACEHOLDERS,
    ROLE_LABELS,
    RULES_VERSION,
    VERDICT_WORDS,
    Replacement,
    ScrubResult,
    config,
    is_valid_tckn,
    name_token_hashes,
    normalize_token,
    scrub,
    sha256_hex,
    token_hash,
    total_replacements,
)

__all__ = [
    "ANSWER_WORDS",
    "ERROR_CODES",
    "FOLD_FROM",
    "FOLD_TO",
    "KINDS",
    "PATTERNS",
    "PLACEHOLDERS",
    "ROLE_LABELS",
    "RULES_VERSION",
    "VERDICT_WORDS",
    "Replacement",
    "ScrubResult",
    "config",
    "is_valid_tckn",
    "name_token_hashes",
    "normalize_token",
    "scrub",
    "sha256_hex",
    "token_hash",
    "total_replacements",
]
__version__ = "0.1.0"
