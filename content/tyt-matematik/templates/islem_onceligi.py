"""Şablon ``islem-onceligi`` — işlem önceliği ve işaret kuralları (temel.sayilar; şekilsiz).

Biçimler (§10.4 "parantez, ×/÷, negatifler"): ``negatif-carpim`` ``a + (-b)·(c - d)``, ``parantez-eksi``
``-(a - b) + c·d``, ``eksi-carpim`` ``c - (-a)·(-b)``, ``bolme`` ``a - (-b) ÷ c · d`` (tam bölünür; soldan
okuma ``(a - (-b)) ÷ c · d`` olarak etiketlenir).

Çeldiriciler: ``sayilar.islem-onceligi-soldan`` (soldan sağa işlem), ``sayilar.negatif-carpim-isaret``
ya da ``sayilar.parantez-eksi-dagitma`` ve bir etiketsiz hesap hatası.
"""

from __future__ import annotations

import random
import sys
from pathlib import Path

try:
    from ._common import Choice, TemplateRetry, assemble, code, fmt_num, paren, run_generator
except ImportError:  # dosya yolundan yüklendi (module_path)
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    from _common import Choice, TemplateRetry, assemble, code, fmt_num, paren, run_generator

import sympy

TEMPLATE_ID = "islem-onceligi"
SKILL_ID = "tyt.mat.temel.sayilar"
ENGINE = "sympy"
HAS_FIGURE = False
TAGS = ("sayilar.islem-onceligi-soldan", "sayilar.negatif-carpim-isaret", "sayilar.parantez-eksi-dagitma")
PARAMS_SCHEMA = {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "title": "islem-onceligi parametreleri",
    "type": "object",
    "additionalProperties": False,
    "required": ["bicim", "a", "b", "c", "d"],
    "properties": {
        "bicim": {"enum": ["negatif-carpim", "parantez-eksi", "eksi-carpim", "bolme"],
                  "description": "a + (-b)·(c - d) | -(a - b) + c·d | c - (-a)·(-b) | a - (-b) ÷ c · d"},
        "a": {"type": "integer", "minimum": -9, "maximum": 9},
        "b": {"type": "integer", "minimum": -9, "maximum": 9},
        "c": {"type": "integer", "minimum": -9, "maximum": 9},
        "d": {"type": "integer", "minimum": -9, "maximum": 9},
    },
}

SOLDAN = "sayilar.islem-onceligi-soldan"
NEGATIF = "sayilar.negatif-carpim-isaret"
PARANTEZ = "sayilar.parantez-eksi-dagitma"


def _num(n: int) -> Choice:
    return Choice(code(str(n)), sympy.Integer(n))


def _build(rng: random.Random):
    bicim = rng.choice(["negatif-carpim", "parantez-eksi", "eksi-carpim", "bolme"])
    if bicim == "negatif-carpim":
        # a + (-b)·(c - d), c < d: iki negatifin çarpımı
        a, b = rng.randint(-9, 9), rng.randint(2, 9)
        c, d = rng.randint(1, 8), rng.randint(2, 9)
        if c >= d:
            raise TemplateRetry("c < d olmalı")
        expr = f"{a} + (-{b}) · ({c} - {d})"
        canonical = f"{a} + (-{b})*({c} - {d})"
        value = a + (-b) * (c - d)
        wrong_a = (a + (-b)) * (c - d)
        wrong_b = a - b * (d - c)
        tag_b = NEGATIF
        solution = (f"Önce parantez: `{c} - {d} = {c - d}`. Sonra çarpma: `(-{b}) · ({c - d}) = {b * (d - c)}` "
                    f"(iki negatifin çarpımı pozitiftir). Son olarak `{a} + {b * (d - c)} = {value}`.")
        params = {"bicim": bicim, "a": a, "b": b, "c": c, "d": d}
    elif bicim == "parantez-eksi":
        # -(a - b) + c·d
        a, b = rng.randint(1, 9), rng.randint(1, 9)
        c, d = rng.randint(2, 9), rng.choice([n for n in range(-9, 10) if n != 0])
        if a == b:
            raise TemplateRetry("a ≠ b olmalı")
        expr = f"-({a} - {b}) + {c} · {paren(d)}"
        canonical = f"-({a} - {b}) + {c}*({d})"
        value = -(a - b) + c * d
        wrong_a = (-(a - b) + c) * d
        wrong_b = -a - b + c * d
        tag_b = PARANTEZ
        solution = (f"Eksi parantezdeki her terime dağılır: `-({a} - {b}) = {-a} + {b} = {b - a}`. "
                    f"Çarpma önce yapılır: `{c} · {paren(d)} = {c * d}`. Toplam: `{b - a} + {paren(c * d)} = {value}`.")
        params = {"bicim": bicim, "a": a, "b": b, "c": c, "d": d}
    elif bicim == "bolme":
        # a - (-b) ÷ c · d: bölme ve çarpma soldan sağa, çıkarmadan önce; b ve a, c'nin katı (tam sonuç)
        c = rng.randint(2, 4)
        b = c * rng.randint(1, 9 // c)
        a = c * rng.choice([n for n in range(-(9 // c), 9 // c + 1) if n != 0])
        d = rng.randint(2, 9)
        expr = f"{a} - (-{b}) ÷ {c} · {d}"
        canonical = f"{a} - (-{b})/{c}*{d}"
        quotient = -b // c
        value = a - quotient * d
        wrong_a = (a + b) // c * d  # soldan sağa: (a - (-b)) ÷ c · d
        wrong_b = a - (b // c) * d  # (-b) ÷ c · d işaretini pozitif alma
        tag_b = NEGATIF
        solution = (f"Bölme ve çarpma, çıkarmadan önce ve soldan sağa yapılır: `(-{b}) ÷ {c} = {quotient}`, "
                    f"`({quotient}) · {d} = {quotient * d}`. Sonra `{a} - ({quotient * d}) = {a} + {-quotient * d} "
                    f"= {value}`.")
        params = {"bicim": bicim, "a": a, "b": b, "c": c, "d": d}
    else:
        # c - (-a)·(-b)
        a, b, c = rng.randint(2, 9), rng.randint(2, 9), rng.randint(-9, 9)
        d = 0
        expr = f"{c} - (-{a}) · (-{b})"
        canonical = f"{c} - (-{a})*(-{b})"
        value = c - a * b
        wrong_a = (c - (-a)) * (-b)
        wrong_b = c + a * b
        tag_b = NEGATIF
        solution = (f"Önce çarpma: `(-{a}) · (-{b}) = {a * b}` (iki negatifin çarpımı pozitiftir). "
                    f"Sonra çıkarma: `{c} - {a * b} = {value}`.")
        params = {"bicim": bicim, "a": a, "b": b, "c": c, "d": d}
    slip = value + rng.choice([-10, -2, 2, 10])
    stem = f"{code(expr)} işleminin sonucu kaçtır?"
    item, key = assemble(
        rng=rng,
        template_id=TEMPLATE_ID,
        skill_ids=[SKILL_ID],
        stem=stem,
        correct=_num(value),
        distractors=[
            Choice(code(str(wrong_a)), sympy.Integer(wrong_a), SOLDAN),
            Choice(code(str(wrong_b)), sympy.Integer(wrong_b), tag_b),
            _num(slip),
        ],
        canonical_expr=canonical,
        numeric_value=fmt_num(value),
        solution=solution,
        params=params,
    )
    return item, key, None


def generate(rng: random.Random):
    """``(QuestionItem, AnswerKey, None)`` — şekilsiz şablon."""
    return run_generator(_build, rng)
