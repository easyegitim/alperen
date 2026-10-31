"""Şablon ``uslu-sadelestirme`` — aynı tabanlı üslü ifadelerin çarpımı (temel.uslu; şekilsiz).

Taban ``{2, 3, 5, 10, a}``, üsler ``[-3, 6]``; çarpımda en az bir negatif üs vardır.
Çeldiriciler: ``uslu.usleri-carpma`` (üsleri çarpma), ``uslu.negatif-us-isaret`` (negatif üssü sonucun
işareti sanma) ve bir etiketsiz hesap hatası (üs toplamında bir fazla/eksik).
"""

from __future__ import annotations

import math
import random
import sys
from pathlib import Path

try:
    from ._common import Choice, TemplateRetry, assemble, code, fmt_num, run_generator, sympify_expr
except ImportError:  # dosya yolundan yüklendi (module_path)
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    from _common import Choice, TemplateRetry, assemble, code, fmt_num, run_generator, sympify_expr

TEMPLATE_ID = "uslu-sadelestirme"
SKILL_ID = "tyt.mat.temel.uslu"
ENGINE = "sympy"
HAS_FIGURE = False
TAGS = ("uslu.usleri-carpma", "uslu.negatif-us-isaret")
PARAMS_SCHEMA = {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "title": "uslu-sadelestirme parametreleri",
    "type": "object",
    "additionalProperties": False,
    "required": ["taban", "usler"],
    "properties": {
        "taban": {"enum": [2, 3, 5, 10, "a"]},
        "usler": {"type": "array", "minItems": 2, "maxItems": 3,
                  "items": {"type": "integer", "minimum": -3, "maximum": 6}},
    },
}


def power_text(base: int | str, exp: int, negative: bool = False) -> str:
    """Telegram biçimi: ``2^5``, ``2^(-3)``, ``-2^8``; üs 1 → taban, üs 0 → 1."""
    if exp == 0:
        body = "1"
    elif exp == 1:
        body = str(base)
    elif exp < 0:
        body = f"{base}^({exp})"
    else:
        body = f"{base}^{exp}"
    return f"-{body}" if negative else body


def power_expr(base: int | str, exp: int, negative: bool = False) -> str:
    body = f"{base}**({exp})"
    return f"-({body})" if negative else body


def _choice(base, exp, tag=None, negative=False) -> Choice:
    return Choice(code(power_text(base, exp, negative)), sympify_expr(power_expr(base, exp, negative)), tag)


def _build(rng: random.Random):
    base = rng.choice([2, 3, 5, 10, "a"])
    exps = [rng.randint(2, 6), rng.randint(-3, -1)]
    if rng.random() < 0.4:
        exps.append(rng.randint(1, 3))
    rng.shuffle(exps)
    total = sum(exps)
    prod = math.prod(exps)
    neg_sum = sum(abs(e) for e in exps)
    if base != "a" and not (-3 <= total <= 6 and abs(prod) <= 24):
        raise TemplateRetry("değer aralığı")
    if total in (0, 1) or neg_sum == total:
        raise TemplateRetry("üs toplamı çok basit")
    factors =" · ".join((f"{base}^{e}" if e > 0 else f"{base}^({e})") for e in exps)
    canonical = " * ".join(power_expr(base, e) for e in exps)
    if base == "a":
        stem = f"`a ≠ 0` olmak üzere {code(factors)} ifadesi aşağıdakilerden hangisine eşittir?"
    else:
        stem = f"{code(factors)} ifadesi aşağıdakilerden hangisine eşittir?"
    slip = total + rng.choice([-1, 1])
    if slip in (0, 1):
        raise TemplateRetry("hesap hatası şıkkı sadeleşiyor")
    terms = " + ".join(f"({e})" if e < 0 else str(e) for e in exps)
    solution = (f"Tabanlar aynı olduğundan üsler toplanır: `{terms} = {total}`; "
                f"sonuç `{power_text(base, total)}`.")
    if base != "a":
        value = sympify_expr(power_expr(base, total))
        solution += f" Değeri `{fmt_num(value)}`."
        numeric_value = fmt_num(value)
    else:
        numeric_value = None
    item, key = assemble(
        rng=rng,
        template_id=TEMPLATE_ID,
        skill_ids=[SKILL_ID],
        stem=stem,
        correct=_choice(base, total),
        distractors=[
            _choice(base, prod, "uslu.usleri-carpma"),
            _choice(base, neg_sum, "uslu.negatif-us-isaret", negative=True),
            _choice(base, slip),
        ],
        canonical_expr=canonical,
        numeric_value=numeric_value,
        solution=solution,
        params={"taban": base, "usler": exps},
    )
    return item, key, None


def generate(rng: random.Random):
    """``(QuestionItem, AnswerKey, None)`` — şekilsiz şablon."""
    return run_generator(_build, rng)
