"""6 şablon × 50 varyant (BLUEPRINT §10.4, §11 M03): şemaya uygun, SymPy doğrular, şekilliler PNG üretir
(200–1600 px), en az iki etiketsiz şık; ayrıca her şablonun matematiği bağımsız olarak yeniden hesaplanır."""

from __future__ import annotations

import json
import math
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


@pytest.fixture(scope="module", params=TEMPLATE_IDS)
def generated(request):
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


def test_sympy_independently_matches_exactly_one_option(generated):
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


def test_figures_render_png_within_bounds(generated, tmp_path):
    tid, mod, rows = generated
    if not mod.HAS_FIGURE:
        pytest.skip("şekilsiz şablon")
    for seed, item, _key, fig in rows:
        info = fig.render(tmp_path / f"{tid}-{seed}.png")
        assert 200 <= info["width_px"] <= 1600 and 200 <= info["height_px"] <= 1600, (tid, seed, info)
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
        else:
            assert soldan == (c + a) * (-b)
            assert tagged_value(item, "sayilar.negatif-carpim-isaret") == c + a * b


def test_uslu_math():
    for seed, item, key, _ in variants("uslu-sadelestirme"):
        p = item["template"]["params"]
        base = sympy.Symbol("a", real=True) if p["taban"] == "a" else sympy.Integer(p["taban"])
        exps = p["usler"]
        expected = base ** sum(exps)
        assert C.values_equal(option_value(item, key["correct_option"]), expected), seed
        assert C.values_equal(C.parse_math(_stem_expr(item["stem"].split("olmak üzere")[-1])), expected)
        assert C.values_equal(tagged_value(item, "uslu.usleri-carpma"), base ** math.prod(exps))
        assert C.values_equal(tagged_value(item, "uslu.negatif-us-isaret"), -(base ** sum(abs(e) for e in exps)))
        assert any(e < 0 for e in exps)


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
