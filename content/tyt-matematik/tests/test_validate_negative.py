"""validate.py denetimleri gerçekten hata yakalıyor mu: içeriğin geçici kopyası bozulur, rapor beklenen hatayı verir."""

from __future__ import annotations

import json
import struct
import zlib
from pathlib import Path

import pytest

P = "tyt.mat."


def _read(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def _write(path: Path, data) -> None:
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def _report(lib, base: Path, repo_root: Path | None = None, previous: Path | None = None):
    content = lib.load_content(base)
    return lib.validate_content(content, repo_root=repo_root or base.parents[1], previous=previous,
                                with_templates=False)


def _errors(report) -> str:
    return "\n".join(report.errors)


def test_copy_is_valid(lib, content_copy):
    assert _report(lib, content_copy).errors == []


def test_cycle_detected(lib, content_copy):
    path = content_copy / "prerequisites.json"
    edges = _read(path)
    edges.append({"skill_id": P + "temel.sayilar", "prereq_id": P + "cebir.denklem", "strength": 0.5})
    _write(path, edges)
    assert "döngü" in _errors(_report(lib, content_copy))


def test_kahn_on_small_graph(lib):
    edges = [{"skill_id": "b", "prereq_id": "a"}, {"skill_id": "c", "prereq_id": "b"}]
    assert lib.find_cycle_nodes({"a", "b", "c"}, edges) == []
    edges.append({"skill_id": "a", "prereq_id": "c"})
    assert lib.find_cycle_nodes({"a", "b", "c", "d"}, edges) == ["a", "b", "c"]


def test_tag_prereq_must_be_real_prerequisite(lib, content_copy):
    path = content_copy / "misconception-tags.json"
    tags = _read(path)
    tag = next(t for t in tags if t["tag"] == "rasyonel.payda-esitlemeden-toplama")
    tag["prereq_skill_id"] = P + "temel.koklu"
    _write(path, tags)
    assert "ön koşulu değil" in _errors(_report(lib, content_copy))


def test_tag_count_and_genel_rules(lib, content_copy):
    path = content_copy / "misconception-tags.json"
    tags = _read(path)
    tags[0]["skill_id"] = None  # sayilar.* etiketi null olamaz
    tags.pop()  # 26 etiket
    _write(path, tags)
    errors = _errors(_report(lib, content_copy))
    assert "27 etiket" in errors
    assert "genel.*" in errors


@pytest.mark.parametrize(
    ("field", "value", "needle"),
    [
        ("text_student", "Paydaları eşitleyelim!", "ünlem"),
        ("text_student", "Paydaları eşitlemeniz gerekir.", "sen dili"),
        ("text_instructor", "Paydaları ayrı toplama hatası.", "-yor"),
    ],
)
def test_tag_text_rules(lib, content_copy, field, value, needle):
    path = content_copy / "misconception-tags.json"
    tags = _read(path)
    tags[5][field] = value
    _write(path, tags)
    assert needle in _errors(_report(lib, content_copy))


def test_leaf_without_item_must_be_exempt(lib, content_copy):
    path = content_copy / "curriculum.json"
    cur = _read(path)
    cur["diagnostic_exempt"] = [P + "problem.yas"]
    _write(path, cur)
    assert f"{P}problem.isci: teşhis maddesi yok" in _errors(_report(lib, content_copy))


def test_consecutive_same_skill(lib, content_copy):
    items_path = content_copy / "diagnostic" / "items.json"
    keys_path = content_copy / "diagnostic" / "answer-keys.json"
    items, keys = _read(items_path), _read(keys_path)
    # 03 (denklem) ile 04 (sayilar) yer değiştirir → 04 ve 05: hayır; 01 sayilar, 02 uslu, 03 sayilar ... kodları düzelt
    items[2], items[3] = items[3], items[2]
    k2, k3 = items[2]["code"], items[3]["code"]
    items[2]["code"], items[3]["code"] = k3, k2
    keys[k2], keys[k3] = keys[k3], keys[k2]
    items[4], items[5] = items[5], items[4]  # 05 uslu, 06 bolunebilme: 02 uslu ile değil, 04 sayilar → 05 uslu
    k4, k5 = items[4]["code"], items[5]["code"]
    items[4]["code"], items[5]["code"] = k5, k4
    keys[k4], keys[k5] = keys[k5], keys[k4]
    items[0], items[1] = items[1], items[0]  # 01 uslu, 02 sayilar, 03 sayilar → ardışık
    k0, k1 = items[0]["code"], items[1]["code"]
    items[0]["code"], items[1]["code"] = k1, k0
    keys[k0], keys[k1] = keys[k1], keys[k0]
    _write(items_path, items)
    _write(keys_path, keys)
    assert "ardışık" in _errors(_report(lib, content_copy))


def test_option_rule_correct_must_be_untagged(lib, content_copy):
    items_path = content_copy / "diagnostic" / "items.json"
    items = _read(items_path)
    keys = _read(content_copy / "diagnostic" / "answer-keys.json")
    item = items[0]
    correct = keys[item["code"]]["correct_option"]
    for o in item["options"]:
        if o["key"] == correct:
            o["misconception_tag"] = "sayilar.islem-onceligi-soldan"
    _write(items_path, items)
    assert "doğru şık etiketsiz" in _errors(_report(lib, content_copy))


def test_option_rule_needs_two_tagged_and_one_untagged(lib, content_copy):
    items_path = content_copy / "diagnostic" / "items.json"
    keys = _read(content_copy / "diagnostic" / "answer-keys.json")
    items = _read(items_path)
    first, second = items[0], items[1]
    # ilk maddede bir etiketli çeldirici etiketsiz olur (yalnız 1 etiketli kalır)
    for o in first["options"]:
        if o["key"] != keys[first["code"]]["correct_option"] and o["misconception_tag"]:
            o["misconception_tag"] = None
            break
    # ikinci maddede etiketsiz çeldirici etiketlenir (3 etiketli)
    for o in second["options"]:
        if o["key"] != keys[second["code"]]["correct_option"] and o["misconception_tag"] is None:
            o["misconception_tag"] = "uslu.usleri-carpma"
    _write(items_path, items)
    errors = _errors(_report(lib, content_copy))
    assert f"{first['code']}: üç çeldiricinin en az 2'si etiketli" in errors
    assert f"{second['code']}: en az bir çeldirici etiketsiz" in errors


def test_wrong_key_fails_sympy(lib, content_copy):
    keys_path = content_copy / "diagnostic" / "answer-keys.json"
    keys = _read(keys_path)
    keys["DIAG-2026.1-07"]["correct_option"] = "C"
    keys["DIAG-2026.1-01"]["canonical_expr"] = "12 - 3*(2 + 5)"
    _write(keys_path, keys)
    errors = _errors(_report(lib, content_copy))
    assert "DIAG-2026.1-07: SymPy" in errors
    assert "DIAG-2026.1-01: SymPy" in errors


def test_missing_key_and_extra_key(lib, content_copy):
    keys_path = content_copy / "diagnostic" / "answer-keys.json"
    keys = _read(keys_path)
    keys.pop("DIAG-2026.1-20")
    keys["DIAG-2026.1-21"] = keys["DIAG-2026.1-19"]
    _write(keys_path, keys)
    errors = _errors(_report(lib, content_copy))
    assert "DIAG-2026.1-20: cevap anahtarı yok" in errors
    assert "DIAG-2026.1-21 için madde yok" in errors


def test_correct_field_in_items_rejected(lib, content_copy):
    items_path = content_copy / "diagnostic" / "items.json"
    items = _read(items_path)
    items[0]["correct"] = "C"
    _write(items_path, items)
    assert "correct" in _errors(_report(lib, content_copy))


def test_tag_must_belong_to_item_skill_or_prereq(lib, content_copy):
    items_path = content_copy / "diagnostic" / "items.json"
    items = _read(items_path)
    for o in items[0]["options"]:  # sayilar maddesine yuzde etiketi
        if o["misconception_tag"]:
            o["misconception_tag"] = "yuzde.ardisik-toplama"
            break
    _write(items_path, items)
    assert "ön koşullarına ait değil" in _errors(_report(lib, content_copy))


def _png(path: Path, width: int, height: int) -> None:
    raw = b"".join(b"\x00" + b"\xff" * width * 3 for _ in range(height))

    def chunk(kind: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)

    path.write_bytes(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
                     + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b""))


def test_figure_size_and_presence(lib, content_copy):
    figs = content_copy / "diagnostic" / "figures"
    _png(figs / "kesir-modeli-10.png", 120, 90)
    (figs / "yuzde-grafik-19.png").unlink()
    (figs / "sayi-dogrusu-15.py").unlink()
    errors = _errors(_report(lib, content_copy))
    assert "120×90 px" in errors
    assert "şekil dosyası yok" in errors
    assert "kaynağı yok" in errors


def test_two_active_versions_rejected(lib, content_copy):
    other = content_copy.parent / "tyt-matematik-2027"
    other.mkdir()
    cur = _read(content_copy / "curriculum.json")
    cur["version"], cur["year"] = "2027.1", 2027
    _write(other / "curriculum.json", cur)
    assert "tam bir active" in _errors(_report(lib, content_copy))
    cur["status"] = "draft"
    _write(other / "curriculum.json", cur)
    assert _report(lib, content_copy).errors == []


def test_status_required(lib, content_copy):
    path = content_copy / "curriculum.json"
    cur = _read(path)
    del cur["status"]
    _write(path, cur)
    assert "status" in _errors(_report(lib, content_copy))


def test_version_diff_report(lib, content_copy):
    ids = sorted(s["id"] for s in _read(content_copy / "skills.json"))
    prev = content_copy / "versions" / "2025.1.json"
    _write(prev, {"code": "TYT-MAT", "version": "2025.1", "skill_ids": [*ids[:-1], P + "temel.kumeler"]})
    report = _report(lib, content_copy)
    assert report.errors == []
    assert any("kaldırılan kazanım tyt.mat.temel.kumeler" in w for w in report.warnings)
    assert any("eklenen kazanımlar: " + ids[-1] in i for i in report.infos)
    assert any("2025.1 → 2026.1" in i for i in report.infos)


def test_version_diff_with_explicit_previous_skills_file(lib, content_copy, tmp_path):
    skills = _read(content_copy / "skills.json")
    old = tmp_path / "old-skills.json"
    _write(old, [s for s in skills if s["id"] != P + "problem.isci"])
    report = _report(lib, content_copy, previous=old)
    assert any("1 eklenen, 0 kaldırılan" in i for i in report.infos)


def test_ids_cannot_change_within_version(lib, content_copy):
    path = content_copy / "skills.json"
    skills = _read(path)
    skills[-1]["id"] = P + "problem.isci-havuz"
    _write(path, skills)
    tags_path = content_copy / "misconception-tags.json"
    tags = _read(tags_path)
    for t in tags:
        if t["skill_id"] == P + "problem.isci":
            t["skill_id"] = P + "problem.isci-havuz"
    _write(tags_path, tags)
    edges_path = content_copy / "prerequisites.json"
    edges = _read(edges_path)
    for e in edges:
        if e["skill_id"] == P + "problem.isci":
            e["skill_id"] = P + "problem.isci-havuz"
    _write(edges_path, edges)
    cur_path = content_copy / "curriculum.json"
    cur = _read(cur_path)
    cur["diagnostic_exempt"] = [P + "problem.yas", P + "problem.isci-havuz"]
    _write(cur_path, cur)
    errors = _errors(_report(lib, content_copy))
    assert "sürüm 2026.1 içinde kazanım kimlikleri değişti" in errors


def test_period_label_against_settings_seed(lib, content_copy, tmp_path):
    repo = tmp_path / "repo"
    seed_dir = repo / "supabase" / "seed"
    seed_dir.mkdir(parents=True)
    sql = ("insert into public.settings (key, value, description) values ('min_evidence', '5'::jsonb, 'x'), "
           "('default_period', '\"YKS 2028\"'::jsonb, 'dönem') on conflict do nothing;")
    (seed_dir / "01_settings.sql").write_text(sql, encoding="utf-8")
    assert "settings.default_period" in _errors(_report(lib, content_copy, repo_root=repo))
    (seed_dir / "01_settings.sql").write_text(sql.replace("YKS 2028", "YKS 2027"), encoding="utf-8")
    assert _report(lib, content_copy, repo_root=repo).errors == []


def test_validate_cli_fails_on_broken_content(content_copy):
    import subprocess
    import sys

    from conftest import CONTENT_DIR

    path = content_copy / "prerequisites.json"
    edges = _read(path)
    edges.append({"skill_id": P + "temel.sayilar", "prereq_id": P + "problem.kesir", "strength": 0.5})
    _write(path, edges)
    proc = subprocess.run([sys.executable, str(CONTENT_DIR / "scripts" / "validate.py"), "--content", str(content_copy),
                           "--no-templates"], capture_output=True, text=True, timeout=120)
    assert proc.returncode == 1
    assert "döngü" in proc.stdout


def test_exclamation_in_stem_rejected(lib, content_copy):
    items_path = content_copy / "diagnostic" / "items.json"
    items = _read(items_path)
    items[3]["stem"] = items[3]["stem"].replace("kaçtır?", "kaçtır? Hadi bakalım!")
    _write(items_path, items)
    assert "ünlem" in _errors(_report(lib, content_copy))
