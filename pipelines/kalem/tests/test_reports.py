"""Çeldirici motoru raporları (§6.4 (a)): ``distractor-report`` ve ``prerequisite-audit``."""

from __future__ import annotations

import json

import pytest
from ogrenmen_common.clock import FixedClock
from ogrenmen_common.fakes import JsonlDb

from conftest import CURRICULUM, FIXTURES, run_cli
from ogrenmen_kalem import reports as RP
from ogrenmen_kalem.common import KalemError

OTHER_CURR = "11111111-1111-5111-8111-111111111111"


def _opts(tags):
    return [{"key": k, "text": k, "misconception_tag": t} for k, t in zip("ABCD", tags, strict=True)]


def _distractor_db() -> JsonlDb:
    return JsonlDb({
        "curricula": [{"id": CURRICULUM, "code": "TYT-MAT"}, {"id": OTHER_CURR, "code": "AYT-MAT"}],
        "misconception_tags": [{"tag": "a.t1", "text_instructor": "Paydaları toplar."},
                               {"tag": "a.t2", "text_instructor": "İşareti unutur."}],
        "questions": [
            {"id": "q1", "status": "approved", "curriculum_id": CURRICULUM, "skill_ids": ["s.a"],
             "options": _opts([None, "a.t1", "a.t2", None])},
            {"id": "q2", "status": "approved", "curriculum_id": CURRICULUM, "skill_ids": ["s.b"],
             "options": _opts([None, None, "a.t1", None])},                       # denenmemiş → sayılmaz
            {"id": "q3", "status": "draft", "curriculum_id": CURRICULUM, "skill_ids": ["s.a"],
             "options": _opts([None, "a.t2", None, None])},                       # onaysız → sayılmaz
            {"id": "q4", "status": "approved", "curriculum_id": OTHER_CURR, "skill_ids": ["s.c"],
             "options": _opts([None, "a.t2", None, None])},                       # başka müfredat
        ],
        "attempts": [
            {"id": 1, "question_id": "q1", "chosen": {"key": "B"}},
            {"id": 2, "question_id": "q1", "chosen": {"key": "B"}},
            {"id": 3, "question_id": "q1", "chosen": {"key": "A"}},
            {"id": 4, "question_id": "q3", "chosen": {"key": "B"}},
            {"id": 5, "question_id": "q4", "chosen": {"key": "A"}},
        ],
    }, clock=FixedClock())


def test_distractor_report_rates_and_unused():
    rep = RP.distractor_report(_distractor_db(), curriculum="TYT-MAT")
    assert (rep["approved_questions"], rep["attempted_questions"], rep["n"], rep["unused"]) == (2, 1, 2, 1)
    assert rep["value"] == 0.5
    assert rep["by_tag"]["a.t1"] == {"offered": 3, "chosen": 2, "questions": 1, "rate": 0.6667,
                                     "text_instructor": "Paydaları toplar."}
    assert rep["by_tag"]["a.t2"]["chosen"] == 0 and rep["never_chosen_tags"] == ["a.t2"]
    assert rep["rewrite_candidates"] == [{"question_id": "q1", "key": "C", "tag": "a.t2", "skill_id": "s.a"}]


def test_distractor_report_all_curricula_and_unknown_code():
    rep = RP.distractor_report(_distractor_db())
    assert rep["attempted_questions"] == 2 and rep["n"] == 3 and rep["unused"] == 2
    with pytest.raises(KalemError, match="OGR-KALEM-009"):
        RP.distractor_report(_distractor_db(), curriculum="YOK")


def test_distractor_report_cli_on_dev_seed(tmp_path):
    out = tmp_path / "out"
    assert run_cli("distractor-report", "--curriculum", "TYT-MAT", "--dry-run", "--out", str(out)) == 0
    rep = json.loads((out / "distractor_report.json").read_text())
    assert rep["attempted_questions"] > 0 and rep["n"] >= rep["unused"] >= 0
    md = (out / "distractor_report.md").read_text()
    assert md.startswith("# Çeldirici raporu") and "!" not in md
    seed = json.loads((FIXTURES / "db" / "dev-seed.json").read_text(encoding="utf-8"))
    people = {r["id"] for t in ("students", "enrollments", "staff") for r in seed[t]}
    text = json.dumps(rep) + md
    assert [p for p in people if p in text] == []


def _obs(oid, enrollment, skill, kind, value, at, curriculum=CURRICULUM):
    return {"id": oid, "enrollment_id": enrollment, "curriculum_id": curriculum, "skill_id": skill, "kind": kind,
            "value": value, "source_type": "observation" if kind == "inferred" else "attempt",
            "source_id": "1", "created_at": at}


def _audit_db() -> JsonlDb:
    e1, e2 = "e-1", "e-2"
    return JsonlDb({
        "curricula": [{"id": CURRICULUM, "code": "TYT-MAT"}, {"id": OTHER_CURR, "code": "AYT-MAT"}],
        "skills": [{"curriculum_id": CURRICULUM, "id": "s.on", "name": "Ön koşul"},
                   {"curriculum_id": CURRICULUM, "id": "s.iki", "name": "İkinci"}],
        "observations": [
            _obs(1, e1, "s.on", "practice", 1, "2026-10-01T09:00:00Z"),          # önceki ölçüm sayılmaz
            _obs(2, e1, "s.on", "inferred", 0, "2026-10-02T09:00:00Z"),
            _obs(3, e1, "s.on", "practice", 0, "2026-10-03T09:00:00Z"),          # yanlış → örtüşür
            _obs(4, e1, "s.on", "practice", 1, "2026-10-04T09:00:00Z"),          # ilk ölçüm değil
            _obs(5, e2, "s.on", "inferred", 0, "2026-10-02T10:00:00Z"),
            _obs(6, e2, "s.on", "chat_question", None, "2026-10-03T10:00:00Z"),  # doğrudan ölçüm değil
            _obs(7, e2, "s.on", "test", 1, "2026-10-04T10:00:00Z"),              # doğru → örtüşmez
            _obs(8, e1, "s.iki", "inferred", 0, "2026-10-02T11:00:00Z"),
            _obs(9, e1, "s.iki", "diagnostic", 0, "2026-10-30T11:00:00Z"),       # pencere dışı
            _obs(10, e1, "s.x", "inferred", 0, "2026-10-02T11:00:00Z", curriculum=OTHER_CURR),
        ],
        "mastery_history": [
            {"id": 1, "enrollment_id": e1, "skill_id": "s.on", "observation_id": 2, "p_before": 0.5, "p_after": 0.3,
             "method": "inferred"},
            {"id": 2, "enrollment_id": e2, "skill_id": "s.on", "observation_id": 5, "p_before": 0.6, "p_after": 0.5,
             "method": "inferred"},
        ],
    }, clock=FixedClock())


def test_prerequisite_audit_agreement():
    rep = RP.prerequisite_audit(_audit_db(), curriculum="TYT-MAT", window_days=14)
    assert (rep["n_inferred"], rep["n_dropped"], rep["n_measured"], rep["n_agreed"], rep["value"]) == (3, 2, 2, 1, 0.5)
    by = {s["skill_id"]: s for s in rep["by_skill"]}
    assert by["s.on"] == {"skill_id": "s.on", "name": "Ön koşul", "inferred": 2, "dropped": 2, "avg_drop": 0.15,
                          "measured": 2, "agreed": 1, "agreement": 0.5}
    assert by["s.iki"]["measured"] == 0 and by["s.iki"]["agreement"] is None
    wide = RP.prerequisite_audit(_audit_db(), curriculum="TYT-MAT", window_days=60)
    assert wide["n_measured"] == 3 and wide["n_agreed"] == 2


def test_prerequisite_audit_since_and_all():
    assert RP.prerequisite_audit(_audit_db())["n_inferred"] == 4
    later = RP.prerequisite_audit(_audit_db(), since="2026-10-02T10:30:00Z")
    assert later["n_inferred"] == 2


def test_prerequisite_audit_cli_on_dev_seed(tmp_path):
    out = tmp_path / "out"
    assert run_cli("prerequisite-audit", "--curriculum", "TYT-MAT", "--dry-run", "--out", str(out)) == 0
    rep = json.loads((out / "prerequisite_audit.json").read_text())
    assert rep["n_inferred"] == 3 and rep["n_dropped"] == 3
    text = json.dumps(rep) + (out / "prerequisite_audit.md").read_text()
    assert "1899cde6" not in text  # kayıt kimliği rapora girmez


def _shared_rule_db() -> JsonlDb:
    """Tek müfredat; q1'de bir deneme şıksız (``chosen`` boş) — M07 ile aynı sayım kuralını sınar."""
    return JsonlDb({
        "curricula": [{"id": CURRICULUM, "code": "TYT-MAT"}],
        "misconception_tags": [{"tag": "a.t1", "text_instructor": "Paydaları toplar."},
                               {"tag": "a.t2", "text_instructor": "İşareti unutur."}],
        "questions": [
            {"id": "q1", "status": "approved", "curriculum_id": CURRICULUM, "skill_ids": ["s.a"],
             "options": _opts([None, "a.t1", "a.t2", None])},
            {"id": "q2", "status": "approved", "curriculum_id": CURRICULUM, "skill_ids": ["s.b"],
             "options": _opts([None, None, "a.t1", None])},
        ],
        "attempts": [
            {"id": 1, "question_id": "q1", "chosen": {"key": "B"}},
            {"id": 2, "question_id": "q1", "chosen": {"key": "A"}},
            {"id": 3, "question_id": "q1", "chosen": None},          # şıksız deneme: sunulma sayılır
            {"id": 4, "question_id": "q2", "chosen": {}},            # yalnız şıksız deneme: soru denenmiş sayılır
        ],
    }, clock=FixedClock())


# M07 (pipelines/kulaklik_batch pilot.distractor_report) ile aynı fixture'da beklenen sayılar (elle kopyalandı).
SHARED_EXPECTED = {"n": 3, "unused": 2, "value": 0.6667,
                   "by_tag": {"a.t1": {"offered": 4, "chosen": 1, "rate": 0.25},
                              "a.t2": {"offered": 3, "chosen": 0, "rate": 0.0}}}


def _core(rep):
    return {"n": rep["n"], "unused": rep["unused"], "value": rep["value"],
            "by_tag": {t: {k: v[k] for k in ("offered", "chosen", "rate")} for t, v in rep["by_tag"].items()}}


def test_distractor_report_counts_unchosen_attempts_like_m07():
    rep = RP.distractor_report(_shared_rule_db(), curriculum="TYT-MAT")
    assert _core(rep) == SHARED_EXPECTED
    assert rep["attempted_questions"] == 2


def test_distractor_report_matches_m07_implementation():
    pilot = pytest.importorskip("ogrenmen_kulaklik.pilot")
    ours = _core(RP.distractor_report(_shared_rule_db(), curriculum="TYT-MAT"))
    theirs = _core(pilot.distractor_report(_shared_rule_db()))
    assert ours == theirs == SHARED_EXPECTED
