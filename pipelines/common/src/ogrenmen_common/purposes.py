"""Amaç ↔ sözleşme eşlemesi ve yapılandırılmış çıktı doğrulaması.

``fixtures/llm/<amaç>/`` klasörleri §2.3'teki sözleşmelerin geçerli örnekleridir; ``bad-schema*.json``
bilerek geçersizdir. ``"exam-item[]"`` gösterimi "exam-item dizisi" demektir (OCR çıktısı).
"""

from __future__ import annotations

from typing import Any

import ogrenmen_contracts as contracts

FIXTURE_SCHEMAS: dict[str, str] = {
    "chat": "tutor-reply",
    "chat_group": "tutor-reply",
    "nightly_facts": "nightly-facts-output",
    "weekly_summary": "weekly-summary",
    "question_gen": "question-generation",
    "vision_check": "figure-render-report",
    "ocr": "exam-item[]",
    "lesson_analysis": "lesson-analysis",
    "transcribe": "transcript",
    "diarize": "transcript",
    "query_expand": "query-expand",
    "research": "research-output",
}
"""``fixtures/llm`` klasörü → sözleşme (M13 ``fixtures-valid`` işiyle aynı eşleme)."""

PURPOSE_SCHEMAS: dict[str, str] = {k: v for k, v in FIXTURE_SCHEMAS.items() if k != "chat_group"}
"""``llm_calls.purpose`` → çıktı sözleşmesi (sohbet Worker'dadır; pipelines kullanmaz)."""


def output_errors(schema_spec: str, data: Any) -> list[str]:
    """Sözleşme hataları (boş liste = geçerli). ``"<ad>[]"`` her elemanı ``<ad>``'a göre denetler."""
    if schema_spec.endswith("[]"):
        name = schema_spec[:-2]
        if not isinstance(data, list) or not data:
            return [f"{name} dizisi bekleniyordu"]
        out: list[str] = []
        for i, item in enumerate(data):
            out.extend(f"/{i}{e.path} {e.message}" for e in contracts.errors(name, item))
        return out
    return [f"{e.path or '/'} {e.message}" for e in contracts.errors(schema_spec, data)]


def is_valid_output(schema_spec: str, data: Any) -> bool:
    return not output_errors(schema_spec, data)


def validate_output(schema_spec: str, data: Any) -> Any:
    """Geçersizse ``ContractValidationError`` (dizi gösteriminde ilk geçersiz eleman)."""
    if schema_spec.endswith("[]"):
        if not isinstance(data, list) or not data:
            raise contracts.ContractValidationError(
                schema_spec, [contracts.ContractIssue(path="", keyword="type", message="dizi bekleniyordu")]
            )
        for item in data:
            contracts.validate(schema_spec[:-2], item)
        return data
    return contracts.validate(schema_spec, data)
