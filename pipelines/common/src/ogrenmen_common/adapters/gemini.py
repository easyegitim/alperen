"""Gemini adaptörleri: ``GeminiLLM`` (generateContent; metin, görüntü, ses), ``GeminiEmbedding``
(batchEmbedContents, 768 Matryoshka) ve ``GeminiBatchClient`` (Batch API; %50 indirim).

Anahtar ``x-goog-api-key`` başlığıyla gider (URL'de değil; loglara sızmaz). Yapılandırılmış
çıktı ``responseMimeType=application/json`` + ``responseSchema`` (``ogrenmen_contracts.gemini_schema``).
"""

from __future__ import annotations

import base64
import math
from collections.abc import Mapping, Sequence
from typing import Any

import httpx

from ..errors import AdapterError
from .base import LLMRequest, LLMResult
from .http import make_client, post_json
from .structured import api_model, parse_json_text, provider_schema

BASE = "https://generativelanguage.googleapis.com/v1beta"


def build_generate_body(request: LLMRequest) -> dict[str, Any]:
    """generateContent gövdesi (Batch API satırları da aynı gövdeyi kullanır)."""
    parts: list[dict[str, Any]] = [{"text": request.prompt}]
    for m in request.media:
        parts.append({"inline_data": {"mime_type": m.mime, "data": base64.b64encode(m.data).decode("ascii")}})
    config: dict[str, Any] = {"maxOutputTokens": int(request.max_tokens), "temperature": float(request.temperature)}
    if request.schema_id:
        config["responseMimeType"] = "application/json"
        config["responseSchema"] = provider_schema(request.schema_id)
    body: dict[str, Any] = {"contents": [{"role": "user", "parts": parts}], "generationConfig": config}
    if request.system:
        body["systemInstruction"] = {"parts": [{"text": request.system}]}
    return body


def parse_generate_response(data: Mapping[str, Any], request: LLMRequest, *, latency_ms: int = 0) -> LLMResult:
    """generateContent yanıtı → ``LLMResult``; aday yoksa/engellendiyse ``bad_output``."""
    candidates = data.get("candidates") or []
    if not candidates:
        reason = (data.get("promptFeedback") or {}).get("blockReason", "aday yok")
        return LLMResult.failure("bad_output", detail=f"Gemini yanıtı boş: {reason}", latency_ms=latency_ms)
    content = candidates[0].get("content") or {}
    text = "".join(p.get("text", "") for p in content.get("parts") or [])
    usage = data.get("usageMetadata") or {}
    images = sum(1 for m in request.media if m.is_image) or None
    return LLMResult(ok=True, text=text, json=parse_json_text(text) if request.schema_id else None,
                     tokens_in=int(usage.get("promptTokenCount") or 0),
                     tokens_out=int(usage.get("candidatesTokenCount") or 0) + int(usage.get("thoughtsTokenCount") or 0),
                     latency_ms=latency_ms, images=images)


class GeminiLLM:
    """``LLM`` Protocol'ü — bir Gemini sağlayıcısı (``gemini-paid`` ya da ``gemini-free`` anahtarıyla)."""

    def __init__(self, api_key: str, *, base: str = BASE, provider_id: str = "gemini-paid",
                 transport: httpx.BaseTransport | None = None):
        if not api_key:
            raise AdapterError(f"OGR-ADP-001 {provider_id} anahtarı yok")
        self.provider_id = provider_id
        self.base = base.rstrip("/")
        self.client = make_client(transport, headers={"x-goog-api-key": api_key})

    def complete(self, request: LLMRequest) -> LLMResult:
        url = f"{self.base}/models/{api_model(request.model)}:generateContent"
        response, failure, latency = post_json(self.client, url, build_generate_body(request),
                                               timeout_s=request.timeout_s)
        if failure is not None:
            return failure
        assert response is not None
        return parse_generate_response(response.json(), request, latency_ms=latency)


class GeminiEmbedding:
    """``Embedding`` Protocol'ü — ``gemini-embedding-001``, ``outputDimensionality=768``; vektörler L2 birim."""

    def __init__(self, api_key: str, *, base: str = BASE, model: str = "gemini-embedding-001", dims: int = 768,
                 transport: httpx.BaseTransport | None = None):
        if not api_key:
            raise AdapterError("OGR-ADP-001 embedding anahtarı yok")
        self.base = base.rstrip("/")
        self.model = model
        self.dims = dims
        self.client = make_client(transport, headers={"x-goog-api-key": api_key})

    def embed(self, texts: Sequence[str]) -> list[list[float]]:
        if isinstance(texts, str):
            raise TypeError("embed metin listesi bekler")
        if not texts:
            return []
        body = {"requests": [{"model": f"models/{self.model}", "content": {"parts": [{"text": t}]},
                              "outputDimensionality": self.dims} for t in texts]}
        response, failure, _ = post_json(self.client, f"{self.base}/models/{self.model}:batchEmbedContents", body)
        if failure is not None:
            raise AdapterError(f"OGR-ADP-001 embedding başarısız: {failure.error} {failure.status or ''}".strip())
        assert response is not None
        out = []
        for item in response.json().get("embeddings", []):
            values = [float(v) for v in item.get("values", [])]
            norm = math.sqrt(sum(v * v for v in values)) or 1.0
            out.append([v / norm for v in values])
        if len(out) != len(texts):
            raise AdapterError("OGR-ADP-001 embedding yanıtı eksik")
        return out


BATCH_DONE = "BATCH_STATE_SUCCEEDED"
BATCH_FAILED = ("BATCH_STATE_FAILED", "BATCH_STATE_CANCELLED", "BATCH_STATE_EXPIRED")


class GeminiBatchClient:
    """Gemini Batch API: ``models/{m}:batchGenerateContent`` (satır içi istekler) → ``batches/{id}`` sorgusu."""

    def __init__(self, api_key: str, *, base: str = BASE, transport: httpx.BaseTransport | None = None):
        if not api_key:
            raise AdapterError("OGR-ADP-001 Batch için GEMINI_PAID_KEY gerekli")
        self.base = base.rstrip("/")
        self.client = make_client(transport, headers={"x-goog-api-key": api_key}, timeout_s=60.0)

    def create(self, model: str, items: Sequence[tuple[str, LLMRequest]], *, display_name: str) -> str:
        body = {"batch": {"display_name": display_name, "input_config": {"requests": {"requests": [
            {"request": build_generate_body(req), "metadata": {"key": key}} for key, req in items]}}}}
        response, failure, _ = post_json(self.client, f"{self.base}/models/{api_model(model)}:batchGenerateContent",
                                         body)
        if failure is not None:
            raise AdapterError(f"OGR-ADP-001 Batch gönderilemedi: {failure.error} {failure.status or ''}".strip())
        assert response is not None
        name = response.json().get("name")
        if not name:
            raise AdapterError("OGR-ADP-001 Batch yanıtında ad yok")
        return name

    def get(self, name: str) -> dict:
        try:
            r = self.client.get(f"{self.base}/{name}")
        except httpx.HTTPError as exc:
            raise AdapterError(f"OGR-ADP-001 Batch durumu okunamadı: {exc}") from exc
        if r.status_code != 200:
            raise AdapterError(f"OGR-ADP-001 Batch durumu HTTP {r.status_code}")
        return r.json()

    @staticmethod
    def state(batch: Mapping[str, Any]) -> str:
        meta = batch.get("metadata") or {}
        return str(meta.get("state") or batch.get("state") or "BATCH_STATE_PENDING")

    @staticmethod
    def inline_responses(batch: Mapping[str, Any]) -> list[tuple[str, Mapping[str, Any] | None, str | None]]:
        """``(anahtar, generateContent yanıtı | None, hata | None)`` listesi."""
        holders = [batch.get("response") or {}, (batch.get("metadata") or {}).get("output") or {},
                   batch.get("output") or {}]
        rows: list[Any] = []
        for h in holders:
            inl = h.get("inlinedResponses")
            if isinstance(inl, Mapping):
                inl = inl.get("inlinedResponses")
            if inl:
                rows = list(inl)
                break
        out = []
        for row in rows:
            key = str((row.get("metadata") or {}).get("key", ""))
            if row.get("error"):
                out.append((key, None, str(row["error"].get("message", row["error"]))))
            else:
                out.append((key, row.get("response") or {}, None))
        return out
