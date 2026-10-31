"""6 şablon × 50 varyant (BLUEPRINT §10.4, §11 M03): şemaya uygun, SymPy doğrular, şekilliler PNG üretir
(200–1600 px), en az iki etiketsiz şık; ayrıca her şablonun matematiği bağımsız olarak yeniden hesaplanır."""

from __future__ import annotations

import ast
import json
import math
import operator
import random
import re
import subprocess
import sys
from fractions import Fraction

import jsonschema
import pytest
import sympy
from conftest import CONTENT_DIR, REPO_ROOT
from ogrenmen_contracts import errors

import templates
from templates import _common as C

SEEDS = range(50)
TEMPLATE_IDS = list(templates.TEMPLATE_FILES)
CATALOG = {t["tag"] for t in json.loads((CONTENT_DIR / "misconception-tags.json").read_text(encoding="utf-8"))}
SKILLS = {s["id"] for s in json.loads((CONTENT_DIR / "skills.json").read_text(encoding="utf-8"))}


def variants(tid):
    mod = templates.load(tid)
    return [(seed, *mod.generate(random.Random(seed))) for seed in SEEDS]


FIGURE_TEMPLATE_IDS = [t for t in TEMPLATE_IDS if templates.load(t).HAS_FIGURE]


@pytest.fixture(scope="module", params=TEMPLATE_IDS)
def generated(request):
    return request.param, templates.load(request.param), variants(request.param)


@pytest.fixture(scope="module", params=FIGURE_TEMPLATE_IDS)
def generated_with_figure(request):
    return request.param, templates.load(request.param), variants(request.param)


def option_value(item, key):
    return C.parse_math(next(o["text"] for o in item["options"] if o["key"] == key))


def tagged_value(item, tag):
    return C.parse_math(next(o["text"] for o in item["options"] if o["misconception_tag"] == tag))


def test_six_templates_three_with_figures():
    mods = templates.all_templates()
    assert len(mods) == 6
    assert sorted(m.TEMPLATE_ID for m in mods if m.HAS_FIGURE) == [
        "kesir-modeli-toplama", "sayi-dogrusu-esitsizlik", "yuzde-grafik"]


def test_fifty_variants_contract_and_rules(generated):
    tid, mod, rows = generated
    validator = jsonschema.Draft202012Validator(mod.PARAMS_SCHEMA)
    for seed, item, key, fig in rows:
        assert errors("question-item", item) == [], (tid, seed)
        assert errors("answer-key", key) == [], (tid, seed)
        assert errors("template-params", {"id": tid, "seed": seed, "params": item["template"]["params"]}) == []
        assert list(validator.iter_errors(item["template"]["params"])) == [], (tid, seed)
        assert item["source"] == "template" and item["template"]["id"] == tid
        assert item["curriculum_code"] == "TYT-MAT@2026.1"
        assert key["sympy_status"] == "verified"
        assert set(item["skill_ids"]) <= SKILLS
        assert mod.SKILL_ID in item["skill_ids"]
        tags = [o["misconception_tag"] for o in item["options"]]
        assert sum(t is None for t in tags) >= 2
        correct = next(o for o in item["options"] if o["key"] == key["correct_option"])
        assert correct["misconception_tag"] is None
        distractor_tags = [o["misconception_tag"] for o in item["options"] if o is not correct]
        assert sum(t is not None for t in distractor_tags) == 2
        assert all(t in CATALOG and t in mod.TAGS for t in distractor_tags if t)
        assert "correct" not in json.dumps(item)
        texts = [item["stem"], key["solution"], *(o["text"] for o in item["options"])]
        assert not any("!" in t for t in texts), (tid, seed)
        assert (fig is not None) == mod.HAS_FIGURE
        assert (item["figure"] is not None) == mod.HAS_FIGURE


def test_sympy_key_matches_exactly_one_option(generated):
    """SymPy yolu: anahtarın ``canonical_expr``'i yalnız doğru şıkla eşleşir (assemble ile aynı araçlar)."""
    tid, _mod, rows = generated
    for seed, item, key, _fig in rows:
        value = sympy.sympify(key["canonical_expr"], locals=dict(C._LOCALS), rational=True)
        matched = [o["key"] for o in item["options"] if C.values_equal(C.parse_math(o["text"]), value)]
        assert matched == [key["correct_option"]], (tid, seed, key["canonical_expr"], item["options"])
        assert key["sympy_report"]["matched_option"] == key["correct_option"]


def test_variety_and_determinism(generated):
    tid, mod, rows = generated
    hashes = {C.content_hash(item["stem"], item["options"]) for _s, item, _k, _f in rows}
    assert len(hashes) >= 30, f"{tid}: 50 varyantta yalnız {len(hashes)} farklı soru"
    again = mod.generate(random.Random(7))
    first = next(r for r in rows if r[0] == 7)
    assert again[0] == first[1] and again[1] == first[2]
    keys = {k["correct_option"] for _s, _i, k, _f in rows}
    assert keys == {"A", "B", "C", "D"}, f"{tid}: doğru şık konumu karışmıyor"


def test_figures_render_png_within_bounds(generated_with_figure, tmp_path):
    tid, _mod, rows = generated_with_figure
    for seed, item, _key, fig in rows:
        info = fig.render(tmp_path / f"{tid}-{seed}.png")
        assert 200 <= info["width_px"] <= 1600 and 200 <= info["height_px"] <= 1600, (tid, seed, info)
        px = item["figure"]["expected_px"]
        assert px == {"min_w": 200, "max_w": 1600, "min_h": 200, "max_h": 1600}
        assert px["min_w"] <= info["width_px"] <= px["max_w"] and px["min_h"] <= info["height_px"] <= px["max_h"]
        assert 3_000 <= info["bytes"] <= 2_000_000
        assert item["figure"]["code"] == fig.code and item["figure"]["alt_text"] == fig.alt_text
        assert item["figure"]["tool"] == "template"
        payload = fig.rpc_payload(info, png_path=f"figures/{seed}.png")
        assert payload["code_hash"] == C.sha256_hex(fig.code) and payload["png_path"] == f"figures/{seed}.png"
    # aynı parametre aynı PNG'yi verir
    _s, _i, _k, fig = rows[0]
    a, b = fig.render(tmp_path / "a.png"), fig.render(tmp_path / "b.png")
    assert (tmp_path / "a.png").read_bytes() == (tmp_path / "b.png").read_bytes()
    assert a["bytes"] == b["bytes"]


def test_png_not_blank(tmp_path):
    import matplotlib.image as mpimg

    for tid in ("kesir-modeli-toplama", "sayi-dogrusu-esitsizlik", "yuzde-grafik"):
        _item, _key, fig = templates.load(tid).generate(random.Random(1))
        fig.render(tmp_path / "x.png")
        pixels = mpimg.imread(tmp_path / "x.png")
        assert pixels.std() > 0.05, f"{tid}: boş görüntü"


# --- SymPy'siz bağımsız çapraz denetim ----------------------------------------------------------
# Şık metinleri burada _common'un ayrıştırıcısı (normalize_math/parse_math/values_equal) kullanılmadan, elle
# yazılmış küçük bir ayrıştırıcı ve Fraction ile okunur; beklenen cevap şablon parametrelerinden hesaplanır.

_BINOPS = {ast.Add: operator.add, ast.Sub: operator.sub, ast.Mult: operator.mul, ast.Div: operator.truediv}


def frac_eval(text: str) -> Fraction:
    """Tam sayı aritmetiği (``+ - · ÷ / ^``, parantez) → Fraction; yalnız sayı sabitleri kabul edilir."""
    s = text.strip().strip("`").replace("·", "*").replace("÷", "/").replace("−", "-").replace("^", "**")

    def ev(node):
        if isinstance(node, ast.Expression):
            return ev(node.body)
        if isinstance(node, ast.Constant) and type(node.value) is int:
            return Fraction(node.value)
        if isinstance(node, ast.UnaryOp) and isinstance(node.op, ast.USub):
            return -ev(node.operand)
        if isinstance(node, ast.BinOp) and isinstance(node.op, ast.Pow):
            exp = ev(node.right)
            assert exp.denominator == 1
            return ev(node.left) ** int(exp)
        if isinstance(node, ast.BinOp) and type(node.op) in _BINOPS:
            return _BINOPS[type(node.op)](ev(node.left), ev(node.right))
        raise ValueError(f"beklenmeyen düğüm: {ast.dump(node)}")

    return ev(ast.parse(s, mode="eval"))


_LINEAR = re.compile(r"^(-?\d+) - (\d+)x (<=|>=|<|>) (-?\d+)$")
_ABS_GT = re.compile(r"^\|x(?: ([+-]) (\d+))?\| > (\d+)$")
_A_POWER = re.compile(r"^(-?)a(?:\^\(?(-?\d+)\)?)?$")
_FLIP = {"<": ">", ">": "<", "<=": ">=", ">=": "<="}


def option_repr(tid: str, text: str):
    """Şık metninin bağımsız temsili: Fraction, ('ray', yön, sınır, kapalı), ('abs>', merkez, r), ('a^', işaret, üs)."""
    t = text.strip("`").strip()
    if tid == "sayi-dogrusu-esitsizlik":
        m = _LINEAR.match(t)
        if m:  # c - kx REL n  →  -kx REL n - c  →  x REL' (c - n)/k (negatife bölünce yön döner)
            c, k, rel, n = int(m[1]), int(m[2]), m[3], int(m[4])
            flipped = _FLIP[rel]
            return ("ray", flipped[0], Fraction(c - n, k), flipped.endswith("="))
        m = _ABS_GT.match(t)
        if m:
            center = 0 if m[1] is None else (int(m[2]) if m[1] == "-" else -int(m[2]))
            return ("abs>", center, int(m[3]))
    if tid == "uslu-sadelestirme" and "a" in t:
        m = _A_POWER.match(t)
        assert m, t
        return ("a^", m[1] == "-", 1 if m[2] is None else int(m[2]))
    t = re.sub(r"\s*TL$", "", t)
    return frac_eval(t[1:] if t.startswith("%") else t)


def linear_root(lhs: str, rhs: str) -> Fraction:
    """``lhs = rhs`` (x'te doğrusal) kökü: f(x) = lhs - rhs, iki noktadan eğim."""
    def at(expr: str, v: int) -> Fraction:
        return frac_eval(re.sub(r"x", f"({v})", re.sub(r"(\d)x", r"\1*x", expr)))

    f0, f1 = at(lhs, 0) - at(rhs, 0), at(lhs, 1) - at(rhs, 1)
    assert f1 != f0, (lhs, rhs)
    return -f0 / (f1 - f0)


def independent_answer(tid: str, item: dict):
    p = item["template"]["params"]
    if tid == "islem-onceligi":
        return frac_eval(_stem_expr(item["stem"]))
    if tid == "uslu-sadelestirme":
        exps = p["usler"]
        exp = {"carpim": lambda: sum(exps), "bolum": lambda: sum(exps) - p["bolen_us"],
               "kuvvet": lambda: exps[0] * exps[1] + p["carpan_us"]}[p["bicim"]]()
        if p["taban"] == "a":
            return ("a^", False, exp)
        value = Fraction(p["taban"]) ** exp
        assert frac_eval(_stem_expr(item["stem"])) == value, item["stem"]
        return value
    if tid == "denklem-birinci-derece":
        codes = re.findall(r"`([^`]+)`", item["stem"])
        lhs, rhs = codes[0].split("=")
        root = linear_root(lhs, rhs)
        assert root == p["cozum"], (codes, p)
        if len(codes) == 1:
            return root
        return frac_eval(re.sub(r"x", f"({root})", re.sub(r"(\d)x", r"\1*x", codes[1])))
    if tid == "kesir-modeli-toplama":
        return Fraction(p["pay_1"], p["payda_1"]) + Fraction(p["pay_2"], p["payda_2"])
    if tid == "sayi-dogrusu-esitsizlik":
        if p["bicim"] == "dogrusal":
            return ("ray", "<" if p["yon"] == "sol" else ">", Fraction(p["t"]), False)
        a, b, closed = p["a"], p["b"], p["kapali"]
        return Fraction(sum(n for n in range(a - b, a + b + 1) if (abs(n - a) <= b if closed else abs(n - a) < b)))
    if tid == "yuzde-grafik":
        if p["bicim"] == "ardisik":
            c1, c2 = p["degisimler"]
            return Fraction(p["fiyat"]) * Fraction(100 + c1, 100) * Fraction(100 + c2, 100)
        cost = Fraction(p["maliyet"])
        sale = cost * Fraction(100 + p["zam"], 100) * Fraction(100 - p["indirim"], 100) \
            if p["bicim"] == "kar-ardisik" else Fraction(p["satis"])
        assert sale == p["satis"]
        return abs(sale - cost) * 100 / cost
    raise AssertionError(tid)


def test_independent_cross_check_matches_exactly_one_option(generated):
    """SymPy ve _common ayrıştırıcısı olmadan: parametrelerden hesaplanan cevap yalnız anahtardaki şıkta."""
    tid, _mod, rows = generated
    for seed, item, key, _fig in rows:
        expected = independent_answer(tid, item)
        matched = [o["key"] for o in item["options"] if option_repr(tid, o["text"]) == expected]
        assert matched == [key["correct_option"]], (tid, seed, expected, item["options"])


def test_independent_parser_rejects_its_own_mistakes():
    """Bağımsız ayrıştırıcının kendisi: bilinen değerler (yanlış uygulama bu tabloyu geçemez)."""
    table = {"`7/8`": Fraction(7, 8), "`-11`": Fraction(-11), "`%25`": Fraction(25), "`120 TL`": Fraction(120),
             "`2^(-3)`": Fraction(1, 8), "`-5^2`": Fraction(-25), "`(2^3)^(-1) · 2^5`": Fraction(4),
             "`-3 - (-6) ÷ 3 · 4`": Fraction(5), "`3^5 · 3^(-2) / 3^(-3)`": Fraction(729)}
    for text, value in table.items():
        assert option_repr("islem-onceligi", text) == value, text
    assert option_repr("sayi-dogrusu-esitsizlik", "`1 - 3x > 10`") == ("ray", "<", Fraction(-3), False)
    assert option_repr("sayi-dogrusu-esitsizlik", "`-1 - 2x <= -13`") == ("ray", ">", Fraction(6), True)
    assert option_repr("sayi-dogrusu-esitsizlik", "`|x + 1| > 2`") == ("abs>", -1, 2)
    assert option_repr("uslu-sadelestirme", "`-a^9`") == ("a^", True, 9)
    assert option_repr("uslu-sadelestirme", "`a^(-2)`") == ("a^", False, -2)
    assert linear_root("8x - 7 ", " 7x + 2") == 9 and linear_root("x/5 - 1 ", " -7") == -30


def test_every_form_appears_in_fifty_seeds():
    expected = {
        "uslu-sadelestirme": {"carpim", "bolum", "kuvvet"},
        "islem-onceligi": {"negatif-carpim", "parantez-eksi", "eksi-carpim", "bolme"},
        "sayi-dogrusu-esitsizlik": {"dogrusal", "mutlak"},
        "yuzde-grafik": {"ardisik", "kar", "kar-ardisik"},
    }
    for tid, forms in expected.items():
        seen = {item["template"]["params"]["bicim"] for _s, item, _k, _f in variants(tid)}
        assert seen == forms, (tid, seen)
        assert set(templates.load(tid).PARAMS_SCHEMA["properties"]["bicim"]["enum"]) == forms


def test_spec_tag_pairs_carried_together():
    """§10.4 etiket çifti: sayi-dogrusu (negatifle-carpma-yon + tek-durum) ve yuzde (ardisik-toplama +
    kar-satis-uzerinden) aynı soruda birlikte bulunur (dogrusal ve kar-ardisik biçimleri)."""
    pairs = {"sayi-dogrusu-esitsizlik": ("dogrusal", {"esitsizlik.negatifle-carpma-yon", "mutlak.tek-durum"}),
             "yuzde-grafik": ("kar-ardisik", {"yuzde.ardisik-toplama", "yuzde.kar-satis-uzerinden"}),
             "uslu-sadelestirme": (None, {"uslu.usleri-carpma", "uslu.negatif-us-isaret"})}
    for tid, (form, tags) in pairs.items():
        rows = [item for _s, item, _k, _f in variants(tid) if form is None or item["template"]["params"]["bicim"] == form]
        assert rows, tid
        for item in rows:
            assert {o["misconception_tag"] for o in item["options"]} - {None} == tags, (tid, item["options"])


# --- şablon başına bağımsız matematik ---------------------------------------------------------


def _stem_expr(stem: str) -> str:
    return re.search(r"`([^`]+)`", stem).group(1)


def test_islem_onceligi_math():
    for seed, item, key, _ in variants("islem-onceligi"):
        expr = _stem_expr(item["stem"])
        assert C.values_equal(C.parse_math(expr), option_value(item, key["correct_option"])), seed
        p = item["template"]["params"]
        a, b, c, d = p["a"], p["b"], p["c"], p["d"]
        soldan = tagged_value(item, "sayilar.islem-onceligi-soldan")
        if p["bicim"] == "negatif-carpim":
            assert soldan == (a - b) * (c - d)
            assert tagged_value(item, "sayilar.negatif-carpim-isaret") == a - b * (d - c)
        elif p["bicim"] == "parantez-eksi":
            assert soldan == (b - a + c) * d
            assert tagged_value(item, "sayilar.parantez-eksi-dagitma") == -a - b + c * d
        elif p["bicim"] == "bolme":
            assert "÷" in expr and b % c == 0 and a % c == 0, seed
            assert option_value(item, key["correct_option"]) == a + (b // c) * d
            assert soldan == sympy.Rational(a + b, c) * d  # (a - (-b)) ÷ c · d
            assert tagged_value(item, "sayilar.negatif-carpim-isaret") == a - (b // c) * d
        else:
            assert soldan == (c + a) * (-b)
            assert tagged_value(item, "sayilar.negatif-carpim-isaret") == c + a * b


def test_uslu_math():
    for seed, item, key, _ in variants("uslu-sadelestirme"):
        p = item["template"]["params"]
        base = sympy.Symbol("a", real=True) if p["taban"] == "a" else sympy.Integer(p["taban"])
        exps = p["usler"]
        if p["bicim"] == "carpim":
            total, wrong, neg = sum(exps), math.prod(exps), sum(abs(e) for e in exps)
            all_exps = exps
        elif p["bicim"] == "bolum":
            k = p["bolen_us"]
            total = sum(exps) - k
            wrong = exps[0] * exps[1] - k if len(exps) == 2 else (exps[0] // k if exps[0] % k == 0 else exps[0] * k)
            neg = sum(abs(e) for e in exps) - abs(k)
            all_exps = [*exps, k]
            assert "/" in item["stem"]
        else:
            (m, n), k = exps, p["carpan_us"]
            total, wrong, neg = m * n + k, m * n * k, abs(m) * abs(n) + abs(k)
            all_exps = [m, n, k]
            assert C.values_equal(next(C.parse_math(o["text"]) for o in item["options"]
                                       if o["misconception_tag"] is None and o["key"] != key["correct_option"]),
                                  base ** (m + n + k))  # kuvvette üsleri toplama (etiketsiz)
        expected = base ** total
        assert C.values_equal(option_value(item, key["correct_option"]), expected), seed
        assert C.values_equal(C.parse_math(_stem_expr(item["stem"].split("olmak üzere")[-1])), expected)
        assert C.values_equal(tagged_value(item, "uslu.usleri-carpma"), base ** wrong)
        assert C.values_equal(tagged_value(item, "uslu.negatif-us-isaret"), -(base ** neg))
        assert any(e < 0 for e in all_exps)


def test_denklem_math():
    x = sympy.Symbol("x")
    for seed, item, key, _ in variants("denklem-birinci-derece"):
        codes = re.findall(r"`([^`]+)`", item["stem"])
        lhs, rhs = codes[0].split("=")
        norm = lambda s: C.normalize_math(s).replace("x", "(x)")  # noqa: E731
        sol = sympy.solve(sympy.Eq(sympy.sympify(norm(lhs)), sympy.sympify(norm(rhs))), x)
        assert len(sol) == 1 and sol[0].is_integer, (seed, codes)
        asked = sympy.sympify(norm(codes[1])).subs(x, sol[0]) if len(codes) > 1 else sol[0]
        assert C.values_equal(option_value(item, key["correct_option"]), asked), seed
        assert sol[0] == item["template"]["params"]["cozum"]


def test_kesir_math():
    for seed, item, key, _ in variants("kesir-modeli-toplama"):
        p = item["template"]["params"]
        p1, q1, p2, q2 = p["pay_1"], p["payda_1"], p["pay_2"], p["payda_2"]
        assert q1 != q2 and 0 < p1 < q1 and 0 < p2 < q2
        assert option_value(item, key["correct_option"]) == sympy.Rational(p1, q1) + sympy.Rational(p2, q2), seed
        assert tagged_value(item, "rasyonel.pay-payda-ayri-toplama") == sympy.Rational(p1 + p2, q1 + q2)
        assert tagged_value(item, "rasyonel.payda-esitlemeden-toplama") == sympy.Rational(p1 + p2, max(q1, q2))
        assert item["stem_values"] == p
        assert f"{q1} eş parçaya" in item["figure"]["alt_text"] and f"{p2} parçası" in item["figure"]["alt_text"]


def test_sayi_dogrusu_math():
    x = C.X
    for seed, item, key, _ in variants("sayi-dogrusu-esitsizlik"):
        p = item["template"]["params"]
        correct = option_value(item, key["correct_option"])
        if p["bicim"] == "dogrusal":
            t = p["t"]
            ray = sympy.Interval.open(-sympy.oo, t) if p["yon"] == "sol" else sympy.Interval.open(t, sympy.oo)
            assert sympy.solveset(correct, x, sympy.S.Reals) == ray, seed
            wrong = sympy.solveset(tagged_value(item, "esitsizlik.negatifle-carpma-yon"), x, sympy.S.Reals)
            assert wrong == (sympy.Interval.open(t, sympy.oo) if p["yon"] == "sol" else sympy.Interval.open(-sympy.oo, t))
            # tek durum: |x - a| > r'nin çözümü iki ışın; biri şekildeki ışın, öbürü değil
            tek = sympy.solveset(tagged_value(item, "mutlak.tek-durum"), x, sympy.S.Reals)
            assert ray.is_subset(tek) and tek != ray and len(tek.args) == 2, (seed, tek)
            assert item["skill_ids"] == ["tyt.mat.cebir.esitsizlik"]
        else:
            a, b, closed = p["a"], p["b"], p["kapali"]
            ints = [n for n in range(a - b - 1, a + b + 2) if (abs(n - a) <= b if closed else abs(n - a) < b)]
            assert correct == sum(ints), seed
            assert tagged_value(item, "genel.soruyu-yarim-okuma") == len(ints)
            assert item["skill_ids"][0] == "tyt.mat.cebir.mutlak-deger"


def test_yuzde_math():
    for seed, item, key, _ in variants("yuzde-grafik"):
        p = item["template"]["params"]
        correct = option_value(item, key["correct_option"])
        if p["bicim"] == "ardisik":
            price, (c1, c2) = p["fiyat"], p["degisimler"]
            final = Fraction(price) * Fraction(100 + c1, 100) * Fraction(100 + c2, 100)
            assert correct == sympy.Rational(final.numerator, final.denominator), seed
            assert tagged_value(item, "yuzde.ardisik-toplama") == sympy.Rational(price * (100 + c1 + c2), 100)
        else:
            cost, sale = p["maliyet"], p["satis"]
            if p["bicim"] == "kar-ardisik":
                assert sale == cost * (100 + p["zam"]) * (100 - p["indirim"]) // 10000
                assert tagged_value(item, "yuzde.ardisik-toplama") == abs(p["zam"] - p["indirim"])
            assert correct == sympy.Rational(abs(sale - cost) * 100, cost), seed
            assert tagged_value(item, "yuzde.kar-satis-uzerinden") == sympy.Rational(abs(sale - cost) * 100, sale)


# --- yükleme yolları ---------------------------------------------------------------------------


def test_module_path_resolves_like_question_templates_row():
    for tid in TEMPLATE_IDS:
        gen = templates.resolve(templates.module_path(tid), REPO_ROOT)
        item, key, _fig = gen(random.Random(3))
        assert item["template"]["id"] == tid and key["sympy_status"] == "verified"


def test_template_loads_from_file_path_in_fresh_interpreter(tmp_path):
    """M06 şablonu yalnız dosya yolundan yükler (paket kurulumu yok)."""
    code = (
        "import importlib.util, random, sys\n"
        f"spec = importlib.util.spec_from_file_location('t', {str(CONTENT_DIR / 'templates' / 'kesir_modeli_toplama.py')!r})\n"
        "m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)\n"
        "item, key, fig = m.generate(random.Random(5))\n"
        f"info = fig.render({str(tmp_path / 'k.png')!r})\n"
        "print(item['template']['id'], info['width_px'])\n"
    )
    proc = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True, timeout=120, cwd=tmp_path)
    assert proc.returncode == 0, proc.stderr
    assert proc.stdout.split() == ["kesir-modeli-toplama", "800"]
