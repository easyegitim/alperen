"""Şablon ``yuzde-grafik`` — çubuk grafikle yüzde ve kâr–zarar (problem.yuzde; şekilli).

Biçimler:

* ``ardisik`` — başlangıç fiyatına sırayla iki yüzde değişim (zam/indirim); sorulan son fiyat.
  Çeldiriciler: ``yuzde.ardisik-toplama`` (yüzdeleri toplama), ``genel.soruyu-yarim-okuma`` (ara fiyat),
  etiketsiz hesap hatası.
* ``kar`` — maliyet ve satış fiyatı çubukları; sorulan kâr ya da zarar yüzdesi. Çeldiriciler:
  ``yuzde.kar-satis-uzerinden`` (satış fiyatı üzerinden yüzde), ``genel.soruyu-yarim-okuma`` (TL farkı),
  etiketsiz oran hatası (satış/maliyet yüzdesi).
* ``kar-ardisik`` — maliyet, etiket fiyatı (önce yüzde zam) ve satış fiyatı (sonra yüzde indirim) çubukları;
  sorulan kâr ya da zarar yüzdesi. Çeldiriciler §10.4'teki iki etiketi birlikte taşır:
  ``yuzde.ardisik-toplama`` (zam ve indirim yüzdelerini toplama), ``yuzde.kar-satis-uzerinden`` (satış fiyatı
  üzerinden yüzde), etiketsiz hesap hatası.
"""

from __future__ import annotations

import random
import sys
from pathlib import Path

import sympy

try:
    from ._common import Choice, FigureSpec, TemplateRetry, assemble, code, draw_bar_chart, run_generator
except ImportError:  # dosya yolundan yüklendi (module_path)
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    from _common import Choice, FigureSpec, TemplateRetry, assemble, code, draw_bar_chart, run_generator

TEMPLATE_ID = "yuzde-grafik"
SKILL_ID = "tyt.mat.problem.yuzde"
ENGINE = "matplotlib"
HAS_FIGURE = True
TAGS = ("yuzde.ardisik-toplama", "yuzde.kar-satis-uzerinden", "genel.soruyu-yarim-okuma")
FIYATLAR = (100, 200, 300, 400, 500, 600, 800, 1000, 1200, 1500, 2000)
YUZDELER = (10, 20, 25, 30, 40, 50)
# (maliyet üzerinden yüzde, satış üzerinden yüzde, kâr mı)
KAR_ZARAR = ((25, 20, True), (100, 50, True), (150, 60, True), (20, 25, False), (50, 100, False), (60, 150, False))
# (zam, indirim): maliyet ve satış üzerinden yüzdeler tam sayı olan çiftler (sonuç kâr ya da zarar, sıfır değil)
ZAM_INDIRIM = ((150, 50), (150, 20), (300, 50), (60, 50), (100, 60), (25, 60), (100, 75))
PARAMS_SCHEMA = {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "title": "yuzde-grafik parametreleri",
    "type": "object",
    "additionalProperties": False,
    "required": ["bicim"],
    "properties": {
        "bicim": {"enum": ["ardisik", "kar", "kar-ardisik"]},
        "fiyat": {"type": "integer", "minimum": 1},
        "degisimler": {"type": "array", "minItems": 2, "maxItems": 2,
                       "items": {"type": "integer", "minimum": -50, "maximum": 50},
                       "description": "ardisik: + zam, - indirim (yüzde)"},
        "maliyet": {"type": "integer", "minimum": 1},
        "satis": {"type": "integer", "minimum": 1},
        "zam": {"type": "integer", "minimum": 1, "maximum": 300, "description": "kar-ardisik: etiket fiyatı zammı (%)"},
        "indirim": {"type": "integer", "minimum": 1, "maximum": 99,
                    "description": "kar-ardisik: etiket fiyatından indirim (%)"},
    },
}

ARDISIK = "yuzde.ardisik-toplama"
KAR_SATIS = "yuzde.kar-satis-uzerinden"
GENEL = "genel.soruyu-yarim-okuma"


def _word(p: int) -> str:
    return f"%{abs(p)} {'zam' if p > 0 else 'indirim'}"


def _factor(p: int) -> str:
    """Yüzde değişimin çarpanı Türkçe ondalıkla: +25 → ``1,25``, -10 → ``0,9``."""
    return f"{(100 + p) / 100:.2f}".rstrip("0").rstrip(".").replace(".", ",")


def _tl(v) -> Choice:
    v = sympy.Rational(v)
    return Choice(code(f"{v} TL"), v)


def _ardisik(rng: random.Random):
    price = rng.choice(FIYATLAR)
    changes = [rng.choice(YUZDELER) * rng.choice([1, -1]) for _ in range(2)]
    if changes[0] < 0 and changes[1] < 0 and rng.random() < 0.5:
        changes[1] = -changes[1]
    mid = sympy.Rational(price * (100 + changes[0]), 100)
    final = mid * sympy.Rational(100 + changes[1], 100)
    if not (mid.is_integer and final.is_integer):
        raise TemplateRetry("tam sayı fiyat")
    summed = sympy.Rational(price * (100 + changes[0] + changes[1]), 100)
    slip = final + rng.choice([-10, 10, -20, 20])
    stem = (f"Şekildeki grafikte fiyatı {price} TL olan bir ürüne önce {_word(changes[0])}, sonra "
            f"{_word(changes[1])} yapıldığı gösteriliyor. Ürünün son fiyatı kaç TL'dir?")
    f0, f1 = _factor(changes[0]), _factor(changes[1])
    solution = (f"Yüzdeler sırayla uygulanır, toplanmaz: `{price} · {f0} = {mid}`; `{mid} · {f1} = {final}`. "
                f"Son fiyat {final} TL.")
    fig_params = {"bars": [{"label": "Başlangıç", "value": price, "text": f"{price} TL"},
                           {"label": "1. adım", "value": int(mid), "text": _word(changes[0])},
                           {"label": "2. adım", "value": int(final), "text": _word(changes[1])}],
                  "ylabel": "Fiyat (TL)"}
    alt = (f"Üç çubuklu grafik. İlk çubuk başlangıç fiyatı {price} TL; ikinci çubuk {_word(changes[0])} sonrasını, "
           f"üçüncü çubuk ardından gelen {_word(changes[1])} sonrasını gösteriyor; son iki çubuğun değeri yazılmamış.")
    figure = FigureSpec(template_id=TEMPLATE_ID, params=fig_params, alt_text=alt, draw=draw_bar_chart)
    return dict(
        stem=stem, correct=_tl(final),
        distractors=[Choice(code(f"{summed} TL"), summed, ARDISIK), Choice(code(f"{mid} TL"), mid, GENEL), _tl(slip)],
        canonical_expr=f"{price}*Rational({100 + changes[0]},100)*Rational({100 + changes[1]},100)",
        numeric_value=str(final), solution=solution,
        params={"bicim": "ardisik", "fiyat": price, "degisimler": changes},
        stem_values={"fiyat": price, "yuzde_1": changes[0], "yuzde_2": changes[1]}, figure=figure,
    )


def _kar(rng: random.Random):
    on_cost, on_sale, profit = rng.choice(KAR_ZARAR)
    cost = rng.choice(range(40, 401, 20))
    sale = sympy.Rational(cost * (100 + on_cost if profit else 100 - on_cost), 100)
    if not sale.is_integer:
        raise TemplateRetry("tam sayı satış")
    sale = int(sale)
    word = "kâr" if profit else "zarar"
    diff = abs(sale - cost)
    ratio = sympy.Rational(sale * 100, cost)
    stem = (f"Şekildeki grafikte bir ürünün maliyeti {cost} TL, satış fiyatı {sale} TL olarak gösterilmiştir. "
            f"Bu satışta {word} yüzdesi kaçtır?")
    solution = (f"{word.capitalize()} yüzdesi maliyet üzerinden hesaplanır: {word} `{diff}` TL, "
                f"`{diff}/{cost} · 100 = {on_cost}`. Cevap `%{on_cost}`.")
    fig_params = {"bars": [{"label": "Maliyet", "value": cost, "text": f"{cost} TL"},
                           {"label": "Satış fiyatı", "value": sale, "text": f"{sale} TL"}],
                  "ylabel": "Tutar (TL)"}
    alt = f"İki çubuklu grafik: maliyet {cost} TL, satış fiyatı {sale} TL."
    figure = FigureSpec(template_id=TEMPLATE_ID, params=fig_params, alt_text=alt, draw=draw_bar_chart)
    return dict(
        stem=stem, correct=Choice(code(f"%{on_cost}"), sympy.Integer(on_cost)),
        distractors=[Choice(code(f"%{on_sale}"), sympy.Integer(on_sale), KAR_SATIS),
                     Choice(code(f"{diff} TL"), sympy.Integer(diff), GENEL),
                     Choice(code(f"%{ratio}"), ratio)],
        canonical_expr=f"Abs({sale} - {cost})*100/{cost}",
        numeric_value=str(on_cost), solution=solution,
        params={"bicim": "kar", "maliyet": cost, "satis": sale},
        stem_values={"maliyet": cost, "satis": sale}, figure=figure,
    )


def _kar_ardisik(rng: random.Random):
    zam, indirim = rng.choice(ZAM_INDIRIM)
    cost = rng.choice(range(40, 401, 20))
    tag_price = sympy.Rational(cost * (100 + zam), 100)
    sale = tag_price * sympy.Rational(100 - indirim, 100)
    if not (tag_price.is_integer and sale.is_integer):
        raise TemplateRetry("tam sayı fiyat")
    tag_price, sale = int(tag_price), int(sale)
    profit = sale > cost
    word = "kâr" if profit else "zarar"
    diff = abs(sale - cost)
    on_cost = sympy.Rational(diff * 100, cost)
    on_sale = sympy.Rational(diff * 100, sale)
    summed = abs(zam - indirim)
    if not (on_cost.is_integer and on_sale.is_integer):
        raise TemplateRetry("tam sayı yüzde")
    slip = on_cost + rng.choice([-10, -5, 5, 10])
    if slip <= 0:
        raise TemplateRetry("pozitif yüzde")
    stem = (f"Şekildeki grafikte maliyeti {cost} TL olan bir ürünün etiket fiyatı maliyetin %{zam} fazlası olarak "
            f"belirleniyor, ürün etiket fiyatı üzerinden %{indirim} indirimle satılıyor. Bu satışta {word} yüzdesi "
            "kaçtır?")
    solution = (f"Yüzdeler sırayla uygulanır: etiket fiyatı `{cost} · {_factor(zam)} = {tag_price}` TL, satış fiyatı "
                f"`{tag_price} · {_factor(-indirim)} = {sale}` TL. {word.capitalize()} `{diff}` TL; yüzde maliyet "
                f"üzerinden hesaplanır: `{diff}/{cost} · 100 = {on_cost}`. Cevap `%{on_cost}`.")
    fig_params = {"bars": [{"label": "Maliyet", "value": cost, "text": f"{cost} TL"},
                           {"label": "Etiket fiyatı", "value": tag_price, "text": f"%{zam} zam"},
                           {"label": "Satış fiyatı", "value": sale, "text": f"%{indirim} indirim"}],
                  "ylabel": "Tutar (TL)"}
    alt = (f"Üç çubuklu grafik. İlk çubuk maliyet {cost} TL; ikinci çubuk %{zam} zamlı etiket fiyatını, üçüncü "
           f"çubuk etiket fiyatından %{indirim} indirimli satış fiyatını gösteriyor; son iki çubuğun değeri yazılmamış.")
    figure = FigureSpec(template_id=TEMPLATE_ID, params=fig_params, alt_text=alt, draw=draw_bar_chart)
    return dict(
        stem=stem, correct=Choice(code(f"%{on_cost}"), on_cost),
        distractors=[Choice(code(f"%{summed}"), sympy.Integer(summed), ARDISIK),
                     Choice(code(f"%{on_sale}"), on_sale, KAR_SATIS),
                     Choice(code(f"%{slip}"), slip)],
        canonical_expr=f"Abs({cost}*Rational({100 + zam},100)*Rational({100 - indirim},100) - {cost})*100/{cost}",
        numeric_value=str(on_cost), solution=solution,
        params={"bicim": "kar-ardisik", "maliyet": cost, "satis": sale, "zam": zam, "indirim": indirim},
        stem_values={"maliyet": cost, "zam": zam, "indirim": indirim}, figure=figure,
    )


def _build(rng: random.Random):
    roll = rng.random()
    parts = _ardisik(rng) if roll < 0.4 else _kar_ardisik(rng) if roll < 0.75 else _kar(rng)
    item, key = assemble(rng=rng, template_id=TEMPLATE_ID, skill_ids=[SKILL_ID], **parts)
    return item, key, parts["figure"]


def generate(rng: random.Random):
    """``(QuestionItem, AnswerKey, FigureSpec)``."""
    return run_generator(_build, rng)
