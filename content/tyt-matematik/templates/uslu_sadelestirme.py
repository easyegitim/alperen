"""Şablon ``uslu-sadelestirme`` — aynı tabanlı üslü ifadelerde çarpım, bölüm ve kuvvet (temel.uslu; şekilsiz).

Taban ``{2, 3, 5, 10, a}``, üsler ``[-3, 6]``; her soruda en az bir negatif üs vardır. Biçimler (§10.4
"çarpım/bölüm/kuvvet"):

* ``carpim`` — ``b^m · b^n (· b^p)``; doğru üs ``m + n (+ p)``.
* ``bolum`` — ``b^m · b^n / b^k`` ya da ``b^m / b^k``; doğru üs ``m + n - k``.
* ``kuvvet`` — ``(b^m)^n · b^k``; doğru üs ``m · n + k`` (kuvvetin kuvvetinde üsler çarpılır).

Çeldiriciler: ``uslu.usleri-carpma`` (çarpımda üsleri çarpma; bölümde üsleri bölme ya da çarpma; kuvvet
biçiminde çarpımdaki üsleri de çarpma), ``uslu.negatif-us-isaret`` (negatif üssü sonucun işareti sanma:
üslerin mutlak değerleriyle işlem yapıp sonuca eksi koyma) ve bir etiketsiz hata (çarpım/bölümde üs
toplamında bir fazla/eksik; kuvvet biçiminde kuvvetin kuvvetinde üsleri toplama).
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
BICIMLER = ("carpim", "bolum", "kuvvet")
_US = {"type": "integer", "minimum": -3, "maximum": 6}
PARAMS_SCHEMA = {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "title": "uslu-sadelestirme parametreleri",
    "type": "object",
    "additionalProperties": False,
    "required": ["bicim", "taban", "usler"],
    "properties": {
        "bicim": {"enum": list(BICIMLER),
                  "description": "carpim: b^m · b^n (· b^p) | bolum: b^m (· b^n) / b^k | kuvvet: (b^m)^n · b^k"},
        "taban": {"enum": [2, 3, 5, 10, "a"]},
        "usler": {"type": "array", "minItems": 1, "maxItems": 3, "items": _US,
                  "description": "carpim: çarpanların üsleri; bolum: paydaki üsler; kuvvet: [m, n]"},
        "bolen_us": {**_US, "description": "bolum: paydadaki üs k"},
        "carpan_us": {**_US, "description": "kuvvet: sondaki çarpanın üssü k"},
    },
    "allOf": [
        {"if": {"properties": {"bicim": {"const": "carpim"}}},
         "then": {"properties": {"usler": {"minItems": 2}}, "not": {"anyOf": [{"required": ["bolen_us"]},
                                                                               {"required": ["carpan_us"]}]}}},
        {"if": {"properties": {"bicim": {"const": "bolum"}}},
         "then": {"required": ["bolen_us"], "properties": {"usler": {"maxItems": 2}},
                  "not": {"required": ["carpan_us"]}}},
        {"if": {"properties": {"bicim": {"const": "kuvvet"}}},
         "then": {"required": ["carpan_us"], "properties": {"usler": {"minItems": 2, "maxItems": 2}},
                  "not": {"required": ["bolen_us"]}}},
    ],
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


def _pw(base: int | str, exp: int) -> str:
    """Kökte bir üslü çarpan: ``2^5``, ``2^(-3)``."""
    return f"{base}^{exp}" if exp >= 0 else f"{base}^({exp})"


def _terms(exps: list[int], op: str = " + ") -> str:
    return op.join(f"({e})" if e < 0 else str(e) for e in exps)


def _carpim(rng: random.Random, base):
    exps = [rng.randint(2, 6), rng.randint(-3, -1)]
    if rng.random() < 0.4:
        exps.append(rng.randint(1, 3))
    rng.shuffle(exps)
    total = sum(exps)
    wrong_op = math.prod(exps)
    neg_sum = sum(abs(e) for e in exps)
    expr = " · ".join(_pw(base, e) for e in exps)
    canonical = " * ".join(power_expr(base, e) for e in exps)
    solution = f"Tabanlar aynı olduğundan üsler toplanır: `{_terms(exps)} = {total}`; sonuç `{power_text(base, total)}`."
    return {"bicim": "carpim", "taban": base, "usler": exps}, expr, canonical, total, wrong_op, neg_sum, \
        total + rng.choice([-1, 1]), solution


def _bolum(rng: random.Random, base):
    k = rng.choice([-3, -2, -1, 2, 3])
    exps = [rng.randint(2, 6)]
    if rng.random() < 0.5:
        exps.append(rng.choice([n for n in range(-3, 7) if n != 0]))
    if k > 0 and all(e > 0 for e in exps):
        raise TemplateRetry("en az bir negatif üs")
    total = sum(exps) - k
    if len(exps) == 2:
        wrong_op = exps[0] * exps[1] - k  # paydaki çarpımda üsleri çarpma
    elif exps[0] % k == 0:
        wrong_op = exps[0] // k  # bölümde üsleri bölme
    else:
        wrong_op = exps[0] * k  # bölümde üsleri çarpma
    neg_sum = sum(abs(e) for e in exps) - abs(k)
    num_text = " · ".join(_pw(base, e) for e in exps)
    expr = f"{num_text} / {_pw(base, k)}"
    canonical = f"({' * '.join(power_expr(base, e) for e in exps)}) / {power_expr(base, k)}"
    solution = (f"Aynı tabanlı çarpımda üsler toplanır, bölümde paydanın üssü çıkarılır: "
                f"`{_terms(exps)} - {paren_exp(k)} = {total}`; sonuç `{power_text(base, total)}`.")
    params = {"bicim": "bolum", "taban": base, "usler": exps, "bolen_us": k}
    return params, expr, canonical, total, wrong_op, neg_sum, total + rng.choice([-1, 1]), solution


def _kuvvet(rng: random.Random, base):
    m = rng.choice([n for n in range(-3, 7) if n not in (0, 1)])
    n = rng.choice([v for v in range(-3, 4) if v not in (0, 1)])
    k = rng.choice([v for v in range(-3, 7) if v != 0])
    if m > 0 and n > 0 and k > 0:
        raise TemplateRetry("en az bir negatif üs")
    total = m * n + k
    wrong_op = m * n * k  # çarpımdaki üsleri de çarpma
    neg_sum = abs(m) * abs(n) + abs(k)
    added = m + n + k  # kuvvetin kuvvetinde üsleri toplama (etiketsiz)
    expr = f"({_pw(base, m)})^{n if n > 0 else f'({n})'} · {_pw(base, k)}"
    canonical = f"({power_expr(base, m)})**({n}) * {power_expr(base, k)}"
    solution = (f"Kuvvetin kuvvetinde üsler çarpılır: `{paren_exp(m)} · {paren_exp(n)} = {m * n}`. "
                f"Sonra aynı tabanlı çarpımda üsler toplanır: `{m * n} + {paren_exp(k)} = {total}`; "
                f"sonuç `{power_text(base, total)}`.")
    params = {"bicim": "kuvvet", "taban": base, "usler": [m, n], "carpan_us": k}
    return params, expr, canonical, total, wrong_op, neg_sum, added, solution


def paren_exp(e: int) -> str:
    return f"({e})" if e < 0 else str(e)


_FORMS = {"carpim": _carpim, "bolum": _bolum, "kuvvet": _kuvvet}


def _build(rng: random.Random):
    base = rng.choice([2, 3, 5, 10, "a"])
    bicim = rng.choice(BICIMLER)
    params, expr, canonical, total, wrong_op, neg_sum, slip, solution = _FORMS[bicim](rng, base)
    if base != "a" and not (-3 <= total <= 6 and abs(wrong_op) <= 24 and abs(neg_sum) <= 24 and abs(slip) <= 24):
        raise TemplateRetry("değer aralığı")
    if total in (0, 1) or slip in (0, 1) or neg_sum == total:
        raise TemplateRetry("üs çok basit ya da şıklar sadeleşiyor")
    if base == "a":
        stem = f"`a ≠ 0` olmak üzere {code(expr)} ifadesi aşağıdakilerden hangisine eşittir?"
        numeric_value = None
    else:
        stem = f"{code(expr)} ifadesi aşağıdakilerden hangisine eşittir?"
        value = sympify_expr(power_expr(base, total))
        solution += f" Değeri `{fmt_num(value)}`."
        numeric_value = fmt_num(value)
    item, key = assemble(
        rng=rng,
        template_id=TEMPLATE_ID,
        skill_ids=[SKILL_ID],
        stem=stem,
        correct=_choice(base, total),
        distractors=[
            _choice(base, wrong_op, "uslu.usleri-carpma"),
            _choice(base, neg_sum, "uslu.negatif-us-isaret", negative=True),
            _choice(base, slip),
        ],
        canonical_expr=canonical,
        numeric_value=numeric_value,
        solution=solution,
        params=params,
    )
    return item, key, None


def generate(rng: random.Random):
    """``(QuestionItem, AnswerKey, None)`` — şekilsiz şablon."""
    return run_generator(_build, rng)
