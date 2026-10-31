"""Şablon ``kesir-modeli-toplama`` — iki kesir modeliyle toplama (temel.rasyonel-sayilar; şekilli).

Şekil: iki dikdörtgen, ``{2, 3, 4, 6, 8, 12}`` paydalı eş parçalara bölünmüş, ``pay`` kadar parçası boyalı.
Çeldiriciler: ``rasyonel.pay-payda-ayri-toplama``, ``rasyonel.payda-esitlemeden-toplama`` ve bir etiketsiz
hesap hatası (ortak paydada payı bir eksik/fazla).
"""

from __future__ import annotations

import math
import random
import sys
from pathlib import Path

import sympy

try:
    from ._common import Choice, FigureSpec, assemble, code, draw_fraction_models, fmt_num, run_generator
except ImportError:  # dosya yolundan yüklendi (module_path)
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    from _common import Choice, FigureSpec, assemble, code, draw_fraction_models, fmt_num, run_generator

TEMPLATE_ID = "kesir-modeli-toplama"
SKILL_ID = "tyt.mat.temel.rasyonel-sayilar"
ENGINE = "matplotlib"
HAS_FIGURE = True
TAGS = ("rasyonel.pay-payda-ayri-toplama", "rasyonel.payda-esitlemeden-toplama")
PAYDALAR = (2, 3, 4, 6, 8, 12)
PARAMS_SCHEMA = {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "title": "kesir-modeli-toplama parametreleri",
    "type": "object",
    "additionalProperties": False,
    "required": ["pay_1", "payda_1", "pay_2", "payda_2"],
    "properties": {
        "pay_1": {"type": "integer", "minimum": 1, "maximum": 11},
        "payda_1": {"enum": list(PAYDALAR)},
        "pay_2": {"type": "integer", "minimum": 1, "maximum": 11},
        "payda_2": {"enum": list(PAYDALAR)},
    },
}


def _frac(num: int, den: int, tag: str | None = None, reduce: bool = True) -> Choice:
    text = fmt_num(sympy.Rational(num, den)) if reduce else f"{num}/{den}"
    return Choice(code(text), sympy.Rational(num, den), tag)


def figure_spec(p1: int, q1: int, p2: int, q2: int) -> FigureSpec:
    params = {"kesirler": [{"pay": p1, "payda": q1, "label": "1. model"},
                           {"pay": p2, "payda": q2, "label": "2. model"}]}
    alt = (f"İki dikdörtgen modeli. Soldaki {q1} eş parçaya bölünmüş, {p1} parçası boyalı; "
           f"sağdaki {q2} eş parçaya bölünmüş, {p2} parçası boyalı.")
    return FigureSpec(template_id=TEMPLATE_ID, params=params, alt_text=alt, draw=draw_fraction_models)


def _build(rng: random.Random):
    q1, q2 = rng.sample(PAYDALAR, 2)
    p1, p2 = rng.randint(1, q1 - 1), rng.randint(1, q2 - 1)
    lcm = math.lcm(q1, q2)
    total = sympy.Rational(p1, q1) + sympy.Rational(p2, q2)
    num = p1 * lcm // q1 + p2 * lcm // q2
    slip = num + rng.choice([-1, 1])
    stem = (f"Şekilde soldaki dikdörtgen {q1} eş parçaya bölünmüş ve {p1} parçası boyanmış; sağdaki dikdörtgen "
            f"{q2} eş parçaya bölünmüş ve {p2} parçası boyanmış. Boyalı kısımların gösterdiği iki kesrin toplamı kaçtır?")
    solution = (f"Modeller {code(f'{p1}/{q1}')} ve {code(f'{p2}/{q2}')} kesirlerini gösterir. Paydaları {lcm}'de eşitle: "
                f"`{p1 * lcm // q1}/{lcm} + {p2 * lcm // q2}/{lcm} = {num}/{lcm}`")
    reduced = fmt_num(total)
    solution += f"; sadeleşince `{reduced}`." if reduced != f"{num}/{lcm}" else "."
    figure = figure_spec(p1, q1, p2, q2)
    item, key = assemble(
        rng=rng,
        template_id=TEMPLATE_ID,
        skill_ids=[SKILL_ID],
        stem=stem,
        correct=Choice(code(fmt_num(total)), total),
        distractors=[
            _frac(p1 + p2, q1 + q2, "rasyonel.pay-payda-ayri-toplama", reduce=False),
            _frac(p1 + p2, max(q1, q2), "rasyonel.payda-esitlemeden-toplama", reduce=False),
            _frac(slip, lcm) if slip > 0 else _frac(num + 2, lcm),
        ],
        canonical_expr=f"Rational({p1},{q1}) + Rational({p2},{q2})",
        numeric_value=fmt_num(total),
        solution=solution,
        params={"pay_1": p1, "payda_1": q1, "pay_2": p2, "payda_2": q2},
        stem_values={"pay_1": p1, "payda_1": q1, "pay_2": p2, "payda_2": q2},
        figure=figure,
    )
    return item, key, figure


def generate(rng: random.Random):
    """``(QuestionItem, AnswerKey, FigureSpec)``."""
    return run_generator(_build, rng)
