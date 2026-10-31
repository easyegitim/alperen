"""CostLedger — pipelines'ın tüm model çağrılarının tek kapısı (BLUEPRINT §6 kural 2, §5.6, §8.4).

``call(purpose, request)`` sırasıyla:

1. ``check_spend(purpose)`` (60 sn önbellek): ``degraded`` (``degraded_mode=true``; §5.6 "LLM yok", kurucunun
   kill-switch'i) iken **hiçbir** model (ücretli ya da ücretsiz, ders amaçları dahil) çağrılmaz — tek
   ``cap_blocked`` denemesi yazılır ve ``OGR-LLM-002`` yükselir; ücretli sağlayıcı yalnız ``paid_allowed`` iken
   çağrılır, değilse deneme ``cap_blocked`` yazılır (ders amaçları kendi ``lesson_monthly_cap_usd`` tavanına bağlıdır).
2. Zincir ``models.json`` ``chains[<chain|purpose>]``; kapalı model/sağlayıcı ve anahtarı olmayan
   sağlayıcı çağrılmadan atlanır; bekleme süresindeki sağlayıcı ``cooldown_skip``.
3. Hata: 429 → ``rate_limited`` (sağlayıcı ``retry_after`` ya da 60 sn bekler), 5xx → ``error``
   (``http_<kod>``), zaman aşımı → ``timeout``, 400/401/403 → ``error`` (``config_<kod>``; kurucuya
   bildirim, sağlayıcı oturum boyunca kapalı); hepsinde sıradaki modele geçilir.
4. Şema (``request.schema_id`` ya da ``validator``) geçmezse aynı modelde **bir** onarım, sonra sıradaki.
5. Her deneme bir ``llm_calls`` satırıdır (``purpose, provider, model, tokens, status, cost_usd,
   ref_table, ref_id, student_ref``); ``student_ref`` yalnız ``s_…`` olabilir (uuid/ad asla).

``LedgeredEmbedding`` embedding çağrılarını da aynı kapıdan geçirir (``purpose='embedding'``, ``embedding``
zinciri; her toplu çağrı bir ``llm_calls`` satırı).

Maliyet: ``tokens_in·in_per_m/1e6 + tokens_out·out_per_m/1e6`` (+ ``per_audio_hour``), Batch'te
``(1 − batch_discount)`` ile. ``write_estimate(out)`` dry-run'da ``cost_estimate.json`` yazar.
"""

from __future__ import annotations

import json
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

import ogrenmen_contracts as contracts

from .adapters.base import DB, LLM, LLM_PURPOSES, Embedding, LLMRequest, LLMResult, Notifier
from .adapters.router import model_enabled
from .adapters.structured import parse_json_text
from .clock import Clock, iso, system_clock
from .errors import AdapterError, DbError, LedgerError
from .ids import STUDENT_REF
from .purposes import output_errors

DEFAULT_EXCLUDED = ("lesson_analysis", "transcribe", "diarize")
REPAIR_NOTE = "Önceki yanıtın şemaya uymadı. Yalnızca şemaya uygun JSON döndür; hatalar: "
COOLDOWN_DEFAULT_S = 60.0

Validator = Callable[[Any], list[str]]


@dataclass
class CallResult:
    """Başarılı çağrının sonucu; ``attempts`` §4.0 ``providerAttempt`` biçimindedir."""

    purpose: str
    chain: str
    data: Any
    text: str
    model: str
    provider: str
    attempts: list[dict] = field(default_factory=list)
    cost_usd: float = 0.0
    tokens_in: int = 0
    tokens_out: int = 0
    repaired: bool = False
    batch: bool = False


def _round(x: float) -> float:
    return round(float(x), 6)


class CostLedger:
    def __init__(self, db: DB | None, llm: LLM, *, models: Mapping[str, Any] | None = None,
                 clock: Clock | None = None, dry_run: bool = False, notifier: Notifier | None = None,
                 gate_ttl_s: float = 60.0):
        self.db = db
        self.llm = llm
        self.models = dict(models) if models is not None else contracts.load_models()
        self.clock: Clock = clock or system_clock
        self.dry_run = dry_run
        self.notifier = notifier
        self.gate_ttl_s = gate_ttl_s
        self.calls: list[dict] = []
        self.neurons = 0.0
        self._gate_cache: dict[str, tuple[datetime, dict]] = {}
        self._cooldown: dict[str, datetime] = {}
        self._config_dead: set[str] = set()

    # --- tablo yardımcıları ---------------------------------------------------------------------

    def chain(self, name: str) -> list[str]:
        chains = self.models.get("chains") or {}
        if name not in chains:
            raise LedgerError(f"OGR-LLM-003 bilinmeyen zincir: {name}")
        return list(chains[name])

    def model_info(self, model: str) -> dict:
        info = (self.models.get("models") or {}).get(model)
        if info is None:
            raise LedgerError(f"OGR-LLM-003 models.json'da model yok: {model}")
        return info

    def provider_info(self, provider: str) -> dict:
        return (self.models.get("providers") or {}).get(provider) or {}

    def is_paid(self, model: str) -> bool:
        return self.provider_info(self.model_info(model)["provider"]).get("tier") == "paid"

    def price(self, model: str, tokens_in: int, tokens_out: int, *, audio_sec: int | None = None,
              batch: bool = False) -> float:
        info = self.model_info(model)
        cost = tokens_in * float(info.get("in_per_m", 0)) / 1e6 + tokens_out * float(info.get("out_per_m", 0)) / 1e6
        if audio_sec and info.get("per_audio_hour"):
            cost += float(info["per_audio_hour"]) * audio_sec / 3600
        if batch:
            cost *= 1 - float(info.get("batch_discount", 0))
        return _round(cost)

    def excluded_purposes(self) -> tuple[str, ...]:
        if self.db is None:
            return DEFAULT_EXCLUDED
        try:
            rows = self.db.select("runtime_flags", where={"key": "cap_excluded_purposes"}, limit=1)
        except DbError:
            return DEFAULT_EXCLUDED
        return tuple(rows[0]["value"]) if rows and isinstance(rows[0].get("value"), list) else DEFAULT_EXCLUDED

    # --- tavan kapısı ---------------------------------------------------------------------------

    def gate(self, purpose: str, *, refresh: bool = False) -> dict:
        """``check_spend(p_purpose)`` sonucu (DB yoksa her şeye izin veren 'normal' durum)."""
        now = self.clock()
        cached = self._gate_cache.get(purpose)
        if cached and not refresh and (now - cached[0]).total_seconds() < self.gate_ttl_s:
            return cached[1]
        if self.db is None:
            result = {"paid_allowed": True, "degraded": False, "state": "normal"}
        else:
            raw = self.db.rpc("check_spend", {"p_purpose": purpose})
            result = raw[0] if isinstance(raw, list) else raw
            if not isinstance(result, Mapping) or "paid_allowed" not in result:
                raise LedgerError(f"OGR-LLM-002 check_spend yanıtı beklenmedik: {raw!r}")
            result = dict(result)
        self._gate_cache[purpose] = (now, result)
        return result

    def invalidate_gate(self) -> None:
        self._gate_cache.clear()

    @staticmethod
    def is_degraded(gate: Mapping[str, Any]) -> bool:
        """``check_spend`` ``degraded`` kipini bildiriyor mu (``degraded_mode=true`` → ``state='degraded'``)."""
        return bool(gate.get("degraded")) or gate.get("state") == "degraded"

    def refuse_if_degraded(self, purpose: str, gate: Mapping[str, Any], *, model: str, batch: bool = False,
                           student_ref: str | None = None, ref_table: str | None = None,
                           ref_id: str | None = None) -> None:
        """Degraded kipte tek ``cap_blocked`` denemesi yazar ve ``OGR-LLM-002`` yükseltir; değilse hiçbir şey."""
        if not self.is_degraded(gate):
            return
        row = self.record(purpose, provider=self.model_info(model)["provider"], model=model, status="cap_blocked",
                          error_code="degraded", batch=batch, student_ref=student_ref, ref_table=ref_table,
                          ref_id=ref_id)
        raise LedgerError(f"OGR-LLM-002 degraded kipte model çağrılmaz ({purpose})", [self._attempt(row)])

    # --- kayıt ----------------------------------------------------------------------------------

    def record(self, purpose: str, *, provider: str, model: str, status: str, tokens_in: int = 0, tokens_out: int = 0,
               audio_sec: int | None = None, images: int | None = None, batch: bool = False,
               error_code: str | None = None, latency_ms: int | None = None, student_ref: str | None = None,
               ref_table: str | None = None, ref_id: str | None = None, cost_usd: float | None = None) -> dict:
        """Tek ``llm_calls`` satırı yazar (DB'ye; JsonlDb'de ``out/llm_calls.jsonl``) ve oturum toplamına ekler."""
        if purpose not in LLM_PURPOSES:
            raise LedgerError(f"OGR-LLM-003 bilinmeyen amaç: {purpose}")
        if student_ref is not None and not STUDENT_REF.match(str(student_ref)):
            raise LedgerError("OGR-LLM-003 student_ref yalnız s_… biçiminde olabilir (uuid ya da ad asla)")
        if cost_usd is None:
            cost_usd = self.price(model, tokens_in, tokens_out, audio_sec=audio_sec, batch=batch) if status in (
                "ok", "bad_output") else 0.0
        row = {"purpose": purpose, "provider": provider, "model": model, "tokens_in": int(tokens_in),
               "tokens_out": int(tokens_out), "audio_sec": audio_sec, "images": images, "batch": bool(batch),
               "status": status, "error_code": error_code, "latency_ms": latency_ms, "cost_usd": _round(cost_usd),
               "ref_table": ref_table, "ref_id": None if ref_id is None else str(ref_id), "student_ref": student_ref,
               "created_at": iso(self.clock())}
        info = (self.models.get("models") or {}).get(model) or {}
        if info.get("neurons_per_1k_tokens") and status in ("ok", "bad_output"):
            self.neurons += (tokens_in + tokens_out) / 1000 * float(info["neurons_per_1k_tokens"])
        if self.db is not None:
            stored = self.db.insert("llm_calls", row)
            if stored:
                row = stored[0]
        self.calls.append(row)
        if cost_usd:
            self.invalidate_gate()
        return row

    def _attempt(self, row: Mapping[str, Any]) -> dict:
        return {"provider": row["provider"], "model": row["model"], "status": row["status"],
                "tokens_in": row["tokens_in"], "tokens_out": row["tokens_out"], "cost_usd": row["cost_usd"],
                "latency_ms": int(row.get("latency_ms") or 0), "error_code": row.get("error_code")}

    def _note_provider_error(self, provider: str, status: str, detail: str | None) -> None:
        if self.db is None:
            return
        try:
            rows = self.db.select("provider_health", where={"provider": provider}, limit=1)
            if rows:
                self.db.update("provider_health", {
                    "consecutive_errors": int(rows[0].get("consecutive_errors") or 0) + 1,
                    "cooldown_until": iso(self._cooldown[provider]) if provider in self._cooldown else None,
                    "last_error": f"{status}: {detail or ''}"[:200], "updated_at": iso(self.clock())},
                    where={"provider": provider})
        except DbError:
            return

    # --- çağrı ----------------------------------------------------------------------------------

    def _available(self, model: str) -> bool:
        """Model çağrılabilir mi: ``models.json`` enabled bayrakları (tek kopya: ``router.model_enabled``) ve LLM
        ``available`` sunuyorsa (``ProviderRouter``: sağlayıcının anahtarı var mı) onun yanıtı."""
        if not model_enabled(self.models, model):
            return False
        checker = getattr(self.llm, "available", None)
        return bool(checker(model)) if callable(checker) else True

    def call(self, purpose: str, request: LLMRequest, *, chain: str | None = None, student_ref: str | None = None,
             ref_table: str | None = None, ref_id: str | None = None, batch: bool = False,
             validator: Validator | None = None) -> CallResult:
        """Zinciri dener; ilk geçerli yanıtı döner. Hiçbiri olmazsa ``LedgerError`` (``attempts`` dolu)."""
        if purpose not in LLM_PURPOSES:
            raise LedgerError(f"OGR-LLM-003 bilinmeyen amaç: {purpose}")
        chain_name = chain or purpose
        models = self.chain(chain_name)
        check = validator or (
            (lambda data: output_errors(request.schema_id, data)) if request.schema_id else None)  # type: ignore[arg-type]
        gate = self.gate(purpose)
        common = {"batch": batch, "student_ref": student_ref, "ref_table": ref_table, "ref_id": ref_id}
        self.refuse_if_degraded(purpose, gate, model=models[0], **common)
        attempts: list[dict] = []
        tried_any = False
        for model in models:
            if not self._available(model):
                continue
            provider = self.model_info(model)["provider"]
            if provider in self._config_dead:
                continue
            if self.is_paid(model) and not gate.get("paid_allowed", False):
                attempts.append(self._attempt(self.record(purpose, provider=provider, model=model, status="cap_blocked",
                                                          **common)))
                continue
            until = self._cooldown.get(provider)
            if until is not None and self.clock() < until:
                attempts.append(self._attempt(self.record(purpose, provider=provider, model=model,
                                                          status="cooldown_skip", **common)))
                continue
            tried_any = True
            req = request.with_model(model)
            repaired = False
            for round_no in (0, 1):
                res: LLMResult = self.llm.complete(req)
                if not res.ok:
                    status, code = self._status_of(res)
                    attempts.append(self._attempt(self.record(
                        purpose, provider=provider, model=model, status=status, error_code=code,
                        latency_ms=res.latency_ms, **common)))
                    self._after_failure(provider, res)
                    break
                data = res.json
                if data is None and check is not None:
                    data = parse_json_text(res.text)
                if data is None and check is None:
                    data = res.text
                errs = check(data) if check is not None else []
                if data is None and check is not None:
                    errs = ["yanıt JSON değil"]
                if errs:
                    attempts.append(self._attempt(self.record(
                        purpose, provider=provider, model=model, status="bad_output", error_code="schema",
                        tokens_in=res.tokens_in, tokens_out=res.tokens_out, audio_sec=res.audio_sec, images=res.images,
                        latency_ms=res.latency_ms, **common)))
                    if round_no == 0:
                        req = req.with_prompt(f"{request.prompt}\n\n{REPAIR_NOTE}{'; '.join(errs[:5])}")
                        repaired = True
                        continue
                    break
                row = self.record(purpose, provider=provider, model=model, status="ok", tokens_in=res.tokens_in,
                                  tokens_out=res.tokens_out, audio_sec=res.audio_sec, images=res.images,
                                  latency_ms=res.latency_ms, **common)
                attempts.append(self._attempt(row))
                return CallResult(purpose=purpose, chain=chain_name, data=data, text=res.text, model=model,
                                  provider=provider, attempts=attempts,
                                  cost_usd=_round(sum(a["cost_usd"] for a in attempts)), tokens_in=res.tokens_in,
                                  tokens_out=res.tokens_out, repaired=repaired, batch=batch)
        if attempts and not tried_any and all(a["status"] == "cap_blocked" for a in attempts):
            raise LedgerError(f"OGR-LLM-002 tavan ücretli çağrıyı engelledi ({purpose}; durum {gate.get('state')})",
                              attempts)
        raise LedgerError(f"OGR-LLM-001 {chain_name} zincirinde başarılı sağlayıcı yok ({len(attempts)} deneme)",
                          attempts)

    @staticmethod
    def _status_of(res: LLMResult) -> tuple[str, str | None]:
        if res.error == "rate_limited":
            return "rate_limited", "http_429"
        if res.error == "timeout":
            return "timeout", None
        if res.error == "bad_output":
            return "bad_output", "empty"
        if res.error == "config":
            return "error", f"config_{res.status}" if res.status else "config"
        return "error", f"http_{res.status}" if res.status else "network"

    def _after_failure(self, provider: str, res: LLMResult) -> None:
        if res.error == "rate_limited":
            wait = (res.retry_after_ms / 1000) if res.retry_after_ms else COOLDOWN_DEFAULT_S
            self._cooldown[provider] = self.clock() + timedelta(seconds=wait)
            self._note_provider_error(provider, "rate_limited", res.error_detail)
        elif res.error == "config":
            self._config_dead.add(provider)
            self._note_provider_error(provider, "config", res.error_detail)
            if self.notifier is not None:
                self.notifier.notify(f"Sağlayıcı yapılandırma hatası: {provider} ({res.status or 'yapılandırma'}). "
                                     "Anahtarı ve modeli denetle; zincir sonraki sağlayıcıyla sürüyor.",
                                     level="warning")

    # --- tahmin ---------------------------------------------------------------------------------

    def estimate(self) -> dict:
        """Oturumdaki tüm denemelerin özeti (``cost_estimate.json`` içeriği)."""
        excluded = set(self.excluded_purposes())
        by_purpose: dict[str, dict] = {}
        by_model: dict[str, dict] = {}
        by_status: dict[str, int] = {}
        for c in self.calls:
            for bucket, key in ((by_purpose, c["purpose"]), (by_model, c["model"])):
                b = bucket.setdefault(key, {"calls": 0, "ok": 0, "cost_usd": 0.0, "tokens_in": 0, "tokens_out": 0})
                b["calls"] += 1
                b["ok"] += 1 if c["status"] == "ok" else 0
                b["cost_usd"] = _round(b["cost_usd"] + float(c["cost_usd"]))
                b["tokens_in"] += int(c["tokens_in"])
                b["tokens_out"] += int(c["tokens_out"])
            by_status[c["status"]] = by_status.get(c["status"], 0) + 1
        total = _round(sum(float(c["cost_usd"]) for c in self.calls))
        lesson = _round(sum(float(c["cost_usd"]) for c in self.calls if c["purpose"] in excluded))
        return {
            "dry_run": self.dry_run,
            "currency": "USD",
            "generated_at": iso(self.clock()),
            "models_verified_at": self.models.get("verified_at"),
            "attempts": len(self.calls),
            "calls_ok": by_status.get("ok", 0),
            "total_usd": total,
            "chat_batch_usd": _round(total - lesson),
            "lesson_usd": lesson,
            "tokens_in": sum(int(c["tokens_in"]) for c in self.calls),
            "tokens_out": sum(int(c["tokens_out"]) for c in self.calls),
            "cf_ai_neurons": round(self.neurons, 3),
            "by_purpose": by_purpose,
            "by_model": by_model,
            "by_status": by_status,
        }

    def write_estimate(self, out_dir: Path | str) -> Path:
        path = Path(out_dir) / "cost_estimate.json"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(self.estimate(), ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        return path


def _estimate_tokens(text: str) -> int:
    return max(1, (len(text) + 3) // 4)


class LedgeredEmbedding:
    """``Embedding`` Protocol'ü — iç adaptörü (``GeminiEmbedding`` ya da ``FakeEmbedding``) ``CostLedger``
    kapısından geçirir (§6 kural 2): her ``embed`` çağrısından önce ``check_spend('embedding')`` (degraded →
    hiç çağrı yok; ücretli sağlayıcı ``paid_allowed=false`` iken → ``cap_blocked``), sonra bir ``llm_calls``
    satırı (``purpose='embedding'``, ``models.json`` ``embedding`` zincirinin modeli ve sağlayıcısı)."""

    purpose = "embedding"

    def __init__(self, inner: Embedding, ledger: CostLedger, *, chain: str = "embedding",
                 ref_table: str | None = None):
        self.inner = inner
        self.ledger = ledger
        self.chain = chain
        self.ref_table = ref_table
        self.model = ledger.chain(chain)[0]
        self.provider = ledger.model_info(self.model)["provider"]
        self.dims = int(getattr(inner, "dims", 0) or ledger.model_info(self.model).get("dims") or 0)

    def __getattr__(self, name: str) -> Any:  # iç adaptörün yardımcıları (ör. FakeEmbedding.calls)
        if name == "inner":
            raise AttributeError(name)
        return getattr(self.inner, name)

    def embed(self, texts: Sequence[str]) -> list[list[float]]:
        if isinstance(texts, str):
            raise TypeError("embed metin listesi bekler")
        if not texts:
            return []
        if getattr(self.inner, "available", True) is False:  # yapılandırma reddi: kapıya ve deftere gitmeden
            return self.inner.embed(list(texts))
        gate = self.ledger.gate(self.purpose)
        common = {"ref_table": self.ref_table}
        self.ledger.refuse_if_degraded(self.purpose, gate, model=self.model, **common)
        if self.ledger.is_paid(self.model) and not gate.get("paid_allowed", False):
            row = self.ledger.record(self.purpose, provider=self.provider, model=self.model, status="cap_blocked",
                                     **common)
            raise LedgerError(f"OGR-LLM-002 tavan ücretli embedding çağrısını engelledi (durum {gate.get('state')})",
                              [self.ledger._attempt(row)])
        tokens = sum(_estimate_tokens(t) for t in texts)
        try:
            vectors = self.inner.embed(list(texts))
        except AdapterError as exc:
            self.ledger.record(self.purpose, provider=self.provider, model=self.model, status="error",
                               error_code="embedding", tokens_in=tokens, **common)
            raise LedgerError(f"OGR-LLM-001 embedding başarısız: {exc.message}") from exc
        self.ledger.record(self.purpose, provider=self.provider, model=self.model, status="ok", tokens_in=tokens,
                           **common)
        return vectors
