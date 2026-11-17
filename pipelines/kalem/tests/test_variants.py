"""``kalem variants`` (§6.4): yalnız onaylı plan, yalnız meta, tür eşlemesi, Tablet içe alınmaz."""

from __future__ import annotations

import copy
import json
import subprocess
import sys

import ogrenmen_contracts as contracts
import pytest

from conftest import APPROVED_PLAN, CURRICULUM, INSTRUCTOR, fixture_ocr_texts, make_rt, read_jsonl, substrings_12
from ogrenmen_kalem import variants as VA
from ogrenmen_kalem.common import KalemError

KIND_PLAN_ID = "5c1f0d8e-2a8b-4c3e-9f41-6d0b7e2a1c11"


def _seed_kind_plan(rt) -> None:
    """Dört türün her biri bir satır: çoktan seçmeli, hesap, diğer, ispat (+ kazanımsız bir satır)."""
    base = next(p for p in rt.db.select("exam_priority_plans") if p["id"] == APPROVED_PLAN)
    plan = copy.deepcopy(base["plan"])
    proto = plan["rows"][0]
    specs = [("çoktan seçmeli", "tyt.mat.problem.yuzde"), ("hesap", "tyt.mat.temel.rasyonel-sayilar"),
             ("diğer", "tyt.mat.cebir.oran-oranti"), ("ispat", None), ("hesap", None)]
    plan["rows"] = [{**proto, "rank": i + 1, "topic": f"Konu {i + 1}", "kind": kind, "skill_id": skill}
                    for i, (kind, skill) in enumerate(specs)]
    contracts.validate("exam-priority-plan", plan)
    rt.db.seed("exam_priority_plans", {**base, "id": KIND_PLAN_ID, "plan": plan, "status": "approved"})


def test_variants_kind_mapping(tmp_path):
    out = tmp_path / "out"
    rt = make_rt(out, fixtures=None)
    _seed_kind_plan(rt)
    rep = VA.variants_for_plan(rt, KIND_PLAN_ID, top=5)
    rt.close()
    rows = read_jsonl(out / "generation_requests.jsonl")
    assert [(r["topic"], r["question_kind"]) for r in rows] == [("Konu 1", "mcq"), ("Konu 2", "numeric"),
                                                                ("Konu 3", "mcq")]
    assert rep["written"] == 3 and rep["skipped"] == {"proof": 1, "no_skill": 1, "exists": 0}
    report = json.loads((out / "variants_report.json").read_text())
    assert report["skipped"]["proof"] == 1
    assert [d["result"] for d in report["rows"]] == ["written", "written", "written", "skipped: proof",
                                                     "skipped: no_skill"]


def test_variants_write_requests_only_meta(tmp_path):
    out = tmp_path / "out"
    code = (
        "import sys\n"
        "from ogrenmen_kalem import cli\n"
        f"rc = cli.main(['variants', '--plan', '{APPROVED_PLAN}', '--top', '5', '--dry-run', '--out', {str(out)!r}])\n"
        "assert rc == 0, rc\n"
        "assert not [m for m in sys.modules if m.split('.')[0] == 'ogrenmen_tablet'], 'ogrenmen_tablet içe alındı'\n"
    )
    proc = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True, timeout=120)
    assert proc.returncode == 0, proc.stderr
    rows = read_jsonl(out / "generation_requests.jsonl")
    assert len(rows) == 5
    for r in rows:
        contracts.validate("generation-request", r)
        assert r["kind"] == "exam_variant" and r["plan_id"] == APPROVED_PLAN
        assert r["needs_generation"] is True and r["difficulty_band"] == "mid"
        assert r["requested_by_staff"] == INSTRUCTOR and r["curriculum_id"] == CURRICULUM
        assert r["question_kind"] == "mcq" and r["points"] == 4.0
        assert "ocr_text" not in r and "stem" not in r
    text = json.dumps(rows, ensure_ascii=False)
    assert [s for s in substrings_12(fixture_ocr_texts()) if s in text] == []


def test_variants_rerun_does_not_duplicate(tmp_path):
    rt = make_rt(None, fixtures=None)
    first = VA.variants_for_plan(rt, APPROVED_PLAN, top=3)
    second = VA.variants_for_plan(rt, APPROVED_PLAN, top=3)
    rt.close()
    assert first["written"] == 3 and second["written"] == 0 and second["skipped"]["exists"] == 3


@pytest.mark.parametrize("plan_id,match", [("ab597b24-b321-5e04-a9d0-427462630c9e", "onaylı"),
                                           ("e0cc9cfb-fffd-5244-8eaf-45e360ce3381", "onaylı"),
                                           ("00000000-0000-4000-8000-000000000000", "plan yok")])
def test_variants_require_approved_plan(plan_id, match):
    rt = make_rt(None, fixtures=None)
    with pytest.raises(KalemError, match=match):
        VA.variants_for_plan(rt, plan_id)
    rt.close()


def test_variants_source_never_imports_tablet():
    from pathlib import Path

    src = Path(VA.__file__).parent
    for path in src.glob("*.py"):
        assert "ogrenmen_tablet" not in path.read_text(encoding="utf-8"), path.name
