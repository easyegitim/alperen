"""Haftalık özet: ölçüler Python'da (panel_metrics_weekly eşleniği), gövde LLM'den, sözleşme doğrulaması."""

from __future__ import annotations

import json

import ogrenmen_contracts as contracts
import pytest
from ogrenmen_common.adapters.base import LLMRequest, LLMResult
from ogrenmen_common.fakes.llm import estimate_tokens
from ogrenmen_common.paths import llm_fixtures_root

from conftest import KULAKLIK, REF_A, STUDENT_A, STUDENT_B, make_rt, read_jsonl, run_cli
from ogrenmen_kulaklik import summaries as S
from ogrenmen_kulaklik.common import week_window
from ogrenmen_kulaklik.fixture_llm import install

LLM_FIXTURES = llm_fixtures_root()


def test_summaries_cli(tmp_path):
    assert run_cli("summaries", "--week", "2026-10-13", "--dry-run", "--fixtures", str(KULAKLIK),
                   "--out", str(tmp_path)) == 0
    rep = json.loads((tmp_path / "summaries_report.json").read_text())
    assert rep["written"] == 1
    assert rep["skipped_existing"] == ["s_vd3hp6wz2kc7"]  # dev-seed'de bu hafta zaten var (yalnız ekleme)
    rows = read_jsonl(tmp_path / "weekly_summaries.jsonl")
    assert len(rows) == 1 and rows[0]["student_id"] == STUDENT_A and rows[0]["week_start"] == "2026-10-13"
    view = {"schema_version": "1.0", "student_ref": REF_A, "week_start": rows[0]["week_start"],
            "body": rows[0]["body"], "metrics": rows[0]["metrics"], "facts_used": rows[0]["facts_used"]}
    contracts.validate("weekly-summary", view)
    calls = read_jsonl(tmp_path / "llm_calls.jsonl")
    assert [c["purpose"] for c in calls] == ["weekly_summary"] and calls[0]["student_ref"] == REF_A


def test_weekly_metrics_python_equivalent(tmp_path):
    rt = make_rt(tmp_path)
    window = week_window(None, rt.clock())
    a = S.weekly_metrics(rt.db, STUDENT_A, window)
    # messages-day.json: A'nın 18 Ekim öğrenci mesajları 16, 17, 19, 21, 24; soruların hepsi cevaplı
    assert a["messages"] == 5 and a["unanswered_questions"] == 0 and a["active_days"] >= 1
    assert a["morale_trend"] == "down"  # memory-facts.json: tek sinyal −1 → ort −1 ≤ −0,5
    b = S.weekly_metrics(rt.db, STUDENT_B, window)
    assert b["unanswered_questions"] == 2  # 14 ve 27
    assert b["morale_trend"] == "down"  # −1 ve ders kaynaklı −2'ler
    assert S.morale_trend(None) == "unknown" and S.morale_trend(0.5) == "up" and S.morale_trend(0.0) == "flat"
    rt.close()


def test_body_is_scrubbed_and_facts_used_restricted(tmp_path):
    rt = make_rt(tmp_path)
    wrapped = install(rt, KULAKLIK)
    window = week_window(None, rt.clock())
    rep = S.run_summaries(rt, window, name_hashes=[])
    assert rep.written == 1
    row = rt.db.written("weekly_summaries")[0]
    given = {int(f["id"]) for f in S._facts_for(rt.db, STUDENT_A, window)}
    assert set(row["facts_used"]) <= given
    assert any("Hafta: 2026-10-13" in c.prompt_text for c in wrapped.calls)
    rt.close()


class BodyLLM:
    """``weekly_summary`` için fixture özetini gövdesi değiştirilmiş olarak döndürür."""

    def __init__(self, body):
        self.example = json.loads((LLM_FIXTURES / "weekly_summary" / "02-elif-2026-10-13.json").read_text())
        self.body = body

    def complete(self, request: LLMRequest) -> LLMResult:
        data = dict(self.example, body=self.body, facts_used=[])
        text = json.dumps(data, ensure_ascii=False)
        return LLMResult(ok=True, text=text, json=data, tokens_in=estimate_tokens(request.prompt_text),
                         tokens_out=estimate_tokens(text))


@pytest.mark.parametrize("body,word", [
    ("Öğrenci bu hafta tembel davrandı ve az soru çözdü.", "tembel"),
    ("Öğrenci rasyonel sayıları çalıştı; bu konu sınavda kesin çıkar.", "kesin"),
])
def test_summary_with_label_word_is_rejected(tmp_path, body, word):
    rt = make_rt(tmp_path)
    llm = BodyLLM(body)
    rt.ledger.llm = llm
    rt.llm = llm
    rep = S.run_summaries(rt, week_window(None, rt.clock()))
    assert rep.written == 0
    assert rep.rejected and rep.rejected[0]["reason"] == "yargi_kelimesi" and rep.rejected[0]["word"] == word
    assert rt.db.written("weekly_summaries") == []
    rt.close()
