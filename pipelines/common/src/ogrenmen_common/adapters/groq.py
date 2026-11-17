"""Groq adaptörü: sohbet (OpenAI uyumlu) ve Whisper transkripti (``/audio/transcriptions``).

Whisper konuşmacı ayırmaz; dönen ``{"segments": [{"t", "t_end", "text"}], "unlabeled": true}``
``LLMTranscriber`` tarafından ``diarize`` zinciriyle 2 dakikalık pencerelerde ÖĞRENCİ/EĞİTMEN
etiketlenir (§6.3).
"""

from __future__ import annotations

import time

import httpx

from .base import LLMRequest, LLMResult
from .http import classify_failure
from .openai_compat import OpenAICompatibleLLM
from .structured import api_model

BASE = "https://api.groq.com/openai/v1"


def seconds_to_ts(sec: float) -> str:
    s = max(0, int(sec))
    return f"{s // 3600:02d}:{(s % 3600) // 60:02d}:{s % 60:02d}"


class GroqLLM(OpenAICompatibleLLM):
    def __init__(self, api_key: str, *, base: str = BASE, transport: httpx.BaseTransport | None = None):
        super().__init__(api_key, base=base, provider_id="groq", transport=transport)

    def complete(self, request: LLMRequest) -> LLMResult:
        audio = [m for m in request.media if m.is_audio]
        if not audio:
            return super().complete(request)
        media = audio[0]
        started = time.monotonic()
        try:
            response = self.client.post(
                f"{self.base}/audio/transcriptions",
                files={"file": (media.name or "audio.wav", media.data, media.mime)},
                data={"model": api_model(request.model), "response_format": "verbose_json", "language": "tr",
                      "temperature": "0"},
                timeout=request.timeout_s)
        except httpx.TimeoutException as exc:
            return LLMResult.failure("timeout", detail=str(exc))
        except httpx.TransportError as exc:
            return LLMResult.failure("server", detail=f"ağ hatası: {exc}")
        latency = int((time.monotonic() - started) * 1000)
        if response.status_code >= 400:
            return classify_failure(response, latency_ms=latency)
        data = response.json()
        segments = [{"t": seconds_to_ts(s.get("start", 0)), "t_end": seconds_to_ts(s.get("end", 0)),
                     "text": str(s.get("text", "")).strip()} for s in data.get("segments") or []
                    if str(s.get("text", "")).strip()]
        duration = data.get("duration")
        payload = {"segments": segments, "unlabeled": True}
        return LLMResult(ok=True, text="", json=payload, tokens_in=0, tokens_out=0, latency_ms=latency,
                         audio_sec=int(round(duration)) if isinstance(duration, (int, float)) else None)
