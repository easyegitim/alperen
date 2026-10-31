"""Adaptör sözleşmeleri (``typing.Protocol``, ``runtime_checkable``) ve ortak veri tipleri.

Her dış servis bu arayüzlerden birinin arkasındadır; gerçek uygulama ``adapters/<servis>.py``,
deterministik sahtesi ``ogrenmen_common.fakes``'tedir. Pipelines yalnız bu arayüzleri görür
(BLUEPRINT §6): ``LLM``, ``Embedding``, ``Vision``, ``Transcriber``, ``OCR``, ``Scholar``,
``DOIResolver``, ``OAResolver``, ``DB``, ``Storage``, ``Notifier``.

``LLMRequest``/``LLMResult`` Worker'daki ``Provider.complete`` imzasının (§5.6) Python eşleniğidir:
hata türleri ``rate_limited | server | timeout | bad_output | config``.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Protocol, runtime_checkable

LLM_ERRORS = ("rate_limited", "server", "timeout", "bad_output", "config")
"""``LLMResult.error`` değerleri (Worker ``Provider`` ile aynı küme)."""

LLM_PURPOSES = (
    "chat",
    "nightly_facts",
    "weekly_summary",
    "question_gen",
    "vision_check",
    "ocr",
    "lesson_analysis",
    "transcribe",
    "diarize",
    "research",
    "embedding",
    "query_expand",
    "tts",
)
"""``llm_calls.purpose`` check kısıtındaki değerler (§3.5)."""


@dataclass(frozen=True)
class Media:
    """İsteğe eklenen ikili içerik (şekil PNG'si, sayfa görüntüsü, ses)."""

    data: bytes
    mime: str
    name: str = ""

    @property
    def is_audio(self) -> bool:
        return self.mime.startswith("audio/")

    @property
    def is_image(self) -> bool:
        return self.mime.startswith("image/")


@dataclass(frozen=True)
class LLMRequest:
    """Tek model çağrısı.

    * ``purpose`` — ``llm_calls.purpose`` (ör. ``nightly_facts``); sahte LLM bu adı
      ``fixtures/llm/<purpose>`` klasörü olarak kullanır (``fixture`` verilmezse).
    * ``schema_id`` — yapılandırılmış çıktı sözleşmesi (``packages/contracts``); doğrulama
      ``CostLedger``'dadır.
    * ``fixture`` — sahte LLM klasörünü değiştirir (ör. ``chat_group``).
    * ``fixture_hint`` — sahte LLM'de adı bu parçayı içeren fixture seçilir (ör. ses dosyası
      ``lesson-01``); eşleşme yoksa §2.3 kuralı. Gerçek sağlayıcılar yok sayar.
    """

    purpose: str
    model: str
    prompt: str
    system: str = ""
    schema_id: str | None = None
    max_tokens: int = 2048
    temperature: float = 0.2
    timeout_s: float = 60.0
    media: tuple[Media, ...] = ()
    fixture: str | None = None
    fixture_hint: str | None = None

    @property
    def prompt_text(self) -> str:
        """Sağlayıcıya giden tam metin (sistem + kullanıcı); sahte seçim kuralının girdisi."""
        return f"{self.system}\n\n{self.prompt}" if self.system else self.prompt

    def with_model(self, model: str) -> LLMRequest:
        return _replace(self, model=model)

    def with_prompt(self, prompt: str) -> LLMRequest:
        return _replace(self, prompt=prompt)


def _replace(obj: LLMRequest, **changes: Any) -> LLMRequest:
    from dataclasses import replace

    return replace(obj, **changes)


@dataclass
class LLMResult:
    """Sağlayıcı yanıtı; ``ok=False`` iken ``error`` ``LLM_ERRORS``'tan biridir."""

    ok: bool
    text: str = ""
    json: Any = None
    tokens_in: int = 0
    tokens_out: int = 0
    latency_ms: int = 0
    error: str | None = None
    status: int | None = None
    retry_after_ms: int | None = None
    error_detail: str | None = None
    audio_sec: int | None = None
    images: int | None = None

    @staticmethod
    def failure(error: str, *, status: int | None = None, detail: str | None = None, retry_after_ms: int | None = None,
                latency_ms: int = 0) -> LLMResult:
        if error not in LLM_ERRORS:
            raise ValueError(f"bilinmeyen LLM hata türü: {error}")
        return LLMResult(ok=False, error=error, status=status, error_detail=detail, retry_after_ms=retry_after_ms,
                         latency_ms=latency_ms)


@dataclass(frozen=True)
class ScholarRecord:
    """Akademik arama sonucu (OpenAlex / Semantic Scholar / arXiv ortak biçimi)."""

    title: str
    authors: tuple[str, ...]
    year: int | None
    doi: str | None
    venue: str | None
    cited_by: int
    source: str
    abstract: str | None = None
    oa_pdf_url: str | None = None
    tldr: str | None = None
    external_id: str | None = None

    def as_dict(self) -> dict[str, Any]:
        return {
            "title": self.title,
            "authors": list(self.authors),
            "year": self.year,
            "doi": self.doi,
            "venue": self.venue,
            "cited_by": self.cited_by,
            "source": self.source,
            "abstract": self.abstract,
            "oa_pdf_url": self.oa_pdf_url,
            "tldr": self.tldr,
            "external_id": self.external_id,
        }


@dataclass
class Filter:
    """Tek sütun koşulu (PostgREST işleçleriyle aynı adlar)."""

    op: str
    value: Any = None

    OPS = ("eq", "neq", "gt", "gte", "lt", "lte", "in", "is", "not_is", "cs")


def eq(v: Any) -> Filter:
    return Filter("eq", v)


def neq(v: Any) -> Filter:
    return Filter("neq", v)


def gt(v: Any) -> Filter:
    return Filter("gt", v)


def gte(v: Any) -> Filter:
    return Filter("gte", v)


def lt(v: Any) -> Filter:
    return Filter("lt", v)


def lte(v: Any) -> Filter:
    return Filter("lte", v)


def in_(values: Sequence[Any]) -> Filter:
    return Filter("in", list(values))


def is_null() -> Filter:
    return Filter("is", None)


def not_null() -> Filter:
    return Filter("not_is", None)


def contains(values: Sequence[Any]) -> Filter:
    """Dizi sütunu verilen elemanların hepsini içeriyor mu (PostgREST ``cs``)."""
    return Filter("cs", list(values))


Where = Mapping[str, Any]
"""``{"sütun": değer | Filter}``; düz değer ``eq``, liste/demet ``in`` anlamındadır."""


@runtime_checkable
class LLM(Protocol):
    """Metin/yapılandırılmış çıktı üreten model sağlayıcısı."""

    def complete(self, request: LLMRequest) -> LLMResult: ...


@runtime_checkable
class Embedding(Protocol):
    """Metin → ``dims`` boyutlu vektör (Gemini embedding 768)."""

    dims: int

    def embed(self, texts: Sequence[str]) -> list[list[float]]: ...


@runtime_checkable
class Vision(Protocol):
    """Şekil denetimi: PNG + kök değerleri → ``figure-render-report``."""

    def check_figure(self, image: bytes, *, stem: str, stem_values: Mapping[str, Any], alt_text: str = "") -> dict: ...


@runtime_checkable
class Transcriber(Protocol):
    """Ses dosyası → ``transcript`` (``{"segments": [{"t", "speaker", "text"}]}``)."""

    def transcribe(self, audio: Path, *, language: str = "tr") -> dict: ...


@runtime_checkable
class OCR(Protocol):
    """Sınav sayfası görüntüleri → ``exam-item`` listesi (``meta``: source_id, year, term, instructor_alias)."""

    def extract_items(self, pages: Sequence[bytes], *, meta: Mapping[str, Any]) -> list[dict]: ...


@runtime_checkable
class Scholar(Protocol):
    """Akademik arama (OpenAlex, Semantic Scholar, arXiv)."""

    source: str

    def search(self, query: str, *, limit: int = 30) -> list[ScholarRecord]: ...


@runtime_checkable
class DOIResolver(Protocol):
    """DOI → Crossref ``message`` nesnesi; çözülmezse (404) ``None``."""

    def resolve(self, doi: str) -> dict | None: ...


@runtime_checkable
class OAResolver(Protocol):
    """DOI → açık erişim bilgisi ``{"doi", "is_oa", "pdf_url"}``; kayıt yoksa ``None``."""

    def lookup(self, doi: str) -> dict | None: ...


@runtime_checkable
class DB(Protocol):
    """batch_worker rolüyle veritabanı (PostgREST ya da JsonlDb)."""

    def select(self, table: str, *, where: Where | None = None, columns: Sequence[str] | None = None,
               order: str | Sequence[str] | None = None, limit: int | None = None) -> list[dict]: ...

    def insert(self, table: str, rows: Mapping[str, Any] | Sequence[Mapping[str, Any]], *,
               on_conflict: str | None = None) -> list[dict]: ...

    def update(self, table: str, values: Mapping[str, Any], *, where: Where) -> list[dict]: ...

    def delete(self, table: str, *, where: Where) -> int: ...

    def rpc(self, name: str, params: Mapping[str, Any] | None = None) -> Any: ...


@runtime_checkable
class Storage(Protocol):
    """Nesne deposu (Supabase Storage ya da yerel dizin)."""

    def upload(self, bucket: str, path: str, data: bytes, *, content_type: str = "application/octet-stream") -> str: ...

    def download(self, bucket: str, path: str) -> bytes: ...

    def remove(self, bucket: str, path: str) -> None: ...

    def exists(self, bucket: str, path: str) -> bool: ...

    def public_url(self, bucket: str, path: str) -> str: ...


@runtime_checkable
class Notifier(Protocol):
    """Kurucuya/operasyona kısa bildirim (Telegram DM ya da stdout)."""

    def notify(self, text: str, *, level: str = "info") -> None: ...


PROTOCOLS: dict[str, type] = {
    "LLM": LLM,
    "Embedding": Embedding,
    "Vision": Vision,
    "Transcriber": Transcriber,
    "OCR": OCR,
    "Scholar": Scholar,
    "DOIResolver": DOIResolver,
    "OAResolver": OAResolver,
    "DB": DB,
    "Storage": Storage,
    "Notifier": Notifier,
}
"""Ad → Protocol (selftest ve sözleşme testleri bunu dolaşır)."""


def protocol_methods(proto: type) -> list[str]:
    """Protocol'ün çağrılabilir üyeleri (sözleşme testleri imza karşılaştırması için)."""
    names = []
    for name, value in vars(proto).items():
        if name.startswith("_") or not callable(value):
            continue
        names.append(name)
    return sorted(names)


@dataclass
class Usage:
    """Bir adaptör çağrısının maliyete esas kullanımı (CostLedger.record)."""

    tokens_in: int = 0
    tokens_out: int = 0
    audio_sec: int | None = None
    images: int | None = None
    latency_ms: int = 0
    extra: dict[str, Any] = field(default_factory=dict)
