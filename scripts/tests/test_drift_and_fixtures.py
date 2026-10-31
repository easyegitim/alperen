"""check-drift.py (BKT/PII kopyaları) ve check-fixtures.py (fixtures-valid) testleri."""

from __future__ import annotations

import json
import shutil
import uuid
from pathlib import Path

import pytest
from conftest import REPO, write

BKT = "-- bkt kaynağı\ncreate function app.bkt_step(p numeric) returns numeric language sql as $$ select p $$;\n"
PII_SRC = (
    "-- açıklama: bu satırlar kopyalanmaz\n-- begin pii\ncreate function app.pii_hash(t text) returns text\n"
    "  language sql as $$ select t $$;\n-- end pii\n"
)


def drift_world(root: Path, *, bkt_copy: str = BKT, pii_block: str | None = None) -> Path:
    write(root / "packages/mastery-math/sql/bkt.sql", BKT)
    write(root / "packages/pii/sql/name_token_hashes.sql", PII_SRC)
    block = pii_block if pii_block is not None else PII_SRC.split("\n", 1)[1]
    write(root / "supabase/migrations/0003_identity.sql", "create table x (a int);\n" + block + "select 1;\n")
    write(root / "supabase/migrations/0011_mastery.sql",
          "-- üst bilgi\n-- begin bkt\n" + bkt_copy + "-- end bkt\ncreate function app.after() returns int "
          "language sql as $$ select 1 $$;\n")
    return root


def test_drift_identical_copies_pass(drift, tmp_path, capsys):
    assert drift.main(["--root", str(drift_world(tmp_path))]) == 0
    out = capsys.readouterr().out
    assert "PASS bkt" in out and "PASS pii" in out


def test_drift_detects_changed_bkt_line(drift, tmp_path, capsys):
    root = drift_world(tmp_path, bkt_copy=BKT.replace("select p", "select p + 0"))
    assert drift.main(["--root", str(root)]) == 1
    out = capsys.readouterr().out
    assert "FAIL bkt" in out and "+create function app.bkt_step" in out and "PASS pii" in out


def test_drift_detects_changed_pii_block(drift, tmp_path, capsys):
    block = ("-- begin pii\ncreate function app.pii_hash(t text) returns text\n"
             "  language sql as $$ select lower(t) $$;\n-- end pii\n")
    assert drift.main(["--root", str(drift_world(tmp_path, pii_block=block))]) == 1
    assert "FAIL pii" in capsys.readouterr().out


def test_drift_missing_or_duplicate_markers(drift, tmp_path, capsys):
    root = drift_world(tmp_path)
    (root / "supabase/migrations/0011_mastery.sql").write_text("create table y (b int);\n", encoding="utf-8")
    write(root / "supabase/migrations/0012_other.sql", PII_SRC.split("\n", 1)[1])
    assert drift.main(["--root", str(root)]) == 1
    out = capsys.readouterr().out
    assert "bloğu yok" in out and "birden çok migration" in out


def test_drift_marker_must_be_whole_line(drift, tmp_path, capsys):
    root = drift_world(tmp_path)
    mig = root / "supabase/migrations/0011_mastery.sql"
    mig.write_text(mig.read_text(encoding="utf-8").replace("-- end bkt\n", "-- end bkt sonrası\n"), encoding="utf-8")
    assert drift.main(["--root", str(root)]) == 1
    assert "FAIL bkt" in capsys.readouterr().out


def test_drift_real_repository_passes(drift):
    assert drift.main(["--root", str(REPO)]) == 0


# ------------------------------------------------------------------------------------------------ fixtures-valid


@pytest.fixture
def fx_world(tmp_path: Path) -> Path:
    """Gerçek fixtures/llm + dev-seed + içerik kopyası (testler kopyayı bozar, asıl dosyalara dokunulmaz)."""
    shutil.copytree(REPO / "fixtures", tmp_path / "fixtures")
    shutil.copytree(REPO / "content/tyt-matematik/diagnostic", tmp_path / "content/tyt-matematik/diagnostic")
    shutil.copy(REPO / "content/tyt-matematik/curriculum.json", tmp_path / "content/tyt-matematik/curriculum.json")
    return tmp_path


def run_fx(mod, root: Path, capsys) -> tuple[int, str]:
    rc = mod.main(["--root", str(root)])
    return rc, capsys.readouterr().out


def test_fixtures_real_repository_passes(fixtures_check, capsys):
    rc, out = run_fx(fixtures_check, REPO, capsys)
    assert rc == 0, out
    assert "0 FAIL" in out


def test_fixtures_bad_schema_that_validates_fails(fixtures_check, fx_world, capsys):
    llm = fx_world / "fixtures/llm/chat"
    shutil.copy(llm / "01-socratic-paydalar.json", llm / "bad-schema-2.json")
    rc, out = run_fx(fixtures_check, fx_world, capsys)
    assert rc == 1
    assert "bad-schema-2.json: tutor-reply şemasından GEÇİYOR" in out


def test_fixtures_invalid_example_fails(fixtures_check, fx_world, capsys):
    path = fx_world / "fixtures/llm/research/01-spaced-repetition.json"
    data = json.loads(path.read_text(encoding="utf-8"))
    data["beklenmeyen_alan"] = 1
    path.write_text(json.dumps(data), encoding="utf-8")
    rc, out = run_fx(fixtures_check, fx_world, capsys)
    assert rc == 1 and "01-spaced-repetition.json: research-output şemasına uymuyor" in out


def test_fixtures_ocr_requires_array(fixtures_check, fx_world, capsys):
    path = fx_world / "fixtures/llm/ocr/01-exam-2022.json"
    item = json.loads(path.read_text(encoding="utf-8"))[0]
    path.write_text(json.dumps(item), encoding="utf-8")  # dizi değil, tek nesne
    rc, out = run_fx(fixtures_check, fx_world, capsys)
    assert rc == 1 and "exam-item dizisi bekleniyordu" in out


def test_fixtures_unknown_and_missing_folders_fail(fixtures_check, fx_world, capsys):
    shutil.rmtree(fx_world / "fixtures/llm/diarize")
    write(fx_world / "fixtures/llm/yeni_amac/01.json", "{}")
    rc, out = run_fx(fixtures_check, fx_world, capsys)
    assert rc == 1
    assert "fixtures/llm/yeni_amac: bilinmeyen amaç klasörü" in out
    assert "fixtures/llm/diarize: amaç klasörü yok" in out


def test_fixtures_folder_without_bad_schema_fails(fixtures_check, fx_world, capsys):
    (fx_world / "fixtures/llm/query_expand/bad-schema.json").unlink()
    rc, out = run_fx(fixtures_check, fx_world, capsys)
    assert rc == 1 and "query_expand: bad-schema*.json yok" in out


def test_fixtures_broken_json_fails(fixtures_check, fx_world, capsys):
    write(fx_world / "fixtures/kitap/bozuk.json", "{ bozuk")
    rc, out = run_fx(fixtures_check, fx_world, capsys)
    assert rc == 1 and "bozuk.json: JSON okunamadı" in out


def test_dev_seed_needs_one_active_curriculum_and_period(fixtures_check, fx_world, capsys):
    path = fx_world / "fixtures/db/dev-seed.json"
    seed = json.loads(path.read_text(encoding="utf-8"))
    seed["curricula"].append(dict(seed["curricula"][0], id=str(uuid.uuid4()), version="2027.1"))
    seed["settings"] = [s for s in seed["settings"] if s["key"] != "default_period"]
    path.write_text(json.dumps(seed), encoding="utf-8")
    rc, out = run_fx(fixtures_check, fx_world, capsys)
    assert rc == 1
    assert "TYT-MAT için 2 aktif müfredat" in out and "default_period yok" in out


def _aligned_seed(mod, root: Path) -> dict:
    """dev-seed.json'ın teşhis sorularını ve testini items.json'dan yeniden kurar (M01'in düzeltilmiş hâli)."""
    items = json.loads((root / "content/tyt-matematik/diagnostic/items.json").read_text(encoding="utf-8"))
    cur = json.loads((root / "content/tyt-matematik/curriculum.json").read_text(encoding="utf-8"))
    code = f"{cur['code']}@{cur['version']}"
    seed = json.loads((root / "fixtures/db/dev-seed.json").read_text(encoding="utf-8"))
    others = [q for q in seed["questions"] if q.get("source") != "diagnostic"]
    diag = []
    for it in items:
        diag.append({"id": mod.uid("question", it["code"]), "source": "diagnostic", "skill_ids": it["skill_ids"],
                     "kind": it["kind"], "stem": it["stem"], "stem_values": it.get("stem_values") or {},
                     "options": it["options"], "difficulty": it["difficulty"],
                     "figure_id": "f" if it.get("figure") else None})
    seed["questions"] = others + diag
    seed["diagnostic_tests"] = [{"id": mod.uid("diagnostic_test", code), "curriculum_id": mod.curriculum_uuid(code),
                                 "version": cur["version"], "item_ids": [q["id"] for q in diag]}]
    return seed


def test_diagnostic_drift_empty_when_aligned(fixtures_check, fx_world):
    seed = _aligned_seed(fixtures_check, fx_world)
    assert fixtures_check.diagnostic_drift(fx_world, seed) == []


def test_diagnostic_drift_lists_differences_without_failing(fixtures_check, fx_world, capsys):
    seed = _aligned_seed(fixtures_check, fx_world)
    seed["questions"][-1]["stem"] = "değiştirilmiş kök"
    seed["diagnostic_tests"][0]["item_ids"] = list(reversed(seed["diagnostic_tests"][0]["item_ids"]))
    drift = fixtures_check.diagnostic_drift(fx_world, seed)
    assert any("DIAG-2026.1-20: farklı alanlar stem" in d for d in drift)
    assert any("item_ids" in d for d in drift)
    (fx_world / "fixtures/db/dev-seed.json").write_text(json.dumps(seed), encoding="utf-8")
    rc, out = run_fx(fixtures_check, fx_world, capsys)
    assert rc == 0 and "UYARI dev-seed.json teşhis maddeleri" in out


@pytest.mark.parametrize("target, mutate, needle", [
    ("content/tyt-matematik/diagnostic/items.json",
     lambda d: [{k: v for k, v in it.items() if k != "code"}
                for it in (d.get("items", d) if isinstance(d, dict) else d)],
     "zorunlu alan yok ('code')"),
    ("content/tyt-matematik/curriculum.json", lambda d: {k: v for k, v in d.items() if k != "version"},
     "zorunlu alan yok ('version')"),
    ("content/tyt-matematik/diagnostic/items.json", lambda d: 42, "bozuk girdi (TypeError"),
])
def test_diagnostic_drift_malformed_input_is_reported_not_crashed(fixtures_check, fx_world, capsys,
                                                                  target, mutate, needle):
    path = fx_world / target
    path.write_text(json.dumps(mutate(json.loads(path.read_text(encoding="utf-8")))), encoding="utf-8")
    rc, out = run_fx(fixtures_check, fx_world, capsys)
    assert rc == 1
    assert "FAIL  teşhis eşitliği denetlenemedi" in out and needle in out
    assert "Traceback" not in out


def test_diagnostic_drift_invalid_json_is_reported(fixtures_check, fx_world, capsys):
    (fx_world / "content/tyt-matematik/curriculum.json").write_text("{bozuk", encoding="utf-8")
    rc, out = run_fx(fixtures_check, fx_world, capsys)
    assert rc == 1 and "bozuk girdi (JSONDecodeError" in out
