"""``analyze`` (§6.3 adım 1–7): isimsiz istem, şema, iddialar (gözlem değil), talk iddiası, iki bütçe."""

from __future__ import annotations

import copy
import json
import shutil
import tempfile

import ogrenmen_contracts as contracts
import pytest
from ogrenmen_common.errors import LedgerError
from ogrenmen_common.pii import name_leaks

from conftest import (
    AYSE,
    DERS,
    LESSON,
    MERT_ENR,
    MERT_OPEN_MISCONCEPTION,
    MERT_REF,
    WAV,
    ScriptedLLM,
    as_admin,
    make_rt,
    mert_transcript,
    needs_ffmpeg,
    read_jsonl,
    run_cli,
)
from ogrenmen_ders import pipeline as P
from ogrenmen_ders.analysis import load_context
from ogrenmen_ders.errors import DersError

pytestmark = needs_ffmpeg
ANALYSIS_FIXTURE = json.loads((DERS / "analysis-01.json").read_text(encoding="utf-8"))
LESSON_LLM_PURPOSES = {"lesson_analysis", "transcribe", "diarize"}


@pytest.fixture
def cli_out(tmp_path):
    """Kabul komutunun aynısı (dry-run, fixtures/ders)."""
    out = tmp_path / "ders-out"
    code = run_cli("analyze", "--lesson", LESSON, "--video", str(WAV), "--dry-run", "--fixtures", str(DERS),
                   "--out", str(out))
    assert code == 0
    return out


def _analyze(tmp_path, video=WAV, lesson=LESSON, rt=None, **kw):
    rt = rt or make_rt(tmp_path / "out")
    result = P.analyze(rt, lesson_id=lesson, video=video, fixtures=DERS, out=tmp_path / "out", **kw)
    return rt, result


def test_no_names_in_api_payload(cli_out):
    source = (DERS / "lesson-01.transcript.json").read_text(encoding="utf-8")
    assert "Elif" in source                                   # ön koşul: ham transkriptte ad geçer
    text = (cli_out / "api_payload.json").read_text(encoding="utf-8")
    assert "Elif" not in text and "Ayşe" not in text
    payload = json.loads(text)
    assert [r["purpose"] for r in payload["requests"]] == ["transcribe", "lesson_analysis"]
    analysis_req = payload["requests"][-1]
    assert "[ÖĞRENCİ], bugün kesirlerde toplamaya bakalım." in analysis_req["prompt"]
    hashes = [r["hash"] for r in json.loads((DERS / "labels.json").read_text(encoding="utf-8"))]
    for req in payload["requests"]:
        assert name_leaks(req["system"] + "\n" + req["prompt"], hashes) == []
        assert all("lesson-01" not in m["name"] for m in req["media"])   # dosya adı sağlayıcıya gitmez
    stored = (cli_out / "storage" / "transcripts" / f"{LESSON}.jsonl").read_text(encoding="utf-8")
    assert "Elif" not in stored


def test_analysis_schema_valid_and_owned_fields(cli_out):
    final = json.loads((cli_out / "lesson_analysis.json").read_text(encoding="utf-8"))
    contracts.validate("lesson-analysis", final)
    (row,) = read_jsonl(cli_out / "lesson_analyses.jsonl")
    contracts.validate("lesson-analysis", row["analysis"])
    assert row["status"] == "draft" and row["version"] == 2 and row["lesson_id"] == LESSON
    assert final["lesson_ref"] == LESSON and final["student_ref"] == "s_qk7m2rx4tn5a"
    calls = read_jsonl(cli_out / "llm_calls.jsonl")
    la = [c for c in calls if c["purpose"] == "lesson_analysis"]
    assert len(la) == 1 and final["model_notes"]["model"] == la[0]["model"] == row["model"]
    assert final["model_notes"]["cost_usd"] == la[0]["cost_usd"] > 0
    assert final["model_notes"]["tokens_in"] == la[0]["tokens_in"] and final["model_notes"]["frames"] == 8
    assert final["model_notes"]["prompt_version"] == "lesson_analysis.v1"
    assert all(c["ref_table"] == "lessons" and c["ref_id"] == LESSON and c["student_ref"] == "s_qk7m2rx4tn5a"
               for c in calls)
    assert row["cost_usd"] == round(sum(c["cost_usd"] for c in calls), 6)
    (lesson,) = read_jsonl(cli_out / "lessons.jsonl")
    assert lesson["status"] == "analyzed" and lesson["frames_count"] == 8
    assert lesson["transcript_path"] == f"transcripts/{LESSON}.jsonl"
    estimate = json.loads((cli_out / "cost_estimate.json").read_text(encoding="utf-8"))
    assert estimate["chat_batch_usd"] == 0 and estimate["lesson_usd"] == row["cost_usd"]


def test_writes_claims_not_observations(tmp_path, cli_out):
    assert not (cli_out / "observations.jsonl").exists()
    claims = read_jsonl(cli_out / "lesson_claims.jsonl")
    assert claims and all(c["status"] == "pending" for c in claims)
    kinds = [c["kind"] for c in claims]
    assert kinds.count("skill_mastery") == len(ANALYSIS_FIXTURE["skills"])
    assert kinds.count("misconception") == len(ANALYSIS_FIXTURE["misconceptions"])
    assert kinds.count("homework") == 1
    rt = make_rt(tmp_path / "out")
    before = len(rt.db.tables["observations"])
    _analyze(tmp_path, rt=rt)
    assert not any(w["table"] == "observations" for w in rt.db.write_log)
    assert len(rt.db.tables["observations"]) == before
    alerts = [a for a in rt.db.tables["instructor_alerts"]
              if a["ref"].get("lesson_id") == LESSON and a["status"] == "open"]
    assert [a["detail"] for a in alerts] == ["Ders raporu onay bekliyor"]


def test_talk_claim_written(cli_out):
    claims = read_jsonl(cli_out / "lesson_claims.jsonl")
    talk = [c for c in claims if c["kind"] == "talk"]
    assert len(talk) == 1
    expected = {k: ANALYSIS_FIXTURE["talk"][k] for k in ("student_ratio", "student_questions", "attention", "morale")}
    assert talk[0]["value"] == expected
    assert talk[0]["speaker"] == "EĞİTMEN" and talk[0]["t_start_sec"] == 0
    assert talk[0]["quote"] == ANALYSIS_FIXTURE["talk"]["notes"]


def test_lesson_cost_is_cap_excluded(tmp_path):
    """v2 ``check_spend``: ders amaçları (``cap_excluded_purposes``) tavana takılmaz; maliyet toplamlara girer."""
    rt = make_rt(tmp_path / "out")
    models = copy.deepcopy(rt.ledger.models)
    analysis_model = rt.ledger.chain("lesson_analysis")[0]
    models["models"][analysis_model]["in_per_m"] = 1000.0     # analiz ≈ 4 $: günlük tavanın (0,80) üstü
    rt.ledger.models = models
    chat_before = rt.db.rpc("check_spend", {"p_purpose": "chat"})[0]
    _, result = _analyze(tmp_path, rt=rt)
    assert result.status == "analyzed" and result.lesson_cost_usd > chat_before["daily_cap"]
    assert set(result.llm_purposes) <= LESSON_LLM_PURPOSES
    assert {r["purpose"] for r in rt.db.written("llm_calls")} <= LESSON_LLM_PURPOSES
    lesson_after = rt.db.rpc("check_spend", {"p_purpose": "lesson_analysis"})[0]
    assert lesson_after["downgrade"] is False and lesson_after["paid_allowed"] is True
    assert lesson_after["day_usd"] == pytest.approx(chat_before["day_usd"] + result.lesson_cost_usd, abs=1e-6)
    # Aynı tutar sohbet amacıyla yazılsaydı yumuşak tavana (soft_cap) girerdi: test ayırt edicidir.
    rt.ledger.record("chat", provider="gemini-paid", model=analysis_model, status="ok",
                     cost_usd=result.lesson_cost_usd)
    assert rt.db.rpc("check_spend", {"p_purpose": "chat"})[0]["state"] == "soft_cap"


def test_paid_llm_disabled_blocks_lesson_analysis(tmp_path):
    """v2'de ders bütçesi ayrı değildir; ücretli çağrıyı kapatan kill-switch (``paid_llm_enabled=false``) engeller."""
    rt = make_rt(tmp_path / "out")
    with as_admin(rt.db):
        rt.db.update("runtime_flags", {"value": False}, where={"key": "paid_llm_enabled"})
    with pytest.raises(LedgerError, match="OGR-LLM-002"):
        _analyze(tmp_path, rt=rt)
    lesson = rt.db.get("lessons", id=LESSON)
    assert lesson["status"] == "failed"
    blocked = [c for c in rt.db.written("llm_calls") if c["purpose"] == "lesson_analysis"]
    assert blocked and all(c["status"] == "cap_blocked" and c["cost_usd"] == 0 for c in blocked)
    alerts = [a for a in rt.db.tables["instructor_alerts"] if a["ref"].get("lesson_id") == LESSON
              and a["detail"].startswith("Ders analizi başarısız")]
    assert len(alerts) == 1 and alerts[0]["kind"] == "ops" and alerts[0]["student_id"] is None
    assert "bütçe" in alerts[0]["detail"]
    assert not rt.db.written("lesson_analyses")


def test_bad_output_repaired_once(tmp_path):
    # Çağrı sırası: 0 transkript, 1 analiz → bad-schema, 2 onarım → geçerli.
    rt = make_rt(tmp_path / "out", bad_output_at=[1])
    _, result = _analyze(tmp_path, rt=rt)
    assert result.status == "analyzed"
    statuses = [c["status"] for c in rt.db.written("llm_calls") if c["purpose"] == "lesson_analysis"]
    assert statuses == ["bad_output", "ok"]


def test_bad_output_after_repair_marks_failed_and_alerts(tmp_path):
    rt = make_rt(tmp_path / "out", bad_output_at=[1, 2, 4, 5])  # iki çalıştırma: 0–2 ve 3–5
    with pytest.raises(LedgerError, match="OGR-LLM-001"):
        _analyze(tmp_path, rt=rt)
    assert rt.db.get("lessons", id=LESSON)["status"] == "failed"
    alerts = [a for a in rt.db.tables["instructor_alerts"] if a["ref"].get("lesson_id") == LESSON
              and a["detail"].startswith("Ders analizi başarısız")]
    assert len(alerts) == 1
    assert not rt.db.written("lesson_analyses") and not rt.db.written("lesson_claims")
    result = json.loads((tmp_path / "out" / "ders_result.json").read_text(encoding="utf-8"))
    assert result["status"] == "failed" and result["error"].startswith("OGR-LLM-001")
    # İkinci başarısız deneme aynı alarmı çoğaltmaz (alerts_dedup).
    with pytest.raises(LedgerError):
        P.analyze(rt, lesson_id=LESSON, video=WAV, fixtures=DERS)
    assert len([a for a in rt.db.tables["instructor_alerts"] if a["ref"].get("lesson_id") == LESSON
                and a["detail"].startswith("Ders analizi başarısız")]) == 1


def _mert_lesson(rt, tmp_path):
    """Mert'in dersi; transkript Mert fixture analizinin alıntılarını aynen içerir (alıntı denetimi)."""
    video = tmp_path / "mert.wav"
    shutil.copy(WAV, video)
    lesson_id = P.register(rt, student_ref=MERT_REF, staff_id=AYSE, held_at="2026-10-20T10:00", duration=60,
                           video=str(video), video_dir=tmp_path)
    rt.ledger.llm = ScriptedLLM({"transcribe": [mert_transcript()]})
    return lesson_id, video


def test_seed_profile_and_followup_for_open_misconception(tmp_path):
    rt = make_rt(tmp_path / "out")
    earlier = "11111111-1111-1111-1111-111111111111"
    rt.db.seed("lessons", {"id": earlier, "enrollment_id": MERT_ENR, "staff_id": AYSE,
                           "held_at": "2026-10-13T10:00:00Z", "duration_min": 60, "video_ref": None,
                           "status": "approved", "created_at": "2026-10-13T12:00:00Z"})
    prev = copy.deepcopy(ANALYSIS_FIXTURE)
    prev["next_step"]["for_instructor"] = "Üslü ifadelerde negatif üsle başlayın."
    rt.db.seed("lesson_analyses", {"id": "22222222-2222-2222-2222-222222222222", "lesson_id": earlier, "version": 1,
                                   "seed_profile": {}, "analysis": prev, "model": "m", "cost_usd": 0,
                                   "status": "approved", "created_at": "2026-10-13T12:00:00Z"})
    # Daha yeni ama onaysız (taslak) analiz isteme girmez; zaman biçimi bilerek '+00:00'.
    draft_lesson = "11111111-1111-1111-1111-111111111112"
    rt.db.seed("lessons", {"id": draft_lesson, "enrollment_id": MERT_ENR, "staff_id": AYSE,
                           "held_at": "2026-10-17T10:00:00+00:00", "duration_min": 60, "video_ref": None,
                           "status": "analyzed", "created_at": "2026-10-17T12:00:00Z"})
    draft = copy.deepcopy(ANALYSIS_FIXTURE)
    draft["next_step"]["for_instructor"] = "Onaylanmamış taslak metni."
    rt.db.seed("lesson_analyses", {"id": "22222222-2222-2222-2222-222222222223", "lesson_id": draft_lesson,
                                   "version": 1, "seed_profile": {}, "analysis": draft, "model": "m", "cost_usd": 0,
                                   "status": "draft", "created_at": "2026-10-17T12:00:00Z"})
    lesson_id, video = _mert_lesson(rt, tmp_path)
    _, result = _analyze(tmp_path, video=video, lesson=lesson_id, rt=rt)
    assert result.status == "analyzed"
    payload = (tmp_path / "out" / "api_payload.json").read_text(encoding="utf-8")
    assert "Mert" not in payload                               # Mert'in adı da hash'le temizlenir
    prompt = json.loads(payload)["requests"][-1]["prompt"]
    assert MERT_OPEN_MISCONCEPTION in prompt and "Üslü ifadelerde negatif üsle başlayın." in prompt
    assert "Onaylanmamış taslak metni." not in prompt
    (row,) = rt.db.written("lesson_analyses")
    seed = row["seed_profile"]
    assert [m["id"] for m in seed["open_misconceptions"]] == [MERT_OPEN_MISCONCEPTION]
    assert seed["previous_next_step"] == "Üslü ifadelerde negatif üsle başlayın."
    assert set(seed["profile"]) == {"weak", "misconceptions", "prereq_hint", "explanation_notes", "weekly_line"}
    assert "%" not in json.dumps(seed["profile"])               # yüzde ve p değeri seed'e girmez
    followups = [c for c in rt.db.written("lesson_claims") if c["kind"] == "followup"]
    assert len(followups) == 1 and followups[0]["misconception_id"] == MERT_OPEN_MISCONCEPTION


def test_followup_for_unknown_misconception_rejected(tmp_path):
    """Seed'de açık olmayan yanılgıya previous_profile_check → onarım, sonra failed."""
    rt = make_rt(tmp_path / "out")
    with as_admin(rt.db):
        rt.db.update("misconceptions", {"status": "resolved"}, where={"id": MERT_OPEN_MISCONCEPTION})
    lesson_id, video = _mert_lesson(rt, tmp_path)
    with pytest.raises(LedgerError, match="OGR-LLM-001"):
        _analyze(tmp_path, video=video, lesson=lesson_id, rt=rt)
    statuses = [c["status"] for c in rt.db.written("llm_calls") if c["purpose"] == "lesson_analysis"]
    assert statuses == ["bad_output", "bad_output"]           # tek onarım
    assert rt.db.get("lessons", id=lesson_id)["status"] == "failed"


def test_domain_validator_rules(tmp_path):
    rt = make_rt(tmp_path / "out")
    ctx = load_context(rt, rt.db.get("lessons", id=LESSON))
    check = ctx.validator(duration_min=90, frames=8)
    assert check(copy.deepcopy(ANALYSIS_FIXTURE)) == []
    bad = copy.deepcopy(ANALYSIS_FIXTURE)
    bad["skills"][0]["skill_id"] = "tyt.mat.temel"             # düğüm kazanım: listede yok (yalnız yapraklar)
    assert any("kazanım listede yok" in e for e in check(bad))
    bad = copy.deepcopy(ANALYSIS_FIXTURE)
    bad["misconceptions"][0]["tag"] = "rasyonel.uydurma-etiket"
    assert any("etiket katalogda yok" in e for e in check(bad))
    bad = copy.deepcopy(ANALYSIS_FIXTURE)
    bad["skills"][0]["evidence"] = []
    assert check(bad)                                          # kanıtsız kazanım şemadan düşer
    other = copy.deepcopy(ANALYSIS_FIXTURE)
    other["lesson_ref"] = "fdf713bd-4a69-5887-99ed-1547cc0aac53"
    other["model_notes"] = {"model": "x", "prompt_version": "y", "cost_usd": 99, "tokens_in": 1, "tokens_out": 1}
    final = ctx.finalize(other, duration_min=90, frames=8, model="m", cost_usd=0.2, tokens_in=10, tokens_out=5)
    assert final["lesson_ref"] == LESSON and final["model_notes"]["cost_usd"] == 0.2


def test_scrub_applies_to_seed_profile_text(tmp_path):
    rt = make_rt(tmp_path / "out")
    with as_admin(rt.db):
        rt.db.insert("misconceptions", {
            "id": "33333333-3333-3333-3333-333333333333", "enrollment_id": "8bef16e2-1fb1-56d1-9530-3cd5b1ea7cf3",
            "curriculum_id": "7a988b84-8937-5242-8c35-ddbc4ea9216d", "skill_id": "tyt.mat.temel.rasyonel-sayilar",
            "tag": None, "text_instructor": "Elif paydaları eşitlemeden topluyor.",
            "text_student": "Önce paydaları eşitle.", "status": "open", "evidence_count": 3,
            "first_seen": "2026-10-15T15:03:00Z", "last_seen": "2026-10-16T16:04:00Z"})
    ctx = load_context(rt, rt.db.get("lessons", id=LESSON))
    assert ctx.open_misconceptions[0]["text_instructor"].startswith("Elif")
    _, result = _analyze(tmp_path, rt=rt)                      # kapsama zorunlu değil: denetlenmeyen yanılgı hata değil
    assert result.status == "analyzed"
    payload = (tmp_path / "out" / "api_payload.json").read_text(encoding="utf-8")
    assert "Elif" not in payload and "[ÖĞRENCİ] paydaları eşitlemeden topluyor." in payload


def test_missing_lesson_and_video(tmp_path):
    rt = make_rt(tmp_path / "out")
    with pytest.raises(DersError, match="OGR-DERS-002"):
        P.analyze(rt, lesson_id="99999999-9999-9999-9999-999999999999", video=WAV)
    with pytest.raises(DersError, match="OGR-DERS-001"):
        P.analyze(rt, lesson_id=LESSON, video=tmp_path / "yok.mp4")
    assert rt.db.get("lessons", id=LESSON)["status"] == "analyzed"   # hiçbir şey başlamadan reddedildi


def test_analyze_with_scene_video(tmp_path, scene_video, monkeypatch):
    monkeypatch.setattr(tempfile, "tempdir", str(tmp_path))
    rt, result = _analyze(tmp_path, video=scene_video)
    assert result.status == "analyzed" and result.frame_method == "scene>0.30"
    assert 20 <= result.frames <= 40
    payload = json.loads((tmp_path / "out" / "api_payload.json").read_text(encoding="utf-8"))
    media = payload["requests"][-1]["media"]
    assert len(media) == result.frames and all(m["mime"] == "image/jpeg" for m in media)
    assert rt.db.get("lessons", id=LESSON)["frames_count"] == result.frames
    assert not list(tmp_path.glob("ogrenmen-ders-*"))           # çalışma dizini (ses dahil) silindi


def test_audio_work_dir_removed(tmp_path, monkeypatch):
    monkeypatch.setattr(tempfile, "tempdir", str(tmp_path))
    _analyze(tmp_path)
    assert not list(tmp_path.glob("ogrenmen-ders-*"))           # adım 7: ses dosyası silinir
