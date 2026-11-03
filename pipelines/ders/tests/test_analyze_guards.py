"""``analyze`` kemerleri: kapalı başarısızlık (ad hash'i yok), zaman aşımı, beklenmeyen hata, durum koruması,
yasak kelime / uydurma alıntı / ad içeren çıktı onarımı, onarım isteminin kaydı, eski alarmın kapanması."""

from __future__ import annotations

import copy
import json
import subprocess

import pytest
from ogrenmen_common.errors import DbError, LedgerError

from conftest import DERS, LESSON, WAV, ScriptedLLM, as_admin, make_rt, needs_ffmpeg
from ogrenmen_ders import analysis as A
from ogrenmen_ders import pipeline as P
from ogrenmen_ders import transcript as T
from ogrenmen_ders.errors import DersError

pytestmark = needs_ffmpeg
ANALYSIS_FIXTURE = json.loads((DERS / "analysis-01.json").read_text(encoding="utf-8"))
ELIF_STUDENT = "c661b28c-81a8-5c11-9a5e-b919b5231034"


def _run(tmp_path, rt, **kw):
    return P.analyze(rt, lesson_id=LESSON, video=WAV, fixtures=DERS, out=tmp_path / "out", **kw)


def _failure_alerts(rt, lesson=LESSON, status="open"):
    return [a for a in rt.db.tables["instructor_alerts"] if (a.get("ref") or {}).get("lesson_id") == lesson
            and a["detail"].startswith("Ders analizi başarısız") and a["status"] == status]


def _payload(tmp_path) -> dict:
    return json.loads((tmp_path / "out" / "api_payload.json").read_text(encoding="utf-8"))


def _assert_refused_closed(tmp_path, rt):
    payload = (tmp_path / "out" / "api_payload.json").read_text(encoding="utf-8")
    assert json.loads(payload)["requests"] == [] and "Elif" not in payload
    assert not rt.db.written("llm_calls")                     # transkript dahil hiçbir model çağrısı yok
    assert not (tmp_path / "out" / "storage" / "transcripts").exists()
    assert rt.db.get("lessons", id=LESSON)["status"] == "failed"
    (alert,) = _failure_alerts(rt)
    assert "ad temizliği" in alert["detail"]


def test_no_student_hash_fails_closed(tmp_path, monkeypatch):
    """resolve_lesson_labels boş döner (display_name null, name_token_hashes '{}', personel yok)."""
    rt = make_rt(tmp_path / "out")
    real = rt.db.rpc

    def rpc(name, params=None, **kw):
        return [] if name == "resolve_lesson_labels" else real(name, params, **kw)

    monkeypatch.setattr(rt.db, "rpc", rpc)
    with pytest.raises(DersError, match="OGR-DERS-003 öğrenci ad hash'i yok"):
        _run(tmp_path, rt)
    _assert_refused_closed(tmp_path, rt)


def test_staff_only_labels_fail_closed(tmp_path):
    """Öğrencinin PII satırında ad yok: SQL yalnız EĞİTMEN hash'lerini döndürür; öğrenci adı temizlenemezdi."""
    rt = make_rt(tmp_path / "out")
    with as_admin(rt.db):
        rt.db.update("secure.student_pii", {"display_name": None, "name_token_hashes": []},
                     where={"student_id": ELIF_STUDENT})
    labels, _ = T.lesson_labels(rt, LESSON)
    assert labels and {r["label"] for r in labels} == {"EĞİTMEN"}     # ön koşul: yalnız personel hash'i
    with pytest.raises(DersError, match="OGR-DERS-003"):
        _run(tmp_path, rt)
    _assert_refused_closed(tmp_path, rt)


def test_transcribe_only_fails_closed_without_student_hash(tmp_path):
    rt = make_rt(tmp_path / "out")
    with as_admin(rt.db):
        rt.db.update("secure.student_pii", {"display_name": None, "name_token_hashes": []},
                     where={"student_id": ELIF_STUDENT})
    with pytest.raises(DersError, match="OGR-DERS-003"):
        P.transcribe_only(rt, lesson_id=LESSON, video=WAV, out=tmp_path / "out")
    assert not rt.db.written("llm_calls")


def test_subprocess_timeout_marks_failed(tmp_path, monkeypatch):
    rt = make_rt(tmp_path / "out")

    def hang(args, **kw):
        raise subprocess.TimeoutExpired(args, kw.get("timeout"))

    monkeypatch.setattr(subprocess, "run", hang)
    with pytest.raises(DersError, match="OGR-DERS-004 .*zaman aşımı"):
        _run(tmp_path, rt)
    assert rt.db.get("lessons", id=LESSON)["status"] == "failed"
    (alert,) = _failure_alerts(rt)
    assert "ses ya da kare çıkarımı" in alert["detail"]


def test_unexpected_error_marks_failed_and_keeps_original(tmp_path, monkeypatch):
    rt = make_rt(tmp_path / "out")

    def boom(*a, **kw):
        raise RuntimeError("beklenmedik")

    monkeypatch.setattr(A, "build_seed_profile", boom)
    with pytest.raises(RuntimeError, match="beklenmedik"):
        _run(tmp_path, rt)
    assert rt.db.get("lessons", id=LESSON)["status"] == "failed"
    (alert,) = _failure_alerts(rt)
    assert alert["detail"] == "Ders analizi başarısız: beklenmeyen hata"
    result = json.loads((tmp_path / "out" / "ders_result.json").read_text(encoding="utf-8"))
    assert result["status"] == "failed" and result["error"] == "beklenmeyen hata: RuntimeError"


def test_bookkeeping_db_error_does_not_hide_original(tmp_path, monkeypatch):
    rt = make_rt(tmp_path / "out")

    def broken_alert(*a, **kw):
        raise DbError("OGR-DB-001 bağlantı koptu")

    monkeypatch.setattr(P, "open_failure_alert", broken_alert)
    with pytest.raises(LedgerError, match="OGR-LLM-002"):
        with as_admin(rt.db):
            rt.db.update("runtime_flags", {"value": False}, where={"key": "paid_llm_enabled"})
        _run(tmp_path, rt)
    assert rt.db.get("lessons", id=LESSON)["status"] == "failed"


@pytest.mark.parametrize("status", ["approved", "corrected", "processing"])
def test_guarded_status_needs_force(tmp_path, status):
    rt = make_rt(tmp_path / "out")
    with as_admin(rt.db):
        rt.db.update("lessons", {"status": status}, where={"id": LESSON})
    with pytest.raises(DersError, match="OGR-DERS-007 .*--force"):
        _run(tmp_path, rt)
    assert rt.db.get("lessons", id=LESSON)["status"] == status     # geri düşmedi
    assert not rt.db.written("llm_calls")
    assert _run(tmp_path, rt, force=True).status == "analyzed"


def test_success_closes_previous_failure_alert(tmp_path):
    rt = make_rt(tmp_path / "out", bad_output_at=[1, 2])          # 1. çalışma: analiz + onarım bozuk
    with pytest.raises(LedgerError, match="OGR-LLM-001"):
        _run(tmp_path, rt)
    assert len(_failure_alerts(rt)) == 1
    assert _run(tmp_path, rt).status == "analyzed"                # 2. çalışma (failed → yeniden)
    assert _failure_alerts(rt) == []
    (done,) = _failure_alerts(rt, status="done")
    assert done["resolved_at"] == "2026-10-20T09:00:00Z"


def _scripted_once(bad: dict) -> ScriptedLLM:
    return ScriptedLLM({"lesson_analysis": [bad]})


def test_forbidden_word_in_student_text_repaired(tmp_path):
    rt = make_rt(tmp_path / "out")
    bad = copy.deepcopy(ANALYSIS_FIXTURE)
    bad["next_step"]["for_student"] = "Bu konu sınavda kesin çıkacak; üç soru çöz."
    rt.ledger.llm = _scripted_once(bad)
    result = _run(tmp_path, rt)
    assert result.status == "analyzed"
    statuses = [c["status"] for c in rt.db.written("llm_calls") if c["purpose"] == "lesson_analysis"]
    assert statuses == ["bad_output", "ok"]
    final = json.loads((tmp_path / "out" / "lesson_analysis.json").read_text(encoding="utf-8"))
    assert "kesin" not in json.dumps(final, ensure_ascii=False)
    # Onarım istemi de gönderildiği hâliyle kayıtta (api_payload.json = sağlayıcıya giden metin).
    requests = [r for r in _payload(tmp_path)["requests"] if r["purpose"] == "lesson_analysis"]
    assert len(requests) == 2
    assert "/next_step/for_student: yasak kelime" in requests[1]["prompt"]
    assert requests[1]["prompt"] == rt.ledger.llm.prompts[-1][1]


def test_forbidden_word_in_verbatim_quote_allowed(tmp_path):
    """Alıntı öğrencinin sözüdür, değiştirilemez; yasak kelime taraması yalnız modelin yazdığı metne bakar."""
    rt = make_rt(tmp_path / "out")
    ctx = A.load_context(rt, rt.db.get("lessons", id=LESSON))
    data = copy.deepcopy(ANALYSIS_FIXTURE)
    data["questions"][0]["quote"] = "Bu kesin çıkacak mı?"
    errs = ctx.domain_errors(data, transcript_text="ÖĞRENCİ: Bu kesin çıkacak mı?\n" + _fixture_text())
    assert not any("yasak kelime" in e for e in errs)


def _fixture_text() -> str:
    raw = json.loads((DERS / "lesson-01.transcript.json").read_text(encoding="utf-8"))
    return "\n".join(s["text"] for s in raw["segments"])


def test_fabricated_quote_and_out_of_range_time_rejected(tmp_path):
    rt = make_rt(tmp_path / "out")
    ctx = A.load_context(rt, rt.db.get("lessons", id=LESSON))
    text = _fixture_text()
    assert ctx.domain_errors(ANALYSIS_FIXTURE, transcript_text=text) == []
    bad = copy.deepcopy(ANALYSIS_FIXTURE)
    bad["skills"][0]["evidence"][0]["quote"] = "Kesirleri çok iyi biliyorum."
    bad["skills"][1]["evidence"][0]["t"] = "02:30:00"           # 90 dk dersin dışında
    errs = ctx.domain_errors(bad, transcript_text=text)
    assert any(e.startswith("/skills/0/evidence/0/quote: alıntı transkriptte yok") for e in errs)
    assert any(e.startswith("/skills/1/evidence/0/t: zaman ders süresinin") for e in errs)
    ok = copy.deepcopy(ANALYSIS_FIXTURE)
    ok["skills"][0]["evidence"][0]["quote"] = "payları   TOPLARIM 4 … yani 4/12."   # büyük harf, boşluk, kısaltma
    assert ctx.domain_errors(ok, transcript_text=text) == []
    # Uçtan uca: uydurma alıntı onarıma gider.
    rt.ledger.llm = _scripted_once(bad)
    assert _run(tmp_path, rt).status == "analyzed"
    assert [c["status"] for c in rt.db.written("llm_calls") if c["purpose"] == "lesson_analysis"] == \
        ["bad_output", "ok"]


def test_name_in_model_output_repaired_and_repair_prompt_clean(tmp_path):
    """Model bir kare içindeki ad kutucuğundan adı kopyalarsa: onarım; onarım istemi adı tekrar etmez."""
    rt = make_rt(tmp_path / "out")
    bad = copy.deepcopy(ANALYSIS_FIXTURE)
    bad["misconceptions"][0]["text_instructor"] = "Elif payları ve paydaları ayrı ayrı topluyor."
    bad["skills"][0]["skill_id"] = "Elif"                      # hata metni değeri alıntılar: temizlenmeli
    rt.ledger.llm = _scripted_once(bad)
    assert _run(tmp_path, rt).status == "analyzed"
    requests = [r for r in _payload(tmp_path)["requests"] if r["purpose"] == "lesson_analysis"]
    assert len(requests) == 2 and "Elif" not in json.dumps(requests, ensure_ascii=False)
    assert all("Elif" not in prompt for _, prompt in rt.ledger.llm.prompts)
    assert "Elif" not in json.dumps(rt.db.written("lesson_claims"), ensure_ascii=False)


def test_name_persisting_after_repair_never_written(tmp_path):
    rt = make_rt(tmp_path / "out")
    bad = copy.deepcopy(ANALYSIS_FIXTURE)
    bad["talk"]["notes"] = "Elif soru sormaktan çekinmedi."
    rt.ledger.llm = ScriptedLLM({"lesson_analysis": [bad, bad]})
    with pytest.raises(LedgerError, match="OGR-LLM-001"):
        _run(tmp_path, rt)
    assert not rt.db.written("lesson_analyses") and not rt.db.written("lesson_claims")
    assert rt.db.get("lessons", id=LESSON)["status"] == "failed"


def test_final_output_name_belt(tmp_path, monkeypatch):
    """Doğrulayıcı atlansa bile (ör. gelecekte değişen kural) ad içeren analiz write_lesson_analysis'e gitmez."""
    rt = make_rt(tmp_path / "out")
    bad = copy.deepcopy(ANALYSIS_FIXTURE)
    bad["next_step"]["for_instructor"] = "Elif ile EKOK tekrarı yapın."
    rt.ledger.llm = _scripted_once(bad)
    monkeypatch.setattr(A.LessonContext, "validator", lambda self, **kw: (lambda data: []))
    monkeypatch.setattr(A.LessonContext, "domain_errors", lambda self, data, **kw: [])
    with pytest.raises(DersError, match="OGR-DERS-003 analiz çıktısı"):
        _run(tmp_path, rt)
    assert not rt.db.written("lesson_analyses")
    assert rt.db.get("lessons", id=LESSON)["status"] == "failed"


def test_duration_owned_by_pipeline(tmp_path):
    rt = make_rt(tmp_path / "out")
    ctx = A.load_context(rt, rt.db.get("lessons", id=LESSON))
    data = copy.deepcopy(ANALYSIS_FIXTURE)
    data["duration_min"] = 500
    assert "duration_min" not in ctx.normalize(data, duration_min=None, frames=0)
    assert ctx.normalize(data, duration_min=45, frames=0)["duration_min"] == 45
