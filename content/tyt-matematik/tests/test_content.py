"""İçerik verisinin BLUEPRINT §10 ile tutarlılığı ve validate.py'nin geçmesi."""

from __future__ import annotations

import json
import subprocess
import sys
from collections import Counter

from conftest import CONTENT_DIR, REPO_ROOT

from templates import _common as C

P = "tyt.mat."


def test_validate_cli_passes():
    proc = subprocess.run([sys.executable, str(CONTENT_DIR / "scripts" / "validate.py")], capture_output=True,
                          text=True, timeout=300)
    assert proc.returncode == 0, proc.stdout + proc.stderr
    assert "geçerli" in proc.stdout


def test_validate_report_has_no_errors(lib):
    report = lib.validate_content(lib.load_content())
    assert report.errors == []


def test_curriculum_fields(lib):
    cur = lib.load_content().curriculum
    assert cur["code"] == "TYT-MAT" and cur["version"] == "2026.1" and cur["status"] == "active"
    assert cur["period_label"] == "YKS 2027"
    assert cur["diagnostic_exempt"] == [P + "problem.yas", P + "problem.isci"]


def test_skill_tree_three_nodes_eighteen_leaves(lib):
    skills = lib.load_content().skills
    nodes = [s["id"] for s in skills if not s["is_leaf"]]
    leaves = [s for s in skills if s["is_leaf"]]
    assert nodes == [P + "temel", P + "cebir", P + "problem"]
    assert len(leaves) == 18
    assert all(s[p] == v for s in leaves for p, v in (("p_init", 0.3), ("p_learn", 0.1), ("p_guess", 0.25),
                                                       ("p_slip", 0.1)))


def test_prerequisites_match_blueprint_table(lib):
    edges = {(e["skill_id"], e["prereq_id"]): e["strength"] for e in lib.load_content().prerequisites}
    assert len(edges) == 24
    assert edges[(P + "temel.rasyonel-sayilar", P + "temel.ebob-ekok")] == 0.6
    assert edges[(P + "cebir.mutlak-deger", P + "cebir.esitsizlik")] == 0.9
    assert edges[(P + "problem.yuzde", P + "temel.ondalik")] == 0.7
    assert edges[(P + "problem.isci", P + "temel.rasyonel-sayilar")] == 0.6


def test_tags(lib):
    tags = lib.load_content().tags
    assert len(tags) == 27
    nulls = [t["tag"] for t in tags if t["skill_id"] is None]
    assert nulls == ["genel.soruyu-yarim-okuma"]
    by = {t["tag"]: t for t in tags}
    assert by["rasyonel.payda-esitlemeden-toplama"]["prereq_skill_id"] == P + "temel.ebob-ekok"


def test_diagnostic_distribution(lib):
    content = lib.load_content()
    counts = Counter(s for i in content.items for s in i["skill_ids"])
    for short in ("temel.sayilar", "temel.rasyonel-sayilar", "temel.uslu", "cebir.denklem"):
        assert counts[P + short] == 2
    for short in ("temel.bolunebilme", "temel.ebob-ekok", "temel.ondalik", "temel.koklu", "temel.carpanlara-ayirma",
                  "cebir.esitsizlik", "cebir.mutlak-deger", "cebir.oran-oranti", "problem.sayi", "problem.kesir",
                  "problem.yuzde", "problem.hareket"):
        assert counts[P + short] == 1
    assert counts[P + "problem.yas"] == 0 and counts[P + "problem.isci"] == 0
    assert sum(1 for i in content.items if i["figure"]) == 3
    figured = {i["skill_ids"][0] for i in content.items if i["figure"]}
    assert figured == {P + "temel.rasyonel-sayilar", P + "cebir.mutlak-deger", P + "problem.yuzde"}


def test_items_have_no_key_material():
    text = (CONTENT_DIR / "diagnostic" / "items.json").read_text(encoding="utf-8")
    assert "correct" not in text


def test_example_item_matches_blueprint(lib):
    content = lib.load_content()
    item = next(i for i in content.items if i["code"] == "DIAG-2026.1-07")
    assert item["stem"] == "`3/4 + 1/8` işleminin sonucu kaçtır?"
    assert [o["text"] for o in item["options"]] == ["`4/12`", "`7/8`", "`4/8`", "`3/32`"]
    assert content.keys["DIAG-2026.1-07"]["correct_option"] == "B"


def test_correct_options_spread_over_keys(lib):
    content = lib.load_content()
    spread = Counter(k["correct_option"] for k in content.keys.values())
    assert set(spread) == {"A", "B", "C", "D"}
    assert max(spread.values()) <= 6


def test_dev_seed_compatibility(lib):
    """fixtures/db/dev-seed.json aynı kimlik şemasını kullanır; seed üst üste uygulanınca content_hash çakışması
    yalnız aynı kimlikli satırla olabilir (aksi hâlde benzersizlik ihlali olurdu)."""
    seed = json.loads((REPO_ROOT / "fixtures" / "db" / "dev-seed.json").read_text(encoding="utf-8"))
    content = lib.load_content()
    assert seed["curricula"][0]["id"] == C.curriculum_uuid(content.code)
    by_hash = {q["content_hash"]: q["id"] for q in seed["questions"]}
    for item in content.items:
        h = C.content_hash(item["stem"], item["options"])
        if h in by_hash:
            assert by_hash[h] == C.uid("question", item["code"])
    seed_skill_ids = {s["id"] for s in seed["skills"]}
    assert seed_skill_ids == {s["id"] for s in content.skills}
    assert {t["tag"] for t in seed["misconception_tags"]} == {t["tag"] for t in content.tags}


def test_figure_sources_reproduce_pngs(tmp_path, lib):
    content = lib.load_content()
    for item in content.items:
        fig = item["figure"]
        if not fig:
            continue
        out = tmp_path / "x.png"
        src = CONTENT_DIR / "diagnostic" / fig["source_path"]
        proc = subprocess.run([sys.executable, str(src), str(out)], capture_output=True, text=True, timeout=120)
        assert proc.returncode == 0, proc.stderr
        committed = CONTENT_DIR / "diagnostic" / fig["png_path"]
        assert C.png_size(out) == C.png_size(committed)
        assert out.read_bytes() == committed.read_bytes(), f"{src.name} PNG'yi yeniden üretmiyor"
        w, h = C.png_size(committed)
        assert 200 <= w <= 1600 and 200 <= h <= 1600


def test_snapshot_matches_current_version(lib):
    content = lib.load_content()
    snap = json.loads((CONTENT_DIR / "versions" / "2026.1.json").read_text(encoding="utf-8"))
    assert set(snap["skill_ids"]) == {s["id"] for s in content.skills}
