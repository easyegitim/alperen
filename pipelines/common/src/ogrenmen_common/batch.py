"""Gemini Batch API sarmalayıcısı (gece işleri; %50 indirim — §5.6, §6.2).

``BatchRunner.run(purpose, items)``:

* **Sahte/anahtarsız yol** (``client=None``): her öğe ``CostLedger.call(..., batch=True)`` ile hemen
  işlenir; Batch fiyatı uygulanır, ``status='done'`` anında döner.
* **Gerçek yol**: zincirin ilk ücretli Gemini modeliyle tek iş gönderilir (satır içi istekler), en çok
  ``max_wait_s`` (6 saat) yoklanır. Süre dolarsa ya da iş başarısızsa ``status='deferred'`` döner —
  **eş zamanlı çağrıya düşülmez** (§12 #27); çağıran ``facts_lag_days``'i artırır ve ertesi gece yeniler.
  ``check_spend`` ücretli çağrıya izin vermezse ``status='blocked'`` (her öğe ``cap_blocked``).
* **Degraded** (``degraded_mode=true``; §5.6 "LLM yok"): iki yolda da hiçbir model çağrılmaz; tek
  ``cap_blocked`` denemesi yazılır ve ``status='blocked'`` döner (her öğenin hatası ``OGR-LLM-002``).
"""

from __future__ import annotations

import time
from collections.abc import Callable, Sequence
from dataclasses import dataclass, field

from .adapters.base import LLMRequest
from .adapters.gemini import BATCH_DONE, BATCH_FAILED, GeminiBatchClient, parse_generate_response
from .errors import AdapterError, LedgerError
from .ledger import CallResult, CostLedger
from .purposes import output_errors


@dataclass
class BatchItem:
    key: str
    request: LLMRequest
    student_ref: str | None = None
    ref_table: str | None = None
    ref_id: str | None = None


@dataclass
class BatchOutcome:
    status: str
    """``done`` | ``deferred`` | ``blocked``"""
    results: dict[str, CallResult] = field(default_factory=dict)
    errors: dict[str, str] = field(default_factory=dict)
    job: str | None = None
    model: str | None = None


class BatchRunner:
    def __init__(self, ledger: CostLedger, *, client: GeminiBatchClient | None = None, max_wait_s: float = 6 * 3600,
                 poll_s: float = 60.0, sleep: Callable[[float], None] = time.sleep,
                 monotonic: Callable[[], float] = time.monotonic):
        self.ledger = ledger
        self.client = client
        self.max_wait_s = max_wait_s
        self.poll_s = poll_s
        self.sleep = sleep
        self.monotonic = monotonic

    def _batch_model(self, chain: str) -> str | None:
        for model in self.ledger.chain(chain):
            info = self.ledger.model_info(model)
            pinfo = self.ledger.provider_info(info["provider"])
            if pinfo.get("kind") == "gemini" and pinfo.get("tier") == "paid" and info.get("batch_discount"):
                return model
        return None

    def run(self, purpose: str, items: Sequence[BatchItem], *, chain: str | None = None,
            display_name: str | None = None) -> BatchOutcome:
        chain_name = chain or purpose
        keys = [i.key for i in items]
        if len(set(keys)) != len(keys):
            raise ValueError("Batch öğe anahtarları benzersiz olmalı")
        if not items:
            return BatchOutcome(status="done")
        gate = self.ledger.gate(purpose, refresh=True)
        if self.ledger.is_degraded(gate):
            model = self.ledger.chain(chain_name)[0]
            try:
                self.ledger.refuse_if_degraded(purpose, gate, model=model, batch=True)
            except LedgerError as exc:
                return BatchOutcome(status="blocked", errors={i.key: exc.message for i in items}, model=model)
        if self.client is None:
            return self._run_inline(purpose, items, chain_name)
        return self._run_remote(purpose, items, chain_name, display_name or f"ogrenmen-{purpose}")

    def _run_inline(self, purpose: str, items: Sequence[BatchItem], chain: str) -> BatchOutcome:
        out = BatchOutcome(status="done")
        for item in items:
            try:
                out.results[item.key] = self.ledger.call(purpose, item.request, chain=chain, batch=True,
                                                         student_ref=item.student_ref, ref_table=item.ref_table,
                                                         ref_id=item.ref_id)
            except LedgerError as exc:
                if exc.code == "OGR-LLM-002":
                    out.status = "blocked"
                out.errors[item.key] = exc.message
        return out

    def _run_remote(self, purpose: str, items: Sequence[BatchItem], chain: str, display_name: str) -> BatchOutcome:
        assert self.client is not None
        model = self._batch_model(chain)
        if model is None:
            raise LedgerError(f"OGR-LLM-003 {chain} zincirinde Batch destekli ücretli Gemini modeli yok")
        provider = self.ledger.model_info(model)["provider"]
        gate = self.ledger.gate(purpose, refresh=True)
        if not gate.get("paid_allowed", False):
            out = BatchOutcome(status="blocked", model=model)
            for item in items:
                self.ledger.record(purpose, provider=provider, model=model, status="cap_blocked", batch=True,
                                   student_ref=item.student_ref, ref_table=item.ref_table, ref_id=item.ref_id)
                out.errors[item.key] = f"OGR-LLM-002 tavan ({gate.get('state')})"
            return out
        try:
            job = self.client.create(model, [(i.key, i.request.with_model(model)) for i in items],
                                     display_name=display_name)
        except AdapterError as exc:
            return BatchOutcome(status="deferred", errors={"*": exc.message}, model=model)
        started = self.monotonic()
        batch: dict = {}
        while True:
            try:
                batch = self.client.get(job)
            except AdapterError as exc:
                return BatchOutcome(status="deferred", job=job, errors={"*": exc.message}, model=model)
            state = self.client.state(batch)
            if state == BATCH_DONE:
                break
            if state in BATCH_FAILED:
                return BatchOutcome(status="deferred", job=job, errors={"*": state}, model=model)
            if self.monotonic() - started >= self.max_wait_s:
                return BatchOutcome(status="deferred", job=job, errors={"*": "zaman aşımı"}, model=model)
            self.sleep(self.poll_s)
        return self._collect(purpose, items, chain, model, provider, job, batch)

    def _collect(self, purpose, items, chain, model, provider, job, batch) -> BatchOutcome:
        out = BatchOutcome(status="done", job=job, model=model)
        by_key = {i.key: i for i in items}
        seen: set[str] = set()
        for key, response, error in self.client.inline_responses(batch):  # type: ignore[union-attr]
            item = by_key.get(key)
            if item is None:
                continue
            seen.add(key)
            common = {"batch": True, "student_ref": item.student_ref, "ref_table": item.ref_table,
                      "ref_id": item.ref_id}
            if error is not None or response is None:
                self.ledger.record(purpose, provider=provider, model=model, status="error", error_code="batch_item",
                                   **common)
                out.errors[key] = error or "yanıt yok"
                continue
            res = parse_generate_response(response, item.request)
            if not res.ok:
                self.ledger.record(purpose, provider=provider, model=model, status="bad_output", error_code="empty",
                                   **common)
                out.errors[key] = res.error_detail or "boş yanıt"
                continue
            errs = output_errors(item.request.schema_id, res.json) if item.request.schema_id else []
            if item.request.schema_id and res.json is None:
                errs = ["yanıt JSON değil"]
            status = "bad_output" if errs else "ok"
            row = self.ledger.record(purpose, provider=provider, model=model, status=status,
                                     error_code="schema" if errs else None, tokens_in=res.tokens_in,
                                     tokens_out=res.tokens_out, **common)
            if errs:
                out.errors[key] = "; ".join(errs[:3])
                continue
            attempt = {"provider": provider, "model": model, "status": "ok", "tokens_in": res.tokens_in,
                       "tokens_out": res.tokens_out, "cost_usd": row["cost_usd"], "latency_ms": 0, "error_code": None}
            out.results[key] = CallResult(purpose=purpose, chain=chain, data=res.json if item.request.schema_id
                                          else res.text, text=res.text, model=model, provider=provider,
                                          attempts=[attempt], cost_usd=row["cost_usd"], tokens_in=res.tokens_in,
                                          tokens_out=res.tokens_out, batch=True)
        for key in by_key:
            if key not in seen and key not in out.errors:
                out.errors[key] = "Batch yanıtında yok"
        return out
