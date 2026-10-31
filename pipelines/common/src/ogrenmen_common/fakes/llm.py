"""FakeLLM — ``fixtures/llm/<amaç>/*.json`` dosyalarından deterministik yanıt.

**Seçim kuralı (BLUEPRINT §2.3; Worker ``apps/worker/test/fakes/providers.ts`` ile birebir):**
klasördeki ``*.json`` dosyaları ada göre sıralanır (kod noktası sırası — ASCII adlarda JavaScript
``Array.prototype.sort()`` ile aynı), ``bad-schema*.json`` dışarıda bırakılır ve
``i = int(sha256(prompt_text)[:8], 16) mod n`` (``prompt_text`` UTF-8). ``bad-schema.json`` yalnız
``bad_output_every`` seçeneğiyle döner; ``fail_with`` belirli deneme sıralarında 429/500/zaman aşımı
üretir. ``fixture_hint`` verilirse (ses/PDF adı) adı bu parçayı içeren ilk dosya seçilir — bu
pipelines'a özgü kolaylıktır ve §2.3 kuralını değiştirmez (hint yoksa ya da eşleşmezse kural uygulanır).
"""

from __future__ import annotations

import hashlib
import io
import json
import wave
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from ..adapters.base import LLMRequest, LLMResult
from ..errors import FixtureNotFoundError
from ..paths import llm_fixtures_root

BAD_SCHEMA_PREFIX = "bad-schema"
IMAGE_TOKENS = 258
"""Görüntü başına giriş tokenı (Gemini belgelerindeki sabit; maliyet tahmini için)."""
AUDIO_TOKENS_PER_SEC = 32
"""Ses saniyesi başına giriş tokenı (Gemini)."""


def estimate_tokens(text: str) -> int:
    """Deterministik token tahmini: ~4 karakter = 1 token (en az 1)."""
    return max(1, (len(text) + 3) // 4)


def candidate_names(names: Sequence[str]) -> list[str]:
    """Seçime giren adlar: ``.json`` uzantılı, ``bad-schema*`` olmayan, ada göre sıralı."""
    return sorted(n for n in names if n.endswith(".json") and not n.startswith(BAD_SCHEMA_PREFIX))


def fixture_index(prompt_text: str, n: int) -> int:
    """§2.3: ``int(sha256(prompt_text)[:8], 16) mod n``."""
    if n <= 0:
        raise ValueError("n pozitif olmalı")
    return int(hashlib.sha256(prompt_text.encode("utf-8")).hexdigest()[:8], 16) % n


def candidates(folder: Path) -> list[Path]:
    """Klasörün seçime giren dosyaları (sıralı)."""
    if not folder.is_dir():
        raise FixtureNotFoundError(f"OGR-ADP-002 sahte LLM klasörü yok: {folder}")
    names = candidate_names([p.name for p in folder.iterdir() if p.is_file()])
    if not names:
        raise FixtureNotFoundError(f"OGR-ADP-002 sahte LLM klasörü boş: {folder}")
    return [folder / n for n in names]


def select_fixture(folder: Path, prompt_text: str, *, hint: str | None = None) -> Path:
    """Klasörden §2.3 kuralıyla (ya da ``hint`` eşleşmesiyle) tek dosya seçer."""
    files = candidates(folder)
    if hint:
        for path in files:
            if hint in path.stem:
                return path
    return files[fixture_index(prompt_text, len(files))]


def bad_schema_file(folder: Path) -> Path:
    files = sorted(p for p in folder.glob(f"{BAD_SCHEMA_PREFIX}*.json"))
    if not files:
        raise FixtureNotFoundError(f"OGR-ADP-002 {folder} içinde bad-schema*.json yok")
    return files[0]


def _status_error(status: int | str) -> tuple[str, int | None]:
    if status == "timeout":
        return "timeout", None
    code = int(status)
    if code == 429:
        return "rate_limited", 429
    if code >= 500:
        return "server", code
    return "config", code


def audio_seconds(data: bytes) -> int | None:
    """WAV başlığından süre (saniye, yukarı yuvarlanır); WAV değilse ``None``."""
    try:
        with wave.open(io.BytesIO(data)) as w:
            frames, rate = w.getnframes(), w.getframerate()
    except (wave.Error, EOFError):
        return None
    if rate <= 0:
        return None
    return max(1, -(-frames // rate))


@dataclass(frozen=True)
class FakeCall:
    """FakeLLM'e yapılmış tek çağrının kaydı."""

    index: int
    purpose: str
    folder: str
    model: str
    prompt_text: str
    file: str | None
    ok: bool
    error: str | None
    tokens_in: int
    tokens_out: int


class FakeLLM:
    """Deterministik LLM sahtesi (``LLM`` Protocol'ü).

    * ``fail_with`` — ``{429: [0], 500: [2], "timeout": [3]}``: çağrı sırası (0'dan) → hata.
    * ``fail_models`` — ``{"gemini-2.5-flash-lite": 429}``: bu modele her çağrı hata döner.
    * ``bad_output_every`` — N > 0 ise her N'inci çağrı (1'den sayılır) ``bad-schema.json`` döner.
    * ``bad_output_at`` — bu çağrı sıralarında (0'dan) ``bad-schema.json`` döner (onarım yolunu sınamak için).
    """

    name = "fake"

    def __init__(self, root: Path | None = None, *, fail_with: Mapping[int | str, Sequence[int]] | None = None,
                 fail_models: Mapping[str, int | str] | None = None, bad_output_every: int = 0,
                 bad_output_at: Sequence[int] = ()):
        self.root = Path(root) if root is not None else llm_fixtures_root()
        self._fail: dict[int, int | str] = {}
        for status, indices in (fail_with or {}).items():
            for i in indices:
                self._fail[int(i)] = status
        self.fail_models = dict(fail_models or {})
        if bad_output_every < 0:
            raise ValueError("bad_output_every negatif olamaz")
        self.bad_output_every = bad_output_every
        self.bad_output_at = {int(i) for i in bad_output_at}
        self.calls: list[FakeCall] = []

    def folder_for(self, request: LLMRequest) -> Path:
        return self.root / (request.fixture or request.purpose)

    def select(self, request: LLMRequest) -> Path:
        """Bu istek için seçilecek fixture (yan etkisiz; bad-schema/fail kurallarını içermez)."""
        return select_fixture(self.folder_for(request), request.prompt_text, hint=request.fixture_hint)

    def _usage_in(self, request: LLMRequest) -> tuple[int, int | None, int | None]:
        tokens = estimate_tokens(request.prompt_text)
        images = sum(1 for m in request.media if m.is_image)
        audio = None
        for m in request.media:
            if m.is_audio:
                sec = audio_seconds(m.data)
                if sec is not None:
                    audio = (audio or 0) + sec
        tokens += images * IMAGE_TOKENS + (audio or 0) * AUDIO_TOKENS_PER_SEC
        return tokens, (images or None), audio

    def complete(self, request: LLMRequest) -> LLMResult:
        index = len(self.calls)
        folder = self.folder_for(request)
        tokens_in, images, audio = self._usage_in(request)
        status = self._fail.get(index, self.fail_models.get(request.model))
        if status is not None:
            error, code = _status_error(status)
            self.calls.append(FakeCall(index, request.purpose, folder.name, request.model, request.prompt_text,
                                       None, False, error, 0, 0))
            retry = 60_000 if error == "rate_limited" else None
            return LLMResult.failure(error, status=code, detail=f"sahte hata {status}", retry_after_ms=retry)
        if index in self.bad_output_at or (self.bad_output_every and (index + 1) % self.bad_output_every == 0):
            path = bad_schema_file(folder)
        else:
            path = select_fixture(folder, request.prompt_text, hint=request.fixture_hint)
        data: Any = json.loads(path.read_text(encoding="utf-8"))
        text = json.dumps(data, ensure_ascii=False)
        tokens_out = estimate_tokens(text)
        self.calls.append(FakeCall(index, request.purpose, folder.name, request.model, request.prompt_text,
                                   path.name, True, None, tokens_in, tokens_out))
        return LLMResult(ok=True, text=text, json=data, tokens_in=tokens_in, tokens_out=tokens_out, latency_ms=0,
                         audio_sec=audio, images=images)

    def reset(self) -> None:
        self.calls.clear()
