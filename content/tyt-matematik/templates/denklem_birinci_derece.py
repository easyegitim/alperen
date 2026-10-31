"""Şablon ``denklem-birinci-derece`` — birinci dereceden tek bilinmeyenli denklem (cebir.denklem; şekilsiz).

Biçimler: ``ax + b = cx + d`` (sorulan ``x + k``), ``x/q + p = r`` ve ``(x + p)/q = x - r``; çözüm tam sayıdır.
Çeldiriciler: ``denklem.taraf-degistirme-isaret``, ``denklem.paydayla-carpma-eksik`` (paydalı biçimler) ya da
``genel.soruyu-yarim-okuma`` (ara sonuç ``x``) ve bir etiketsiz hesap hatası.
"""

from __future__ import annotations

import random
import sys
from pathlib import Path

import sympy

try:
    from ._common import Choice, TemplateRetry, assemble, code, fmt_num, run_generator, signed
except ImportError:  # dosya yolundan yüklendi (module_path)
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    from _common import Choice, TemplateRetry, assemble, code, fmt_num, run_generator, signed

TEMPLATE_ID = "denklem-birinci-derece"
SKILL_ID = "tyt.mat.cebir.denklem"
ENGINE = "sympy"
HAS_FIGURE = False
TAGS = ("denklem.taraf-degistirme-isaret", "denklem.paydayla-carpma-eksik", "genel.soruyu-yarim-okuma")
PARAMS_SCHEMA = {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "title": "denklem-birinci-derece parametreleri",
    "type": "object",
    "additionalProperties": False,
    "required": ["bicim", "katsayilar", "cozum"],
    "properties": {
        "bicim": {"enum": ["iki-taraf", "paydali-sabit", "paydali-ifade"],
                  "description": "ax + b = cx + d | x/q + p = r | (x + p)/q = x - r"},
        "katsayilar": {"type": "object", "additionalProperties": {"type": "integer"}},
        "cozum": {"type": "integer", "minimum": -40, "maximum": 40},
    },
}

TARAF = "denklem.taraf-degistirme-isaret"
PAYDA = "denklem.paydayla-carpma-eksik"
GENEL = "genel.soruyu-yarim-okuma"


def _q(v) -> Choice:
    r = sympy.Rational(v)
    return Choice(code(fmt_num(r)), r)


def _tagged(v, tag) -> Choice:
    c = _q(v)
    c.tag = tag
    return c


def _lin(coef: int, const: int | None = None) -> str:
    """``3x``, ``-x``, ``x``; isteğe bağlı sabitle ``3x - 5``."""
    if coef == 1:
        s = "x"
    elif coef == -1:
        s = "-x"
    else:
        s = f"{coef}x"
    return s if const is None or const == 0 else f"{s} {signed(const)}"


def _nonzero(rng: random.Random, lo: int, hi: int) -> int:
    return rng.choice([n for n in range(lo, hi + 1) if n != 0])


def _build(rng: random.Random):
    bicim = rng.choice(["iki-taraf", "paydali-sabit", "paydali-ifade"])
    R = sympy.Rational
    if bicim == "iki-taraf":
        x0 = rng.randint(-9, 9)
        a, c = _nonzero(rng, -6, 9), _nonzero(rng, -6, 9)
        b, k = _nonzero(rng, -9, 9), rng.randint(1, 5)
        if a == c:
            raise TemplateRetry("a ≠ c")
        d = (a - c) * x0 + b
        if d == 0:
            raise TemplateRetry("d sıfır olmasın")
        stem = f"{code(_lin(a, b) + ' = ' + _lin(c, d))} olduğuna göre {code(f'x + {k}')} kaçtır?"
        canonical = f"({d} - ({b}))/({a} - ({c})) + {k}"
        value = R(x0 + k)
        wrong_taraf = R(d + b, a - c) + k   # sabiti işaret değiştirmeden geçirir
        distractors = [_tagged(wrong_taraf, TARAF), _tagged(x0, GENEL), _q(x0 - k)]
        solution = (f"x'li terimleri bir tarafa, sabitleri diğer tarafa topla (geçen terimin işareti değişir): "
                    f"`{_lin(a - c)} = {d} {signed(-b)}`, yani `x = {x0}`. Sorulan `x + {k} = {x0 + k}`.")
        coefs = {"a": a, "b": b, "c": c, "d": d, "k": k}
    elif bicim == "paydali-sabit":
        q, t = rng.randint(2, 6), _nonzero(rng, -6, 6)
        p = _nonzero(rng, -9, 9)
        x0, r = q * t, t + p
        stem = f"{code(f'x/{q} {signed(p)} = {r}')} denkleminin çözümü kaçtır?"
        canonical = f"{q}*({r} - ({p}))"
        value = R(x0)
        wrong_payda = R(q * r - p)          # yalnız x/q ve sağ tarafı çarpar, p'yi çarpmaz
        wrong_taraf = R(q * (r + p))        # p'yi işaret değiştirmeden geçirir
        distractors = [_tagged(wrong_payda, PAYDA), _tagged(wrong_taraf, TARAF), _q(r - p)]
        solution = (f"Sabiti karşıya geçir: `x/{q} = {r} {signed(-p)} = {t}`. İki tarafı {q} ile çarp: `x = {x0}`.")
        coefs = {"q": q, "p": p, "r": r}
    else:
        q, x0, r = rng.randint(2, 5), rng.randint(-9, 9), _nonzero(rng, -9, 9)
        p = x0 * (q - 1) - q * r
        if p == 0 or abs(p) > 40:
            raise TemplateRetry("p aralığı")
        stem = f"{code(f'(x {signed(p)})/{q} = x {signed(-r)}')} denkleminin çözümü kaçtır?"
        canonical = f"(({p}) + {q}*({r}))/({q} - 1)"
        value = R(x0)
        wrong_payda = R(p + r, q - 1)       # sağdaki sabiti q ile çarpmaz
        wrong_taraf = R(q * r - p, q - 1)   # p'yi işaret değiştirmeden geçirir
        distractors = [_tagged(wrong_payda, PAYDA), _tagged(wrong_taraf, TARAF), _q(-x0 if x0 else 2)]
        solution = (f"Her terimi {q} ile çarp: `x {signed(p)} = {q}x {signed(-q * r)}`. "
                    f"x'leri bir tarafa topla: `{p + q * r} = {q - 1}x`, yani `x = {x0}`.")
        coefs = {"q": q, "p": p, "r": r}
    item, key = assemble(
        rng=rng,
        template_id=TEMPLATE_ID,
        skill_ids=[SKILL_ID],
        stem=stem,
        correct=_q(value),
        distractors=distractors,
        canonical_expr=canonical,
        numeric_value=fmt_num(value),
        solution=solution,
        params={"bicim": bicim, "katsayilar": coefs, "cozum": int(x0)},
    )
    return item, key, None


def generate(rng: random.Random):
    """``(QuestionItem, AnswerKey, None)`` — şekilsiz şablon."""
    return run_generator(_build, rng)
