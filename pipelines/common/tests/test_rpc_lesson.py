"""Ders RPC eşlenikleri (legacy-v1): resolve_lesson_labels, profile_for_prompt, confirm_video_deleted (§3.9
"Pipelines"). register_lesson ve write_lesson_analysis P5'te v2'de doğdu (0040); v1 eşlenikleri kaldırıldı."""

from __future__ import annotations

from conftest import seed_json

LESSON = "00000000-0000-0000-0000-000000000001"
AYSE = "de70e65e-1410-5026-a773-c5e55a3e6368"
MERT_ENR = "1899cde6-c497-5b14-8051-882f44649013"


def test_resolve_lesson_labels_match_fixture_and_hide_names(db):
    labels = db.rpc("resolve_lesson_labels", {"p_lesson": LESSON})
    expected = seed_json("ders/labels.json")
    assert sorted((r["hash"], r["label"]) for r in labels) == sorted((r["hash"], r["label"]) for r in expected)
    assert "Elif" not in str(labels) and "Ayşe" not in str(labels)
    assert any(e["action"] == "RPC:resolve_lesson_labels" for e in db.tables["audit.events"])


def test_resolve_lesson_labels_only_student_and_instructor(db):
    """§3.9 ``table(hash, label)`` yalnız 'ÖĞRENCİ'/'EĞİTMEN' döner; veli tokenları (name_token_hashes'te)
    'ÖĞRENCİ' etiketiyle gelir, ayrı 'VELİ' etiketi yoktur (SQL ile aynı)."""
    from ogrenmen_pii import normalize_token, sha256_hex

    lesson = db._one("lessons", id=LESSON)
    student = db._one("enrollments", id=lesson["enrollment_id"])["student_id"]
    pii = db._one("secure.student_pii", student_id=student)
    extra = sha256_hex(normalize_token("Hatice"))
    only_guardian = sha256_hex(normalize_token("Nermin"))
    db._update_internal("secure.student_pii", pii, {
        "guardian_name": "Nermin Hatice", "name_token_hashes": list(pii.get("name_token_hashes") or []) + [extra]})
    labels = db.rpc("resolve_lesson_labels", {"p_lesson": LESSON})
    assert {r["label"] for r in labels} == {"ÖĞRENCİ", "EĞİTMEN"}
    by_hash = {r["hash"]: r["label"] for r in labels}
    assert by_hash[extra] == "ÖĞRENCİ" and only_guardian not in by_hash


def test_profile_for_prompt_has_bands_not_percentages(db):
    prof = db.rpc("profile_for_prompt", {"p_enrollment": MERT_ENR})
    assert set(prof) == {"weak", "misconceptions", "prereq_hint", "explanation_notes", "weekly_line"}
    assert all(set(w) == {"skill_id", "name", "band"} for w in prof["weak"])
    assert all(w["band"] in ("düşük", "orta", "yüksek") for w in prof["weak"])
    min_ev = 5
    reliable = [m for m in db.tables["mastery"] if m["enrollment_id"] == MERT_ENR and m["evidence_count"] >= min_ev]
    assert len(prof["weak"]) == min(3, len(reliable))
    assert "Paylar ve paydalar ayrı ayrı toplanmaz; önce paydaları eşitleyelim." in prof["misconceptions"]
    assert prof["weekly_line"].startswith("Öğrenci bu hafta")
    assert "%" not in str(prof) and all("p" not in w for w in prof["weak"])
    assert db.rpc("profile_for_prompt", {"p_enrollment": "yok"}) is None


def test_prereq_hint_rule(db):
    from ogrenmen_common.fakes.jsonl_rpc import infer_prereq_gap

    sp = next(s for s in db.tables["skill_prerequisites"])
    db.tables["mastery"] = [m for m in db.tables["mastery"] if m["enrollment_id"] != MERT_ENR]
    base = {"enrollment_id": MERT_ENR, "curriculum_id": sp["curriculum_id"], "last_observation_id": None,
            "last_evidence_at": None, "updated_at": None}
    db.tables["mastery"] += [{**base, "skill_id": sp["skill_id"], "p": 0.3, "evidence_count": 6},
                             {**base, "skill_id": sp["prereq_id"], "p": 0.3, "evidence_count": 6}]
    name = next(s["name"] for s in db.tables["skills"] if s["id"] == sp["prereq_id"])
    assert infer_prereq_gap(db, MERT_ENR, sp["skill_id"]) == f"Asıl sorun alt konuda olabilir: {name}"
    db.tables["mastery"][-1]["evidence_count"] = 4  # ön koşul güvenilir değil → ipucu yok
    assert infer_prereq_gap(db, MERT_ENR, sp["skill_id"]) is None


def test_confirm_video_deleted_queues_two_notices_once(db):
    db.rpc("confirm_video_deleted", {"p_lesson": LESSON})
    assert db.get("lessons", id=LESSON)["video_deleted_at"] == "2026-10-20T09:00:00Z"
    rows = [p for p in db.tables["proactive_messages"] if p["template_id"] == "video_deleted"]
    assert sorted(r["recipient"] for r in rows) == ["guardian", "student"]
    assert all("chat_id" not in r and "telegram_message_id" not in r for r in rows)
    db.rpc("confirm_video_deleted", {"p_lesson": LESSON})
    assert len([p for p in db.tables["proactive_messages"] if p["template_id"] == "video_deleted"]) == 2
