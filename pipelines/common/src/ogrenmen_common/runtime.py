"""Runtime — adaptör setini ortamdan kurar (``Runtime.from_env(dry_run)``; §6).

Kurallar:

* ``OGRENMEN_FAKES=1``, ``dry_run=True`` ya da ``adapters="fake"`` → **tüm** adaptörler sahte
  (ağ yok): ``JsonlDb`` (fixtures), ``FakeLLM``, ``FakeEmbedding``,
  ``LocalDirStorage``, ``FakeNotifier``; saat sabit
  (``OGRENMEN_NOW`` ya da fixture "şimdi"si).
* Gerçek kip (v2): pipeline'lar DB'ye doğrudan bağlanmaz (PLAN §12: ``service_role`` yalnız ``apps/worker``'da;
  P3/P5 HTTP servisleri gelene dek). ``SUPABASE_BATCH_JWT`` / ``SUPABASE_SERVICE_ROLE_KEY`` verilirse Runtime
  kurulmaz (``OGR-ADP-001``). Veritabanı, depolama ve embedding sahte kalır (uyarı yazılır); tek gerçek model yolu
  ``GROQ_API_KEY`` ile Groq Whisper STT'dir (Gemini/Groq-sohbet/OpenRouter/Cloudflare/Anthropic yolları yoktur;
  Claude yalnız ``packages/llm``'dedir).
* Embedding her iki kipte de ``LedgeredEmbedding`` ile ``CostLedger`` kapısından geçer
  (``purpose='embedding'`` ``llm_calls`` satırı, ``check_spend``).
* Depolama: ``out`` verilmezse her Runtime kendi geçici dizinini (``ogrenmen-storage-*``) kullanır ve
  ``close()`` onu siler — çalışmalar birbirinin nesnesini görmez (§2 determinizm).
* ``vision``/``ocr``/``transcriber`` her iki kipte de ``CostLedger`` üzerinden çalışır (tavan, düşüş,
  şema, ``llm_calls``); sahte kipte arkalarında ``FakeLLM`` vardır, böylece dry-run maliyet tahmini
  (``cost_estimate.json``) bu çağrıları da içerir.

Ortam değişkenleri: ``GROQ_API_KEY``; ``OGRENMEN_FIXTURES``, ``OGRENMEN_OUT``, ``OGRENMEN_ADAPTERS`` (fake|real).
"""

from __future__ import annotations

import os
import shutil
import sys
import tempfile
import weakref
from collections.abc import Mapping
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import ogrenmen_contracts as contracts

from .adapters.base import DB, LLM, OCR, Embedding, Notifier, Storage, Transcriber, Vision
from .adapters.media import LLMOCR, LLMTranscriber, LLMVision
from .batch import BatchRunner
from .clock import Clock, fake_clock_from_env
from .errors import AdapterError
from .fakes import (
    FakeEmbedding,
    FakeLLM,
    FakeNotifier,
    JsonlDb,
    LocalDirStorage,
)
from .ledger import CostLedger, LedgeredEmbedding
from .paths import fixtures_root

TRUTHY = ("1", "true", "yes", "on")


def fakes_forced(env: Mapping[str, str]) -> bool:
    return str(env.get("OGRENMEN_FAKES", "")).strip().lower() in TRUTHY


@dataclass
class Runtime:
    mode: str
    dry_run: bool
    db: DB
    llm: LLM
    embedding: Embedding
    vision: Vision
    transcriber: Transcriber
    ocr: OCR
    storage: Storage
    notifier: Notifier
    ledger: CostLedger
    batch: BatchRunner
    clock: Clock
    models: dict
    fixtures: Path | None = None
    out: Path | None = None
    warnings: list[str] = field(default_factory=list)
    storage_tmp: Path | None = None
    """``out`` yokken kullanılan geçici depolama dizini (``close()`` siler)."""

    def __post_init__(self) -> None:
        self._cleanup = (weakref.finalize(self, shutil.rmtree, str(self.storage_tmp), True)
                         if self.storage_tmp is not None else None)

    @property
    def is_fake(self) -> bool:
        return self.mode == "fake"

    def close(self) -> list[Path]:
        """JsonlDb'yi ``out``'a boşaltır ve (out varsa) ``cost_estimate.json`` yazar; yazılan yolları döner."""
        written: list[Path] = []
        if self.out is not None:
            flush = getattr(self.db, "flush", None)
            if callable(flush):
                written.extend(flush(self.out))
            written.append(self.ledger.write_estimate(self.out))
        if self._cleanup is not None:
            self._cleanup()
        return written

    @classmethod
    def from_env(cls, dry_run: bool = False, *, fixtures: Path | str | None = None, out: Path | str | None = None,
                 adapters: str | None = None, env: Mapping[str, str] | None = None,
                 llm_options: Mapping[str, Any] | None = None, quiet: bool = False) -> Runtime:
        env = dict(os.environ if env is None else env)
        choice = (adapters or env.get("OGRENMEN_ADAPTERS") or "real").strip().lower()
        if choice not in ("fake", "real"):
            raise ValueError("adapters fake | real olmalı")
        fixtures_path = Path(fixtures) if fixtures else (Path(env["OGRENMEN_FIXTURES"]) if env.get(
            "OGRENMEN_FIXTURES") else None)
        out_path = Path(out) if out else (Path(env["OGRENMEN_OUT"]) if env.get("OGRENMEN_OUT") else None)
        models = contracts.load_models()
        if dry_run or choice == "fake" or fakes_forced(env):
            return cls._fake(dry_run=dry_run, fixtures=fixtures_path, out=out_path, models=models,
                             llm_options=llm_options)
        return cls._real(env, fixtures=fixtures_path, out=out_path, models=models, llm_options=llm_options,
                         quiet=quiet)

    @classmethod
    def _fake(cls, *, dry_run: bool, fixtures: Path | None, out: Path | None, models: dict,
              llm_options: Mapping[str, Any] | None) -> Runtime:
        clock = fake_clock_from_env()
        db = JsonlDb.from_fixtures(fixtures, out_dir=out, clock=clock)
        llm = FakeLLM(**dict(llm_options or {}))
        notifier = FakeNotifier()
        ledger = CostLedger(db, llm, models=models, clock=clock, dry_run=True, notifier=notifier)
        storage, tmp = _local_storage(fixtures, out)
        return cls(mode="fake", dry_run=dry_run, db=db, llm=llm,
                   embedding=LedgeredEmbedding(FakeEmbedding(models=models), ledger), vision=LLMVision(ledger),
                   transcriber=LLMTranscriber(ledger), ocr=LLMOCR(ledger),
                   storage=storage, notifier=notifier, ledger=ledger,
                   batch=BatchRunner(ledger), clock=clock, models=models, fixtures=fixtures, out=out,
                   storage_tmp=tmp)

    @classmethod
    def _real(cls, env: dict[str, str], *, fixtures: Path | None, out: Path | None, models: dict,
              llm_options: Mapping[str, Any] | None, quiet: bool) -> Runtime:
        """v2: pipeline'lar DB'ye doğrudan bağlanmaz (PLAN §12; ``service_role`` yalnız ``apps/worker``'dadır).
        Veritabanı, depolama ve gömme sahtedir; tek gerçek model yolu Groq Whisper STT'dir
        (``GROQ_API_KEY``; satırlar yerel ``JsonlDb`` çıktısına yazılır). P3/P5 HTTP servisleri gelene dek böyle."""
        from .adapters.groq import GroqLLM
        from .adapters.notify import LogNotifier
        from .adapters.router import ProviderRouter

        if env.get("SUPABASE_BATCH_JWT") or env.get("SUPABASE_SERVICE_ROLE_KEY"):
            raise AdapterError("OGR-ADP-001 v2: pipelines DB'ye doğrudan yazmaz; worker HTTP servisi üzerinden "
                               "(SUPABASE_BATCH_JWT / service_role anahtarı pipeline ortamına verilmez; "
                               "--dry-run ya da OGRENMEN_FAKES=1 ile çalıştır)")

        warnings: list[str] = []

        def warn(text: str) -> None:
            warnings.append(text)
            if not quiet:
                print(f"UYARI: {text}", file=sys.stderr)

        clock: Clock = fake_clock_from_env(env)
        notifier: Notifier = LogNotifier()
        warn("v2: veritabanı, depolama ve embedding sahte (JsonlDb, yerel dizin); worker HTTP servisi henüz yok.")
        db: DB = JsonlDb.from_fixtures(fixtures, out_dir=out, clock=clock)
        storage, storage_tmp = _local_storage(fixtures, out)
        llm: LLM
        groq_key = env.get("GROQ_API_KEY")
        if groq_key:
            llm = ProviderRouter(models, {"groq": GroqLLM(groq_key)})
        else:
            warn("GROQ_API_KEY yok; sahte LLM (FakeLLM) kullanılıyor.")
            llm = FakeLLM(**dict(llm_options or {}))
        ledger = CostLedger(db, llm, models=models, clock=clock, dry_run=False, notifier=notifier)
        mode = "mixed"
        return cls(mode=mode, dry_run=False, db=db, llm=llm,
                   embedding=LedgeredEmbedding(FakeEmbedding(models=models), ledger), vision=LLMVision(ledger),
                   transcriber=LLMTranscriber(ledger), ocr=LLMOCR(ledger),
                   storage=storage, notifier=notifier, ledger=ledger,
                   batch=BatchRunner(ledger), clock=clock, models=models, fixtures=fixtures,
                   out=out, warnings=warnings, storage_tmp=storage_tmp)


def _local_storage(fixtures: Path | None, out: Path | None) -> tuple[LocalDirStorage, Path | None]:
    """``out/storage``; ``out`` yoksa bu Runtime'a özel geçici dizin (ikinci değer; ``close()`` siler)."""
    tmp = None if out is not None else Path(tempfile.mkdtemp(prefix="ogrenmen-storage-"))
    root = (out / "storage") if out is not None else tmp
    read_roots = [p for p in (fixtures, fixtures_root()) if p is not None]
    return LocalDirStorage(root, read_roots=read_roots), tmp
