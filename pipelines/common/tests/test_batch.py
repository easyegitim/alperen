"""BatchRunner: sahte yol anında döner; gerçek yol (Gemini Batch, sahte taşıyıcı) gecikirse 'deferred'."""

from __future__ import annotations

import json

import httpx
import pytest

from ogrenmen_common.adapters.base import LLMRequest
from ogrenmen_common.adapters.gemini import GeminiBatchClient
from ogrenmen_common.batch import BatchItem, BatchRunner
from ogrenmen_common.fakes import FakeLLM
from ogrenmen_common.ledger import CostLedger

SUMMARY = json.loads(
    '{"schema_version":"1.0","student_ref":"s_vd3hp6wz2kc7","week_start":"2026-10-13","body":"Öğrenci kesirleri '
    'çalıştı.","metrics":{"messages":3,"questions_solved":2,"accuracy":0.5,"active_days":2,"open_misconceptions":1,'
    '"unanswered_questions":0,"morale_trend":"flat"},"facts_used":[1]}')


def _items(n=2):
    return [BatchItem(f"s{i}", LLMRequest(purpose="weekly_summary", model="", prompt=f"öğrenci {i}",
                                          schema_id="weekly-summary"), student_ref="s_vd3hp6wz2kc7")
            for i in range(n)]


def test_inline_fake_path_is_immediate_and_discounted(db, clock):
    ledger = CostLedger(db, FakeLLM(), clock=clock, dry_run=True)
    out = BatchRunner(ledger).run("weekly_summary", _items(3))
    assert out.status == "done" and len(out.results) == 3 and not out.errors
    rows = db.written("llm_calls")
    assert len(rows) == 3 and all(r["batch"] for r in rows)
    r = rows[0]
    assert r["cost_usd"] == ledger.price(r["model"], r["tokens_in"], r["tokens_out"], batch=True)


def test_inline_blocked_by_cap(db, clock):
    db.rpc("set_runtime_flag", {"p_key": "paid_llm_enabled", "p_value": False})
    out = BatchRunner(CostLedger(db, FakeLLM(), clock=clock)).run("weekly_summary", _items(2))
    assert out.status == "blocked" and set(out.errors) == {"s0", "s1"}


class NeverCalled:
    def create(self, *a, **k):
        raise AssertionError("degraded kipte Batch gönderilmemeli")


@pytest.mark.parametrize("client", [None, NeverCalled()])
def test_degraded_batch_calls_no_model(db, clock, client):
    db.rpc("set_runtime_flag", {"p_key": "degraded_mode", "p_value": True})
    llm = FakeLLM()
    before = len(db.written("llm_calls"))
    out = BatchRunner(CostLedger(db, llm, clock=clock), client=client).run("weekly_summary", _items(3))
    assert out.status == "blocked" and set(out.errors) == {"s0", "s1", "s2"} and not out.results
    assert all("degraded" in e for e in out.errors.values()) and llm.calls == []
    rows = db.written("llm_calls")[before:]
    assert [(r["status"], r["error_code"], r["batch"]) for r in rows] == [("cap_blocked", "degraded", True)]


def test_duplicate_keys_rejected(ledger):
    items = _items(1) * 2
    with pytest.raises(ValueError):
        BatchRunner(ledger).run("weekly_summary", items)


class FakeBatchApi:
    def __init__(self, states, responses):
        self.states = list(states)
        self.responses = responses
        self.created = None
        self.polls = 0

    def __call__(self, request: httpx.Request) -> httpx.Response:
        if request.method == "POST" and request.url.path.endswith(":batchGenerateContent"):
            assert request.headers["x-goog-api-key"] == "test-key"
            self.created = json.loads(request.content)
            return httpx.Response(200, json={"name": "batches/b1"})
        if request.method == "GET" and request.url.path.endswith("/batches/b1"):
            self.polls += 1
            state = self.states.pop(0) if self.states else "BATCH_STATE_SUCCEEDED"
            body = {"name": "batches/b1", "metadata": {"state": state}}
            if state == "BATCH_STATE_SUCCEEDED":
                body["response"] = {"inlinedResponses": {"inlinedResponses": self.responses}}
            return httpx.Response(200, json=body)
        return httpx.Response(404)


def _gen(payload, tin=1000, tout=100):
    return {"candidates": [{"content": {"parts": [{"text": json.dumps(payload, ensure_ascii=False)}]}}],
            "usageMetadata": {"promptTokenCount": tin, "candidatesTokenCount": tout}}


def test_remote_batch_success(db, clock):
    api = FakeBatchApi(["BATCH_STATE_PENDING", "BATCH_STATE_RUNNING"], [
        {"response": _gen(SUMMARY), "metadata": {"key": "s0"}},
        {"response": _gen({"bozuk": True}), "metadata": {"key": "s1"}},
    ])
    client = GeminiBatchClient("test-key", transport=httpx.MockTransport(api))
    ledger = CostLedger(db, FakeLLM(), clock=clock)
    sleeps = []
    out = BatchRunner(ledger, client=client, sleep=sleeps.append, poll_s=30).run("weekly_summary", _items(2))
    assert out.status == "done" and out.job == "batches/b1" and out.model == "gemini-2.5-flash-lite"
    assert list(out.results) == ["s0"] and "s1" in out.errors
    assert out.results["s0"].data["body"].startswith("Öğrenci") and sleeps == [30, 30]
    reqs = api.created["batch"]["input_config"]["requests"]["requests"]
    assert [r["metadata"]["key"] for r in reqs] == ["s0", "s1"]
    assert reqs[0]["request"]["generationConfig"]["responseMimeType"] == "application/json"
    rows = db.written("llm_calls")
    assert [r["status"] for r in rows] == ["ok", "bad_output"] and all(r["batch"] for r in rows)
    assert rows[0]["cost_usd"] == pytest.approx((1000 * 0.10 + 100 * 0.40) / 1e6 * 0.5)


def test_remote_batch_deferred_on_timeout_without_sync_fallback(db, clock):
    api = FakeBatchApi(["BATCH_STATE_RUNNING"] * 100, [])
    client = GeminiBatchClient("test-key", transport=httpx.MockTransport(api))
    llm = FakeLLM()
    t = [0.0]

    def tick():
        t[0] += 3600
        return t[0]

    out = BatchRunner(CostLedger(db, llm, clock=clock), client=client, sleep=lambda s: None, monotonic=tick,
                      max_wait_s=6 * 3600).run("weekly_summary", _items(2))
    assert out.status == "deferred" and out.errors == {"*": "zaman aşımı"}
    assert llm.calls == [] and db.written("llm_calls") == []


def test_remote_batch_failed_state_and_blocked(db, clock):
    api = FakeBatchApi(["BATCH_STATE_FAILED"], [])
    client = GeminiBatchClient("test-key", transport=httpx.MockTransport(api))
    out = BatchRunner(CostLedger(db, FakeLLM(), clock=clock), client=client, sleep=lambda s: None).run(
        "weekly_summary", _items(1))
    assert out.status == "deferred" and out.errors["*"] == "BATCH_STATE_FAILED"
    db.rpc("set_runtime_flag", {"p_key": "paid_llm_enabled", "p_value": False})
    blocked = BatchRunner(CostLedger(db, FakeLLM(), clock=clock), client=client).run("weekly_summary", _items(2))
    assert blocked.status == "blocked" and [r["status"] for r in db.written("llm_calls")] == ["cap_blocked"] * 2


def test_remote_batch_rate_limited_submit_defers(db, clock):
    def handler(request):
        return httpx.Response(429, headers={"retry-after": "30"}, json={"error": {"message": "kota"}})

    client = GeminiBatchClient("test-key", transport=httpx.MockTransport(handler))
    out = BatchRunner(CostLedger(db, FakeLLM(), clock=clock), client=client).run("weekly_summary", _items(1))
    assert out.status == "deferred" and "rate_limited" in out.errors["*"]
