"""``template --id``: sıfır LLM varyant üretimi, şema, anahtar yalıtımı, determinizm (§6.1, §10.4)."""

from __future__ import annotations

import json
import random

import ogrenmen_contracts as contracts
import pytest
import sympy
from ogrenmen_common.fakes import llm as fake_llm
from ogrenmen_common.ledger import CostLedger
from ogrenmen_common.runtime import Runtime

from conftest import TABLET_FIXTURES, read_jsonl
from ogrenmen_tablet import cli
from ogrenmen_tablet import fill as F
from ogrenmen_tablet import templates as T

ALL_TEMPLATES = ["sayi-dogrusu-esitsizlik", "kesir-modeli-toplama", "yuzde-grafik", "islem-onceligi",
                 "uslu-sadelestirme", "denklem-birinci-derece"]
FIGURE_TEMPLATES = {"sayi-dogrusu-esitsizlik", "kesir-modeli-toplama", "yuzde-grafik"}


def run(argv, **kw) -> int:
    return cli.main([str(a) for a in argv], **kw)


def test_registry_lists_all_six_templates():
    assert T.template_ids() == ALL_TEMPLATES
    for tid in ALL_TEMPLATES:
        mod = T.load_template(tid)
        assert mod.TEMPLATE_ID == tid
        assert T.module_path(tid).startswith("content/tyt-matematik/templates/")


def test_item_json_has_no_key_field(tmp_path):
    out = tmp_path / "out"
    assert run(["template", "--id", "kesir-modeli-toplama", "--count", 5, "--seed", 7, "--out", out]) == 0
    raw = (out / "questions.jsonl").read_text(encoding="utf-8")
    for field in T.KEY_FIELDS:
        assert f'"{field}"' not in raw, field
    rows = read_jsonl(out / "questions.jsonl")
    assert len(rows) == 5
    for item in rows:
        contracts.validate("question-item", item)
        assert item["source"] == "template" and item["template"]["id"] == "kesir-modeli-toplama"
        assert item["verification"]["sympy"] == "verified" and item["verification"]["render"] == "ok"
        nulls = sum(1 for o in item["options"] if o["misconception_tag"] is None)
        assert len(item["options"]) == 4 and nulls >= 2
        png = out / "figures" / item["figure"]["render"]["png_path"].removeprefix("figures/")
        assert png.is_file() and png.read_bytes()[:8] == b"\x89PNG\r\n\x1a\n"
        assert 200 <= item["figure"]["render"]["width_px"] <= 1600
    assert not (out / "keys.jsonl").exists(), "anahtar dosyası yalnız --dump-keys ile yazılır"
    assert len(list((out / "figures").glob("*.png"))) == len({r["figure"]["code"] for r in rows})


def test_dump_keys_is_separate_and_sympy_consistent(tmp_path):
    out = tmp_path / "out"
    assert run(["template", "--id", "uslu-sadelestirme", "--count", 6, "--seed", 3, "--out", out, "--dump-keys"]) == 0
    items = read_jsonl(out / "questions.jsonl")
    keys = read_jsonl(out / "keys.jsonl")
    assert len(items) == len(keys) == 6
    common = T.common()
    for item, key in zip(items, keys, strict=True):
        assert key["content_hash"] == T.content_hash(item["stem"], item["options"])
        record = {k: v for k, v in key.items() if k not in ("template_id", "content_hash")}
        contracts.validate("answer-key", record)
        assert record["sympy_status"] == "verified"
        value = common.sympify_expr(record["canonical_expr"])
        matched = [o["key"] for o in item["options"] if common.values_equal(common.parse_math(o["text"]), value)]
        assert matched == [record["correct_option"]]
    assert not list(out.glob("figures/*.png")), "şekilsiz şablon PNG yazmaz"


def test_variants_deterministic_by_seed(tmp_path):
    a, b, c = tmp_path / "a", tmp_path / "b", tmp_path / "c"
    for d, seed in ((a, 7), (b, 7), (c, 8)):
        assert run(["template", "--id", "yuzde-grafik", "--count", 4, "--seed", seed, "--out", d]) == 0
    assert (a / "questions.jsonl").read_bytes() == (b / "questions.jsonl").read_bytes()
    pngs_a = sorted(p.name for p in (a / "figures").glob("*.png"))
    assert pngs_a == sorted(p.name for p in (b / "figures").glob("*.png"))
    for name in pngs_a:
        assert (a / "figures" / name).read_bytes() == (b / "figures" / name).read_bytes()
    assert (a / "questions.jsonl").read_bytes() != (c / "questions.jsonl").read_bytes()
    # API düzeyi: aynı tohum aynı hash dizisi, farklı tohum farklı
    first = [v.content_hash for v in T.generate_variants("islem-onceligi", 10, 11)]
    assert first == [v.content_hash for v in T.generate_variants("islem-onceligi", 10, 11)]
    assert first != [v.content_hash for v in T.generate_variants("islem-onceligi", 10, 12)]
    assert len(set(first)) == 10, "varyantlar content_hash'e göre tekrarsız"


@pytest.mark.parametrize("tid", ALL_TEMPLATES)
def test_every_template_variant_is_schema_valid(tid, tmp_path):
    variants = T.generate_variants(tid, 3, 5)
    for v in variants:
        assert (v.figure is not None) == (tid in FIGURE_TEMPLATES)
        if v.figure is not None:
            v.render(tmp_path)
            p_fig = v.p_figure()
            assert p_fig["code_hash"] == v.figure.code_hash
            assert p_fig["png_path"] == f"figures/{v.figure.code_hash}.png"
        else:
            assert v.p_figure() is None and v.item["figure"] is None
        params = v.rpc_params()
        assert params["p_item"]["content_hash"] == v.content_hash
        assert "question_id" not in params["p_key"] and params["p_key"]["sympy_status"] == "verified"
        T.check_no_key_fields(params["p_item"])
        contracts.validate("question-item", {k: x for k, x in params["p_item"].items() if k != "content_hash"})


def test_figure_requires_render_before_payload():
    v = T.generate_variants("kesir-modeli-toplama", 1, 1)[0]
    with pytest.raises(T.TemplateError, match="OGR-TPL-005"):
        v.p_figure()


def test_schema_violation_is_rejected(monkeypatch):
    mod = T.load_template("islem-onceligi")
    original = mod.generate

    def broken(rng):
        item, key, fig = original(rng)
        item["stem"] = "kısa"  # minLength 10
        return item, key, fig

    monkeypatch.setattr(mod, "generate", broken)
    with pytest.raises(T.TemplateError, match="OGR-CONTRACT-001"):
        T.make_variant(mod, random.Random(1), 0)


def test_option_rule_is_enforced():
    """§10.3 şık kuralı ayrıca denetlenir (şema dışı yollar için de: ör. veritabanından gelen satır)."""
    v = T.generate_variants("islem-onceligi", 1, 1)[0]
    T.check_option_rule(v.item)
    one_null = {**v.item, "options": [{**o, "misconception_tag": None if o["key"] == v.key["correct_option"]
                                       else "sayilar.islem-onceligi-soldan"} for o in v.item["options"]]}
    with pytest.raises(T.TemplateError, match="OGR-Q-002"):
        T.check_option_rule(one_null)
    with pytest.raises(T.TemplateError, match="OGR-Q-002"):
        T.check_option_rule({**v.item, "options": v.item["options"][:3]})
    T.check_option_rule({**v.item, "kind": "numeric", "options": None})


def test_key_leak_into_item_is_rejected():
    item = {"stem": "x", "correct_option": "A"}
    with pytest.raises(T.TemplateError, match="correct_option"):
        T.check_no_key_fields(item)


def test_unknown_template_fails_cleanly(capsys, tmp_path):
    from ogrenmen_common.cli_base import run_main

    code = run_main(cli.main, ["template", "--id", "yok-boyle", "--count", "2", "--out", str(tmp_path)])
    assert code == 1
    assert "OGR-TPL-002" in capsys.readouterr().err


@pytest.mark.parametrize("argv", [
    ["template", "--count", "2", "--out", "{out}"],                                   # --id yok
    ["template", "--id", "islem-onceligi"],                                           # --out yok
    ["template", "--fill", "--auto-approve", "--out", "{out}"],
    ["template", "--id", "islem-onceligi", "--count", "0", "--out", "{out}"],
    ["template", "--fill", "--min-stock", "0", "--out", "{out}"],
    ["generate", "--skill", "tyt.mat.temel.sayilar"],                                 # pilotta ertelendi
    ["template", "--fill", "--count", "5", "--out", "{out}"],                         # --count --fill ile anlamsız
    ["template", "--id", "islem-onceligi", "--min-stock", "5", "--out", "{out}"],     # --min-stock yalnız --fill
])
def test_cli_rejects_invalid_arguments(argv, tmp_path):
    with pytest.raises(SystemExit) as exc:
        run([a.replace("{out}", str(tmp_path)) for a in argv])
    assert exc.value.code == 2


def test_template_zero_llm_calls(tmp_path, monkeypatch):
    """Üç kipte de (yalnız üretim, --auto-approve, --fill) hiçbir model çağrısı yapılmaz (FakeLLM.calls == 0)."""
    calls: list[str] = []
    real_complete = fake_llm.FakeLLM.complete

    def counting(self, request):
        calls.append(request.purpose)
        return real_complete(self, request)

    monkeypatch.setattr(fake_llm.FakeLLM, "complete", counting)

    def no_ledger(self, *a, **k):
        raise AssertionError("şablon yolu CostLedger.call çağırmamalı")

    monkeypatch.setattr(CostLedger, "call", no_ledger)
    assert run(["template", "--id", "kesir-modeli-toplama", "--count", 3, "--out", tmp_path / "a"]) == 0
    assert run(["template", "--id", "islem-onceligi", "--count", 3, "--auto-approve", "--dry-run",
                "--fixtures", TABLET_FIXTURES, "--out", tmp_path / "b"]) == 0
    assert run(["template", "--fill", "--min-stock", 4, "--dry-run", "--fixtures", TABLET_FIXTURES,
                "--out", tmp_path / "c"]) == 0
    assert calls == []
    for d in ("a", "b", "c"):
        est = json.loads((tmp_path / d / "cost_estimate.json").read_text(encoding="utf-8"))
        assert est["attempts"] == 0 and est["total_usd"] == 0
        assert not (tmp_path / d / "llm_calls.jsonl").exists()
    summary = json.loads((tmp_path / "c" / "template_fill.json").read_text(encoding="utf-8"))
    assert summary["llm_calls"] == 0
    # doğrudan API: Runtime'ın sahte LLM'i ve defteri hiç kullanılmaz
    rt = Runtime.from_env(dry_run=True, fixtures=TABLET_FIXTURES, out=tmp_path / "d")
    try:
        F.fill_stock(rt.db, rt.storage, min_stock=3, seed=7, figures_dir=tmp_path / "d" / "figures")
        assert rt.llm.calls == [] and rt.ledger.calls == []
    finally:
        rt.close()


def test_sympy_is_the_only_math_engine():
    """Şablon anahtarı SymPy ifadesidir: canonical_expr doğru şıkkın değerine eşittir."""
    v = T.generate_variants("denklem-birinci-derece", 1, 2)[0]
    value = T.common().sympify_expr(v.key["canonical_expr"])
    correct = next(o for o in v.item["options"] if o["key"] == v.key["correct_option"])
    assert sympy.simplify(T.common().parse_math(correct["text"]) - value) == 0


# --- şekil boyut denetimi (§6.1) ---------------------------------------------------------------------------------


def test_render_rejects_out_of_range_size(monkeypatch, tmp_path):
    """Çizilen PNG expected_px dışındaysa verification.render='size_mismatch' ve OGR-TPL-005."""
    v = T.generate_variants("kesir-modeli-toplama", 1, 1)[0]
    spec_cls = type(v.figure)
    original = spec_cls.render

    def tiny(self, path):
        info = original(self, path)
        return {**info, "width_px": 120}

    monkeypatch.setattr(spec_cls, "render", tiny)
    with pytest.raises(T.TemplateError, match="OGR-TPL-005") as exc:
        v.render(tmp_path)
    assert "120x" in exc.value.message
    assert v.item["verification"]["render"] == "size_mismatch" and v.render_info is None
    with pytest.raises(T.TemplateError, match="OGR-TPL-005"):
        v.p_figure()


def test_render_size_mismatch_fails_generate_command(monkeypatch, tmp_path, capsys):
    from ogrenmen_common.cli_base import run_main

    spec_cls = type(T.generate_variants("yuzde-grafik", 1, 1)[0].figure)
    original = spec_cls.render
    monkeypatch.setattr(spec_cls, "render", lambda self, path: {**original(self, path), "bytes": 3 * 1024 * 1024})
    code = run_main(cli.main, ["template", "--id", "yuzde-grafik", "--count", "1", "--out", str(tmp_path)])
    assert code == 1 and "OGR-TPL-005" in capsys.readouterr().err
    assert not (tmp_path / "questions.jsonl").exists()


def test_check_figure_render_bounds_and_blank(tmp_path):
    import numpy as np
    from matplotlib import image as mpimg

    blank = tmp_path / "blank.png"
    mpimg.imsave(blank, np.full((320, 800, 3), 0.96))
    noisy = tmp_path / "noisy.png"
    mpimg.imsave(noisy, np.random.default_rng(0).random((320, 800, 3)))
    ok = {"width_px": 800, "height_px": 320, "bytes": 10_000}
    px = {"min_w": 200, "max_w": 1600, "min_h": 200, "max_h": 1600}
    assert T.check_figure_render(ok, px, noisy) is None
    assert "boş" in T.check_figure_render(ok, px, blank)
    assert "bayt" in T.check_figure_render({**ok, "bytes": T.TEMPLATE_FIGURE_MIN_BYTES - 1}, px, noisy)
    assert "bayt" in T.check_figure_render({**ok, "bytes": T.FIGURE_MAX_BYTES + 1}, px, noisy)
    assert "boyut" in T.check_figure_render({**ok, "height_px": 1700}, px, noisy)
    assert "boyut" in T.check_figure_render({**ok, "height_px": 160}, px, noisy), "expected_px min_h=200"
    assert T.check_figure_render({**ok, "height_px": 160}, None, noisy) is None, "§6.1 varsayılanı min_h=150"


@pytest.mark.parametrize("tid", sorted(FIGURE_TEMPLATES))
def test_real_template_figures_pass_size_gate(tid, tmp_path):
    for v in T.generate_variants(tid, 8, 21):
        info = v.render(tmp_path)
        assert info["bytes"] >= T.TEMPLATE_FIGURE_MIN_BYTES and v.item["verification"]["render"] == "ok"


# --- template.params cevap değeri taşımaz -----------------------------------------------------------------------


def _numeric_leaves(node):
    if isinstance(node, dict):
        for value in node.values():
            yield from _numeric_leaves(value)
    elif isinstance(node, list):
        for value in node:
            yield from _numeric_leaves(value)
    elif isinstance(node, int | float) and not isinstance(node, bool):
        yield node


def test_denklem_params_do_not_carry_the_answer():
    variants = T.generate_variants("denklem-birinci-derece", 40, 4)
    for v in variants:
        params = v.item["template"]["params"]
        assert "cozum" not in params and "template.params" not in json.dumps(params)
        assert "cozum" in v.dropped_params
        answer = T.answer_value(v.key)
        assert answer is not None
        assert all(abs(x - float(answer)) > 1e-9 for x in _numeric_leaves(params)), (params, answer)
        T.check_no_answer_params(v.item, v.key)
    for tid in ALL_TEMPLATES:
        for v in T.generate_variants(tid, 10, 4):
            answer = T.answer_value(v.key)
            if answer is not None:
                assert all(abs(x - float(answer)) > 1e-9 for x in _numeric_leaves(v.item["template"]["params"]))


def test_param_equal_to_answer_is_dropped(monkeypatch):
    mod = T.load_template("islem-onceligi")
    original = mod.generate

    def leaky(rng):
        item, key, fig = original(rng)
        value = int(T.common().sympify_expr(key["canonical_expr"]))
        item["template"]["params"]["ipucu"] = value
        item["template"]["params"]["ic"] = {"deger": value, "baska": value + 1000}
        item["template"]["params"]["liste"] = [value + 1000, value]
        return item, key, fig

    monkeypatch.setattr(mod, "generate", leaky)
    v = T.make_variant(mod, random.Random(5), 0)
    params = v.item["template"]["params"]
    assert "ipucu" not in params and "liste" not in params and params["ic"] == {"baska": params["ic"]["baska"]}
    assert set(v.dropped_params) == {"ipucu", "ic.deger", "liste"}
    with pytest.raises(T.TemplateError, match="OGR-CONTRACT-001"):
        T.check_no_answer_params({"template": {"params": {"x": [int(T.answer_value(v.key))]}}}, v.key)
    with pytest.raises(T.TemplateError, match="cozum"):
        T.check_no_answer_params({"template": {"params": {"cozum": 99999}}}, v.key)


def test_generate_only_timestamp_is_fixed_in_dry_run(tmp_path):
    env = {"OGRENMEN_NOW": "2026-11-02T06:00:00Z"}
    for d in ("a", "b"):
        assert run(["template", "--id", "islem-onceligi", "--count", 2, "--out", tmp_path / d], env=env) == 0
    a = (tmp_path / "a" / "cost_estimate.json").read_bytes()
    assert a == (tmp_path / "b" / "cost_estimate.json").read_bytes()
    assert json.loads(a)["generated_at"] == "2026-11-02T06:00:00Z"
