"""Tür eşleme tablosu — TEK KAYNAK (BLUEPRINT §6.4).

``exam_items.kind`` → ``exam-priority-plan.rows[].kind`` → ``generation_requests.question_kind``:

=================  ==================  =================  ============================================
``exam_items``     plan satırı         ``question_kind``  not
=================  ==================  =================  ============================================
``mc``             ``çoktan seçmeli``  ``mcq``            —
``calc``           ``hesap``           ``numeric``        sayısal cevap; SymPy kapısı
``other``          ``diğer``           ``mcq``            varsayılan
``proof``          ``ispat``           —                  varyant üretilmez (Tablet ispat sorusu üretmez)
=================  ==================  =================  ============================================

Başka hiçbir modül bu değerleri kendi yazmaz; ``tests/test_kinds.py::test_kinds_is_single_source`` plan türü
dizelerinin yalnız bu dosyada geçtiğini denetler.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class KindRow:
    exam_kind: str
    plan_kind: str
    question_kind: str | None
    note: str


KIND_TABLE: tuple[KindRow, ...] = (
    KindRow("mc", "çoktan seçmeli", "mcq", "—"),
    KindRow("calc", "hesap", "numeric", "sayısal cevap; SymPy kapısı"),
    KindRow("other", "diğer", "mcq", "varsayılan"),
    KindRow("proof", "ispat", None, "varyant üretilmez"),
)

EXAM_KINDS: tuple[str, ...] = tuple(r.exam_kind for r in KIND_TABLE)
"""``exam_items.kind`` check kısıtındaki değerler (``proof, calc, mc, other`` kümesi)."""
PLAN_KINDS: tuple[str, ...] = tuple(r.plan_kind for r in KIND_TABLE)
"""``exam-priority-plan.rows[].kind`` enum'u."""
DEFAULT_EXAM_KIND = "other"
KIND_PRIORITY: tuple[str, ...] = ("mc", "calc", "other", "proof")
"""Kümede türler eşit sayıdaysa seçim sırası (deterministik)."""

_BY_EXAM = {r.exam_kind: r for r in KIND_TABLE}
_BY_PLAN = {r.plan_kind: r for r in KIND_TABLE}


def normalize_exam_kind(value: object) -> str:
    """OCR çıktısındaki tür; tanınmayan ya da boş değer ``other`` (tablo varsayılanı)."""
    text = str(value or "").strip().lower()
    return text if text in _BY_EXAM else DEFAULT_EXAM_KIND


def plan_kind(exam_kind: str) -> str:
    """``exam_items.kind`` → plan satırı türü."""
    return _BY_EXAM[normalize_exam_kind(exam_kind)].plan_kind


def exam_kind_of_plan(plan_kind_value: str) -> str:
    """Plan satırı türü → ``exam_items.kind``; bilinmeyen tür ``KeyError``."""
    return _BY_PLAN[plan_kind_value].exam_kind


def question_kind(exam_kind: str) -> str | None:
    """``exam_items.kind`` → ``generation_requests.question_kind``; ``proof`` için ``None`` (varyant yok)."""
    return _BY_EXAM[normalize_exam_kind(exam_kind)].question_kind


def question_kind_for_plan(plan_kind_value: str) -> str | None:
    """Plan satırı türü → ``question_kind``; ``ispat`` → ``None``."""
    return _BY_PLAN[plan_kind_value].question_kind


def variant_allowed(plan_kind_value: str) -> bool:
    """Bu tür için Tablet varyant isteği yazılabilir mi (``ispat`` → hayır)."""
    return question_kind_for_plan(plan_kind_value) is not None
