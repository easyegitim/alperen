"""Runtime — adaptör setini ortamdan kurar (``Runtime.from_env(dry_run)``; §6).

Kurallar:

* ``OGRENMEN_FAKES=1``, ``dry_run=True`` ya da ``adapters="fake"`` → **tüm** adaptörler sahte
  (ağ yok): ``JsonlDb`` (fixtures), ``FakeLLM``, ``FakeEmbedding``, ``FakeScholar``/``FakeArxiv``,
  ``FakeCrossref``, ``FakeUnpaywall``, ``LocalDirStorage``, ``FakeNotifier``; saat sabit
  (``OGRENMEN_NOW`` ya da fixture "şimdi"si).
* Aksi hâlde her adaptör anahtarına bakar; anahtar yoksa o adaptör sahteye düşer ve ``warnings``'e
  (stderr'e de) Türkçe bir uyarı yazılır — sessiz düşüş yoktur. **Veritabanı ile model adaptörleri
  birlikte gerçek ya da birlikte sahtedir** (``OGR-ADP-001``):

  - gerçek veritabanı (``SUPABASE_URL`` + ``SUPABASE_BATCH_JWT``) varken hiçbir model anahtarı yoksa
    Runtime kurulmaz — fixture çıktıları üretim tablolarına "gerçekmiş gibi" yazılmaz, sahte çağrılar
    gerçek fiyatlarla ``llm_calls``/``spend_ledger``'a girmez;
  - bir model anahtarı varken gerçek veritabanı yoksa Runtime kurulmaz — ücretli çağrı gerçek defter ve
    ``check_spend`` tavanı olmadan yapılmaz (ilke 2 ve 3);
  - embedding yalnız ``models.json`` ``chains.embedding`` modelinin sağlayıcısının anahtarıyla
    (``gemini-paid`` → ``GEMINI_PAID_KEY``; ücretsiz katman veriyle eğitir, §9.1) gerçektir; anahtar yoksa
    gerçek veritabanıyla sahte vektör yazılmaz — ``embed`` çağrısı ``OGR-ADP-001`` ile reddedilir.
* Embedding her iki kipte de ``LedgeredEmbedding`` ile ``CostLedger`` kapısından geçer
  (``purpose='embedding'`` ``llm_calls`` satırı, ``check_spend``).
* Depolama: ``out`` verilmezse her Runtime kendi geçici dizinini (``ogrenmen-storage-*``) kullanır ve
  ``close()`` onu siler — çalışmalar birbirinin nesnesini görmez (§2 determinizm).
* ``vision``/``ocr``/``transcriber`` her iki kipte de ``CostLedger`` üzerinden çalışır (tavan, düşüş,
  şema, ``llm_calls``); sahte kipte arkalarında ``FakeLLM`` vardır, böylece dry-run maliyet tahmini
  (``cost_estimate.json``) bu çağrıları da içerir.

Ortam değişkenleri (§8.2): ``SUPABASE_URL``, ``SUPABASE_ANON_KEY``, ``SUPABASE_BATCH_JWT``,
``GEMINI_PAID_KEY``, ``GEMINI_FREE_KEY``, ``GROQ_KEY``, ``OPENROUTER_KEY``, ``CF_AI_TOKEN`` +
``CF_ACCOUNT_ID``, ``ANTHROPIC_KEY``, ``UNPAYWALL_EMAIL``, ``S2_API_KEY``, ``TELEGRAM_OPS_BOT_TOKEN`` +
``ADMIN_CHAT_ID``; ``OGRENMEN_FIXTURES``, ``OGRENMEN_OUT``, ``OGRENMEN_ADAPTERS`` (fake|real).
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

from .adapters.base import DB, LLM, OCR, Embedding, Notifier, OAResolver, Scholar, Storage, Transcriber, Vision
from .adapters.base import DOIResolver as DOIResolverProto
from .adapters.media import LLMOCR, LLMTranscriber, LLMVision
from .batch import BatchRunner
from .clock import Clock, fake_clock_from_env, system_clock
from .errors import AdapterError
from .fakes import (
    FakeArxiv,
    FakeCrossref,
    FakeEmbedding,
    FakeLLM,
    FakeNotifier,
    FakeScholar,
    FakeUnpaywall,
    JsonlDb,
    LocalDirStorage,
)
from .ledger import CostLedger, LedgeredEmbedding
from .paths import fixtures_root

TRUTHY = ("1", "true", "yes", "on")
PROVIDER_KEY_ENV = {"gemini-paid": "GEMINI_PAID_KEY", "gemini-free": "GEMINI_FREE_KEY"}
"""Embedding sağlayıcısı → anahtar değişkeni (``models.json`` sağlayıcısı belirler)."""


class RefusingEmbedding:
    """Gerçek veritabanı varken embedding anahtarı yoksa: sahte (hash) vektör üretim tablolarına yazılmasın diye
    her ``embed`` çağrısını ``OGR-ADP-001`` ile reddeder (``Embedding`` Protocol'ünü karşılar)."""

    available = False

    def __init__(self, model: str, dims: int, reason: str):
        self.model = model
        self.dims = dims
        self.reason = reason

    def embed(self, texts):  # noqa: ANN001 - Protocol imzası
        raise AdapterError(f"OGR-ADP-001 {self.reason}")


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
    scholars: list[Scholar]
    doi: DOIResolverProto
    oa: OAResolver
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

    def scholar(self, source: str) -> Scholar:
        for s in self.scholars:
            if s.source == source:
                return s
        raise KeyError(f"tanımsız akademik kaynak: {source}")

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
                   scholars=[FakeScholar(source="openalex"), FakeScholar(source="semantic_scholar"), FakeArxiv()],
                   doi=FakeCrossref(), oa=FakeUnpaywall(), storage=storage, notifier=notifier, ledger=ledger,
                   batch=BatchRunner(ledger), clock=clock, models=models, fixtures=fixtures, out=out,
                   storage_tmp=tmp)

    @classmethod
    def _real(cls, env: dict[str, str], *, fixtures: Path | None, out: Path | None, models: dict,
              llm_options: Mapping[str, Any] | None, quiet: bool) -> Runtime:
        from .adapters.anthropic import AnthropicLLM
        from .adapters.arxiv import ArxivScholar
        from .adapters.cfai import CloudflareAILLM
        from .adapters.crossref import CrossrefResolver
        from .adapters.gemini import GeminiBatchClient, GeminiEmbedding, GeminiLLM
        from .adapters.groq import GroqLLM
        from .adapters.openalex import OpenAlexScholar
        from .adapters.openrouter import OpenRouterLLM
        from .adapters.postgrest import PostgrestDb
        from .adapters.router import ProviderRouter
        from .adapters.semanticscholar import SemanticScholar
        from .adapters.storage import SupabaseStorage
        from .adapters.telegram_notify import TelegramNotifier
        from .adapters.unpaywall import UnpaywallResolver

        warnings: list[str] = []

        def warn(text: str) -> None:
            warnings.append(text)
            if not quiet:
                print(f"UYARI: {text}", file=sys.stderr)

        clock: Clock = system_clock
        url, jwt, anon = env.get("SUPABASE_URL"), env.get("SUPABASE_BATCH_JWT"), env.get("SUPABASE_ANON_KEY")
        real_db = bool(url and jwt)
        storage_tmp: Path | None = None
        if env.get("TELEGRAM_OPS_BOT_TOKEN") and env.get("ADMIN_CHAT_ID"):
            notifier: Notifier = TelegramNotifier(env["TELEGRAM_OPS_BOT_TOKEN"], env["ADMIN_CHAT_ID"])
        else:
            notifier = FakeNotifier()

        adapters_by_provider: dict[str, LLM] = {}
        if env.get("GEMINI_PAID_KEY"):
            adapters_by_provider["gemini-paid"] = GeminiLLM(env["GEMINI_PAID_KEY"], provider_id="gemini-paid")
        if env.get("GEMINI_FREE_KEY"):
            adapters_by_provider["gemini-free"] = GeminiLLM(env["GEMINI_FREE_KEY"], provider_id="gemini-free")
        if env.get("GROQ_KEY"):
            adapters_by_provider["groq"] = GroqLLM(env["GROQ_KEY"])
        if env.get("OPENROUTER_KEY"):
            adapters_by_provider["openrouter"] = OpenRouterLLM(env["OPENROUTER_KEY"])
        if env.get("CF_AI_TOKEN") and env.get("CF_ACCOUNT_ID"):
            rest = (models["providers"].get("cf-ai") or {}).get("rest_base")
            kwargs = {"rest_base": rest} if rest else {}
            adapters_by_provider["cf-ai"] = CloudflareAILLM(env["CF_AI_TOKEN"], env["CF_ACCOUNT_ID"], **kwargs)
        if env.get("ANTHROPIC_KEY"):
            adapters_by_provider["anthropic"] = AnthropicLLM(env["ANTHROPIC_KEY"])
        if real_db and not adapters_by_provider:
            raise AdapterError("OGR-ADP-001 gerçek veritabanıyla sahte model kullanılmaz: SUPABASE_URL/"
                               "SUPABASE_BATCH_JWT var ama hiçbir model anahtarı yok (anahtarları ekle ya da "
                               "--dry-run ile çalıştır)")
        if adapters_by_provider and not real_db:
            raise AdapterError("OGR-ADP-001 gerçek model çağrısı gerçek maliyet defteri ve tavan olmadan yapılmaz: "
                               f"{', '.join(sorted(adapters_by_provider))} anahtarı var ama SUPABASE_URL/"
                               "SUPABASE_BATCH_JWT yok (ikisini ekle ya da --dry-run ile çalıştır)")
        if real_db:
            db: DB = PostgrestDb(url, jwt, anon_key=anon)
            storage: Storage = SupabaseStorage(url, jwt, anon_key=anon)
        else:
            warn("SUPABASE_URL/SUPABASE_BATCH_JWT yok; veritabanı ve depolama sahte (JsonlDb, yerel dizin).")
            clock = fake_clock_from_env(env)
            db = JsonlDb.from_fixtures(fixtures, out_dir=out, clock=clock)
            storage, storage_tmp = _local_storage(fixtures, out)
        llm: LLM
        if adapters_by_provider:
            llm = ProviderRouter(models, adapters_by_provider)
        else:
            warn("Hiçbir model anahtarı yok; sahte LLM (FakeLLM) kullanılıyor.")
            llm = FakeLLM(**dict(llm_options or {}))
        embed_model = models["chains"]["embedding"][0]
        embed_info = models["models"][embed_model]
        embed_dims = int(embed_info.get("dims") or 0)
        key_env = PROVIDER_KEY_ENV.get(embed_info["provider"])
        embed_key = env.get(key_env) if key_env else None
        inner: Embedding
        if not real_db:
            warn("Embedding sahte (veritabanı sahte).")
            inner = FakeEmbedding(models=models)
        elif embed_key:
            inner = GeminiEmbedding(embed_key, model=embed_model, dims=embed_dims)
        else:
            reason = (f"embedding anahtarı ({key_env or embed_info['provider']}) yok; gerçek veritabanına sahte "
                      "vektör yazılmaz")
            warn(reason[0].upper() + reason[1:] + "; embed çağrıları reddedilecek.")
            inner = RefusingEmbedding(embed_model, embed_dims, reason)
        mail = env.get("UNPAYWALL_EMAIL")
        scholars: list[Scholar] = [OpenAlexScholar(mailto=mail), SemanticScholar(api_key=env.get("S2_API_KEY")),
                                   ArxivScholar()]
        doi: DOIResolverProto = CrossrefResolver(mailto=mail)
        if mail:
            oa: OAResolver = UnpaywallResolver(email=mail)
        else:
            warn("UNPAYWALL_EMAIL yok; açık erişim sorgusu sahte.")
            oa = FakeUnpaywall()
        ledger = CostLedger(db, llm, models=models, clock=clock, dry_run=False, notifier=notifier)
        batch_client = GeminiBatchClient(env["GEMINI_PAID_KEY"]) if env.get("GEMINI_PAID_KEY") else None
        mode = "real" if real_db else "mixed"
        return cls(mode=mode, dry_run=False, db=db, llm=llm, embedding=LedgeredEmbedding(inner, ledger),
                   vision=LLMVision(ledger), transcriber=LLMTranscriber(ledger), ocr=LLMOCR(ledger),
                   scholars=scholars, doi=doi, oa=oa, storage=storage, notifier=notifier, ledger=ledger,
                   batch=BatchRunner(ledger, client=batch_client), clock=clock, models=models, fixtures=fixtures,
                   out=out, warnings=warnings, storage_tmp=storage_tmp)


def _local_storage(fixtures: Path | None, out: Path | None) -> tuple[LocalDirStorage, Path | None]:
    """``out/storage``; ``out`` yoksa bu Runtime'a özel geçici dizin (ikinci değer; ``close()`` siler)."""
    tmp = None if out is not None else Path(tempfile.mkdtemp(prefix="ogrenmen-storage-"))
    root = (out / "storage") if out is not None else tmp
    read_roots = [p for p in (fixtures, fixtures_root()) if p is not None]
    return LocalDirStorage(root, read_roots=read_roots), tmp
