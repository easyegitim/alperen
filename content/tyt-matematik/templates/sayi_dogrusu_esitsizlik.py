"""Şablon ``sayi-dogrusu-esitsizlik`` — sayı doğrusunda eşitsizlik ve mutlak değer (cebir.esitsizlik /
cebir.mutlak-deger; şekilli).

Biçimler:

* ``dogrusal`` — şekil ``x < t`` ya da ``x > t`` ışınını (boş daire) gösterir; şıklar dört eşitsizliktir,
  doğru şık şekildeki kümeyi verir (SymPy ``solveset`` ile karşılaştırılır). Çeldiriciler §10.4'teki iki
  etiketi birlikte taşır: ``esitsizlik.negatifle-carpma-yon`` (yönü çevirmeyen öğrencinin seçeceği
  eşitsizlik), ``mutlak.tek-durum`` (``|x - a| > b``: yalnız bir durumu çözen öğrenci bunun çözümünü
  şekildeki ışın sanar; gerçek çözüm iki ışındır), etiketsiz sınır hatası (``≥``/``≤``).
* ``mutlak`` — şekil ``|x - a| < b`` (ya da ``≤``) çözüm aralığını ve ``A = a`` noktasını gösterir; soru
  tam sayıların toplamıdır. Çeldiriciler: ``mutlak.tek-durum`` (yalnız ``x ≥ a`` durumu),
  ``genel.soruyu-yarim-okuma`` (toplam yerine tam sayı sayısı), etiketsiz uç nokta hatası.
"""

from __future__ import annotations

import random
import sys
from pathlib import Path

import sympy

try:
    from ._common import Choice, FigureSpec, TemplateRetry, assemble, code, draw_number_line, parse_math, run_generator
except ImportError:  # dosya yolundan yüklendi (module_path)
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    from _common import Choice, FigureSpec, TemplateRetry, assemble, code, draw_number_line, parse_math, run_generator

TEMPLATE_ID = "sayi-dogrusu-esitsizlik"
SKILL_ID = "tyt.mat.cebir.esitsizlik"
ENGINE = "matplotlib"
HAS_FIGURE = True
TAGS = ("esitsizlik.negatifle-carpma-yon", "mutlak.tek-durum", "genel.soruyu-yarim-okuma")
PARAMS_SCHEMA = {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "title": "sayi-dogrusu-esitsizlik parametreleri",
    "type": "object",
    "additionalProperties": False,
    "required": ["bicim"],
    "properties": {
        "bicim": {"enum": ["dogrusal", "mutlak"]},
        "t": {"type": "integer", "minimum": -9, "maximum": 9, "description": "dogrusal: ışının başlangıcı"},
        "yon": {"enum": ["sol", "sag"], "description": "dogrusal: taralı taraf"},
        "k": {"type": "integer", "minimum": 2, "maximum": 5},
        "m": {"type": "integer", "minimum": -9, "maximum": 9},
        "r": {"type": "integer", "minimum": 1, "maximum": 4,
              "description": "dogrusal: tek durum çeldiricisi |x - a| > r için yarıçap"},
        "a": {"type": "integer", "minimum": -9, "maximum": 9, "description": "mutlak: merkez"},
        "b": {"type": "integer", "minimum": 1, "maximum": 5, "description": "mutlak: yarıçap"},
        "kapali": {"type": "boolean", "description": "mutlak: ≤ (uçlar dahil)"},
    },
}

NEGATIF = "esitsizlik.negatifle-carpma-yon"
TEK = "mutlak.tek-durum"
GENEL = "genel.soruyu-yarim-okuma"


def _ineq(const: int, k: int, rel: str, rhs: int) -> str:
    left = f"{const} - {k}x" if const != 0 else f"-{k}x"
    return f"{left} {rel} {rhs}"


def _rel_choice(text: str, tag: str | None = None) -> Choice:
    return Choice(code(text), parse_math(text), tag)


def _abs_text(a: int) -> str:
    if a == 0:
        return "|x|"
    return f"|x - {a}|" if a >= 0 else f"|x + {-a}|"


def _dogrusal(rng: random.Random):
    t, k = rng.randint(-6, 6), rng.randint(2, 5)
    m = rng.choice([n for n in range(-9, 10) if n != 0])
    r = rng.randint(1, 4)
    yon = rng.choice(["sol", "sag"])
    n = m - k * t
    rel, rev, weak = (">", "<", ">=") if yon == "sol" else ("<", ">", "<=")
    # tek durum: |x - a| > r'nin yalnız x - a > r (sağ) ya da x - a < -r (sol) durumu şekildeki ışını verir
    a = t - r if yon == "sag" else t + r
    correct = _rel_choice(_ineq(m, k, rel, n))
    distractors = [
        _rel_choice(_ineq(m, k, rev, n), NEGATIF),
        _rel_choice(f"{_abs_text(a)} > {r}", TEK),
        _rel_choice(_ineq(m, k, weak, n)),
    ]
    side = "sol" if yon == "sol" else "sağ"
    stem = (f"Şekildeki sayı doğrusunda {t} noktasında boş bir daire var ve bu noktanın {side} tarafı taralı. "
            "Taralı küme aşağıdaki eşitsizliklerden hangisinin çözüm kümesidir?")
    canonical = f"Interval.open(-oo, {t})" if yon == "sol" else f"Interval.open({t}, oo)"
    wanted = f"x < {t}" if yon == "sol" else f"x > {t}"
    solution = (f"Şekildeki küme `{wanted}`. `{_ineq(m, k, rel, n)}` için sabiti karşıya geçir: "
                f"`-{k}x {rel} {n - m}`; negatif sayıya bölünce yön değişir: `{wanted}`.")
    fig_params = {"lo": t - 5, "hi": t + 5, "left": None if yon == "sol" else t, "right": t if yon == "sol" else None,
                  "left_closed": False, "right_closed": False, "marks": []}
    alt = (f"Sayı doğrusu {t - 5} ile {t + 5} arasında; {t} noktasında boş daire, "
           f"{'solundaki' if yon == 'sol' else 'sağındaki'} bölge ok yönünde taralı.")
    params = {"bicim": "dogrusal", "t": t, "yon": yon, "k": k, "m": m, "r": r}
    figure = FigureSpec(template_id=TEMPLATE_ID, params=fig_params, alt_text=alt, draw=draw_number_line)
    return dict(skill_ids=[SKILL_ID], stem=stem, correct=correct, distractors=distractors, canonical_expr=canonical,
                numeric_value=None, solution=solution, params=params, stem_values={"t": t}, figure=figure)


def _mutlak(rng: random.Random):
    a = rng.choice([n for n in range(-6, 7) if n != 0])
    b = rng.randint(1, 5)
    kapali = rng.random() < 0.4
    lo, hi = (a - b, a + b) if kapali else (a - b + 1, a + b - 1)
    if hi < lo:
        raise TemplateRetry("boş küme")
    total = sum(range(lo, hi + 1))
    count = hi - lo + 1
    one_side = sum(range(a, hi + 1))
    other = sum(range(a - b + 1, a + b)) if kapali else sum(range(a - b, a + b + 1))
    rel = "≤" if kapali else "<"
    expr = f"{_abs_text(a)} {rel} {b}"
    stem = (f"Şekildeki sayı doğrusunda A noktası {a} sayısını gösteriyor ve {code(expr)} eşitsizliğinin çözüm "
            f"kümesi taralı. Uçlarda {'dolu' if kapali else 'boş'} daire var. "
            "Bu eşitsizliği sağlayan tam sayıların toplamı kaçtır?")
    sign = "≤" if kapali else "<"
    solution = (f"İki durum: `-{b} {sign} x - {a} {sign} {b}` ise `{a - b} {sign} x {sign} {a + b}`. "
                f"Tam sayılar {lo} ile {hi} arası ({count} tane); toplamları `{total}`.").replace("- -", "+ ")
    canonical = f"({a})*({count})"
    fig_params = {"lo": a - b - 2, "hi": a + b + 2, "left": a - b, "right": a + b, "left_closed": kapali,
                  "right_closed": kapali, "marks": [{"x": a, "label": "A"}]}
    alt = (f"Sayı doğrusu {a - b - 2} ile {a + b + 2} arasında; A noktası {a}. {a - b} ve {a + b} noktalarında "
           f"{'dolu' if kapali else 'boş'} daire, aralarındaki bölge taralı.")
    params = {"bicim": "mutlak", "a": a, "b": b, "kapali": kapali}
    figure = FigureSpec(template_id=TEMPLATE_ID, params=fig_params, alt_text=alt, draw=draw_number_line)
    return dict(
        skill_ids=["tyt.mat.cebir.mutlak-deger", SKILL_ID], stem=stem,
        correct=Choice(code(str(total)), sympy.Integer(total)),
        distractors=[Choice(code(str(one_side)), sympy.Integer(one_side), TEK),
                     Choice(code(str(count)), sympy.Integer(count), GENEL),
                     Choice(code(str(other)), sympy.Integer(other))],
        canonical_expr=canonical, numeric_value=str(total), solution=solution, params=params,
        stem_values={"a": a, "b": b}, figure=figure,
    )


def _build(rng: random.Random):
    parts = _dogrusal(rng) if rng.random() < 0.5 else _mutlak(rng)
    item, key = assemble(rng=rng, template_id=TEMPLATE_ID, **parts)
    return item, key, parts["figure"]


def generate(rng: random.Random):
    """``(QuestionItem, AnswerKey, FigureSpec)``."""
    return run_generator(_build, rng)
