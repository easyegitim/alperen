"""Tablet fixture'ları: şekil kodu örnekleri (good/blank/net/bad.svg), generation_requests ve question-generation
zarfları (LLM sahtesinin döndürdüğü {item, key})."""

from __future__ import annotations

from typing import Any

from content import sk
from fxlib import CURRICULUM_CODE, CURRICULUM_ID, ENROLL, STAFF, uid

GOOD_PY = '''"""Kesir modeli: 5/6 ve 1/4 (Tablet render sandbox örneği; çalışma dizinine figure.png yazar)."""
import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt

PAPER, NAVY, PRIMARY = "#f6f8fc", "#051c60", "#0030a2"
fig, axes = plt.subplots(2, 1, figsize=(8, 4), dpi=100, facecolor=PAPER)
for ax, (pay, payda, etiket) in zip(axes, [(5, 6, "5/6"), (1, 4, "1/4")]):
    ax.set_facecolor(PAPER)
    for i in range(payda):
        renk = PRIMARY if i < pay else PAPER
        ax.add_patch(plt.Rectangle((i / payda, 0), 1 / payda, 1, facecolor=renk, edgecolor=NAVY, linewidth=2))
    ax.set_xlim(0, 1.25)
    ax.set_ylim(-0.1, 1.1)
    ax.text(1.05, 0.5, etiket, fontsize=18, color=NAVY, va="center")
    ax.axis("off")
fig.tight_layout()
fig.savefig("figure.png", dpi=100, facecolor=PAPER)
'''

BLANK_PY = '''"""Boş görüntü: çizim yok, piksel varyansı ≈ 0 → boyut denetiminde reddedilmeli."""
import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt

fig = plt.figure(figsize=(8, 4), dpi=100, facecolor="#ffffff")
ax = fig.add_axes([0, 0, 1, 1])
ax.axis("off")
fig.savefig("figure.png", dpi=100, facecolor="#ffffff")
'''

NET_PY = '''"""Ağ erişimi deniyor: AST ön denetimi `socket` içe alımını reddetmeli (render edilmez)."""
import socket

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt

baglanti = socket.create_connection(("example.org", 80), timeout=1)
fig = plt.figure(figsize=(8, 4), dpi=100)
plt.plot([0, 1], [0, 1])
fig.savefig("figure.png")
'''

BAD_SVG = '''<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="800" height="400" viewBox="0 0 800 400">
  <rect x="10" y="10" width="780" height="380" fill="#f6f8fc" stroke="#051c60"
  <line x1="40" y1="200" x2="760" y2="200" stroke="#051c60" stroke-width="3">
  <text x="400" y="240" fill="#0030a2">-2 &lt; x &lt; 4
</svg
'''


def _verification() -> dict[str, Any]:
    return {"schema": True, "sympy": "pending", "render": "pending", "vision": "pending", "attempts": 0,
            "status": "draft", "review_note": None}


def _prov(tokens: int) -> dict[str, Any]:
    return {"model": "gemini-2.5-flash-lite", "cost_usd": round(1500 * 0.1e-6 + tokens * 0.4e-6, 6),
            "prompt_version": "question_gen.v1"}


def question_gen() -> list[tuple[str, dict[str, Any]]]:
    good = {
        "schema_version": "1.0",
        "item": {
            "schema_version": "1.0", "curriculum_code": CURRICULUM_CODE, "kind": "mcq",
            "skill_ids": [sk("temel.rasyonel-sayilar")],
            "stem": "Şekilde 6 eş parçadan 5'i ve 4 eş parçadan 1'i boyalı iki kesir modeli var. `5/6 - 1/4` "
                    "işleminin sonucu kaçtır?",
            "stem_values": {"pay1": 5, "payda1": 6, "pay2": 1, "payda2": 4},
            "figure": {"tool": "matplotlib", "code": GOOD_PY,
                       "alt_text": "Üstte 6 eş parçaya bölünmüş, 5 parçası boyalı; altta 4 eş parçaya bölünmüş, "
                                   "1 parçası boyalı iki dikdörtgen.",
                       "expected_px": {"min_w": 600, "max_w": 1000, "min_h": 300, "max_h": 600}},
            "options": [
                {"key": "A", "text": "`4/2`", "misconception_tag": "rasyonel.pay-payda-ayri-toplama"},
                {"key": "B", "text": "`7/12`", "misconception_tag": None},
                {"key": "C", "text": "`4/6`", "misconception_tag": "rasyonel.payda-esitlemeden-toplama"},
                {"key": "D", "text": "`1/12`", "misconception_tag": None}],
            "difficulty": 0.5, "source": "llm", "verification": _verification(), "provenance": _prov(420)},
        "key": {"correct_option": "B", "canonical_expr": "Rational(5,6) - Rational(1,4)",
                "solution": "Paydaları 12'de eşitle: `10/12 - 3/12 = 7/12`.", "sympy_status": "verified",
                "sympy_report": {"expr": "Rational(5,6) - Rational(1,4)", "value": "7/12", "matched_option": "B"}},
    }
    oran = {
        "schema_version": "1.0",
        "item": {
            "schema_version": "1.0", "curriculum_code": CURRICULUM_CODE, "kind": "mcq",
            "skill_ids": [sk("cebir.oran-oranti")],
            "stem": "Bir tarifte 3 yumurtaya 2 su bardağı un gidiyor. Aynı tariften 9 yumurtayla yapmak için kaç "
                    "bardak un gerekir?",
            "stem_values": {}, "figure": None,
            "options": [
                {"key": "A", "text": "`6`", "misconception_tag": None},
                {"key": "B", "text": "`3`", "misconception_tag": "oran.ters-oran-dogru-gibi"},
                {"key": "C", "text": "`8`", "misconception_tag": None},
                {"key": "D", "text": "`18`", "misconception_tag": "genel.soruyu-yarim-okuma"}],
            "difficulty": 0.4, "source": "llm", "verification": _verification(), "provenance": _prov(380)},
        "key": {"correct_option": "A", "canonical_expr": "Rational(2,3) * 9",
                "solution": "Doğru orantı: `3/2 = 9/x`, buradan `x = 6` bardak.", "sympy_status": "verified",
                "sympy_report": {"expr": "Rational(2,3) * 9", "value": "6", "matched_option": "A"}},
    }
    numeric = {
        "schema_version": "1.0",
        "item": {
            "schema_version": "1.0", "curriculum_code": CURRICULUM_CODE, "kind": "numeric",
            "skill_ids": [sk("temel.ondalik")],
            "stem": "`0,125` ondalık sayısını en sade kesir olarak yazınız (pay/payda biçiminde).",
            "stem_values": {}, "figure": None, "difficulty": 0.5, "source": "llm", "verification": _verification(),
            "provenance": _prov(300)},
        "key": {"numeric_value": "1/8", "numeric_tolerance": 0, "canonical_expr": "Rational(125, 1000)",
                "solution": "`0,125 = 125/1000`; pay ve paydayı 125'e böl: `1/8`.", "sympy_status": "verified",
                "sympy_report": {"expr": "Rational(125, 1000)", "value": "1/8", "matched_option": None}},
    }
    bad_sympy = {
        "schema_version": "1.0",
        "item": {
            "schema_version": "1.0", "curriculum_code": CURRICULUM_CODE, "kind": "mcq",
            "skill_ids": [sk("temel.rasyonel-sayilar")], "stem": "`2/3 + 1/4` işleminin sonucu kaçtır?",
            "stem_values": {}, "figure": None,
            "options": [
                {"key": "A", "text": "`3/7`", "misconception_tag": "rasyonel.pay-payda-ayri-toplama"},
                {"key": "B", "text": "`11/12`", "misconception_tag": None},
                {"key": "C", "text": "`3/4`", "misconception_tag": "rasyonel.payda-esitlemeden-toplama"},
                {"key": "D", "text": "`5/12`", "misconception_tag": None}],
            "difficulty": 0.5, "source": "llm", "verification": _verification(), "provenance": _prov(360)},
        # Bilerek yanlış anahtar: ifade 11/12 verir (B), LLM D dedi → SymPy denetimi 'failed' olmalı.
        "key": {"correct_option": "D", "canonical_expr": "Rational(2,3) + Rational(1,4)",
                "solution": "Paydaları 12'de eşitle: `8/12 + 3/12 = 5/12`.", "sympy_status": "verified",
                "sympy_report": {"expr": "Rational(2,3) + Rational(1,4)", "value": "5/12", "matched_option": "D"}},
    }
    return [("01-rasyonel-kesir-modeli.json", good), ("02-oran-oranti.json", oran), ("03-bad-sympy.json", bad_sympy),
            ("04-ondalik-numeric.json", numeric)]


def question_gen_bad_schema() -> dict[str, Any]:
    """Şemaya aykırı: item içinde correct_option (additionalProperties), 3 şık, key'de solution yok."""
    return {
        "item": {
            "schema_version": "1.0", "curriculum_code": "TYT-MAT", "kind": "mcq",
            "skill_ids": [sk("temel.rasyonel-sayilar")], "stem": "`1/2 + 1/4` kaçtır?", "figure": None,
            "options": [{"key": "A", "text": "`3/4`", "misconception_tag": None},
                        {"key": "B", "text": "`2/6`", "misconception_tag": "rasyonel.pay-payda-ayri-toplama"},
                        {"key": "C", "text": "`2/4`", "misconception_tag": "rasyonel.payda-esitlemeden-toplama"}],
            "correct_option": "A", "source": "llm", "verification": {"schema": False}},
        "key": {"correct_option": "A", "sympy_status": "maybe"},
    }


def generation_requests() -> list[dict[str, Any]]:
    """3 açık istek: 2 pool_miss + 1 exam_variant (topic ve plan_id dolu; ocr_text alanı YOK)."""
    return [
        {"id": uid("generation_request", "pool-ondalik"), "kind": "pool_miss", "curriculum_id": CURRICULUM_ID,
         "skill_id": sk("temel.ondalik"), "difficulty_band": "mid", "topic": None, "question_kind": "mcq",
         "points": None, "plan_id": None, "requested_by": ENROLL["elif"], "requested_by_staff": None,
         "served_question_id": None, "served_at": None, "needs_generation": True, "created_at": "2026-10-18T20:40:00Z"},
        {"id": uid("generation_request", "pool-kesir"), "kind": "pool_miss", "curriculum_id": CURRICULUM_ID,
         "skill_id": sk("problem.kesir"), "difficulty_band": "easy", "topic": None, "question_kind": "mcq",
         "points": None, "plan_id": None, "requested_by": ENROLL["mert"], "requested_by_staff": None,
         "served_question_id": None, "served_at": None, "needs_generation": True, "created_at": "2026-10-18T21:20:00Z"},
        {"id": uid("generation_request", "variant-mutlak"), "kind": "exam_variant", "curriculum_id": CURRICULUM_ID,
         "skill_id": sk("cebir.mutlak-deger"), "difficulty_band": "mid", "topic": "Mutlak değer",
         "question_kind": "mcq", "points": 4.0, "plan_id": uid("plan", "TYT-MAT:v2"), "requested_by": None,
         "requested_by_staff": STAFF["inst"]["id"], "served_question_id": None, "served_at": None,
         "needs_generation": True, "created_at": "2026-10-19T09:00:00Z"},
    ]


def vision_check() -> list[tuple[str, dict[str, Any]]]:
    return [
        ("01-match.json", {"schema_version": "1.0", "matches_stem": True, "status": "match", "mismatches": [],
                           "notes": "İki kesir modeli kökteki 5/6 ve 1/4 değerleriyle uyumlu.",
                           "render": {"status": "ok", "tool": "matplotlib", "width_px": 800, "height_px": 400,
                                      "bytes": 14820, "pixel_variance": 3021.4, "duration_ms": 640}}),
        ("02-mismatch.json", {"schema_version": "1.0", "matches_stem": False, "status": "mismatch",
                              "mismatches": [{"field": "payda2", "expected": 4, "observed": 3,
                                              "note": "Alt dikdörtgen 3 eş parçaya bölünmüş."},
                                             "Etiket 1/3 yazıyor, kökte 1/4 geçiyor."],
                              "notes": "Şekil kodu alt modeli yanlış paydayla çiziyor.",
                              "render": {"status": "ok", "tool": "matplotlib", "width_px": 800, "height_px": 400,
                                         "bytes": 14310}}),
    ]
