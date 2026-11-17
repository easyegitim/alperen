from __future__ import annotations

import ogrenmen_contracts as oc


def test_load_models_validates_and_copies():
    m = oc.load_models()
    assert m["verified_at"] == "2026-10-19"
    assert m["currency"] == "USD"
    m["chains"]["chat"].clear()
    assert oc.load_models()["chains"]["chat"]


def test_chain_members_exist_and_providers_exist():
    m = oc.load_models()
    for chain, models in m["chains"].items():
        for name in models:
            assert name in m["models"], (chain, name)
    for name, model in m["models"].items():
        assert model["provider"] in m["providers"], name


def test_free_only_chain_is_free():
    m = oc.load_models()
    for name in m["chains"]["chat_free_only"]:
        assert m["models"][name]["in_per_m"] == 0 and m["models"][name]["out_per_m"] == 0


def test_long_context_purposes_only_gemini():
    m = oc.load_models()
    for chain in ("research", "lesson_analysis", "nightly_facts"):
        for name in m["chains"][chain]:
            assert m["models"][name]["ctx"] >= 200000, (chain, name)


def test_free_gemini_declares_training_use():
    assert oc.load_models()["providers"]["gemini-free"]["trains_on_data"] is True
