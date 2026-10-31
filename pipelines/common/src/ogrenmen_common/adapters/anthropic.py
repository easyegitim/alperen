"""Anthropic Messages API adaptörü (``claude-sonnet-4-5``; ``models.json``'da ``enabled=false``,
anahtar gelince açılır — §12 #24). Yapılandırılmış çıktı şeması prompt'a gömülür."""

from __future__ import annotations

import base64
from typing import Any

import httpx

from ..errors import AdapterError
from .base import LLMRequest, LLMResult
from .http import make_client, post_json
from .structured import parse_json_text, schema_instruction

BASE = "https://api.anthropic.com/v1"
VERSION = "2023-06-01"


class AnthropicLLM:
    def __init__(self, api_key: str, *, base: str = BASE, transport: httpx.BaseTransport | None = None):
        if not api_key:
            raise AdapterError("OGR-ADP-001 anthropic anahtarı yok")
        self.provider_id = "anthropic"
        self.base = base.rstrip("/")
        self.client = make_client(transport, headers={"x-api-key": api_key, "anthropic-version": VERSION})

    def complete(self, request: LLMRequest) -> LLMResult:
        if any(m.is_audio for m in request.media):
            return LLMResult.failure("config", detail="anthropic ses kabul etmez")
        text = request.prompt
        if request.schema_id:
            text = f"{text}\n\n{schema_instruction(request.schema_id)}"
        content: list[dict[str, Any]] = [{"type": "text", "text": text}]
        for m in request.media:
            content.append({"type": "image", "source": {"type": "base64", "media_type": m.mime,
                                                        "data": base64.b64encode(m.data).decode("ascii")}})
        body: dict[str, Any] = {"model": request.model, "max_tokens": int(request.max_tokens),
                                "temperature": float(request.temperature),
                                "messages": [{"role": "user", "content": content}]}
        if request.system:
            body["system"] = request.system
        response, failure, latency = post_json(self.client, f"{self.base}/messages", body, timeout_s=request.timeout_s)
        if failure is not None:
            return failure
        assert response is not None
        data = response.json()
        out = "".join(part.get("text", "") for part in data.get("content") or [] if part.get("type") == "text")
        usage = data.get("usage") or {}
        return LLMResult(ok=True, text=out, json=parse_json_text(out) if request.schema_id else None,
                         tokens_in=int(usage.get("input_tokens") or 0), tokens_out=int(usage.get("output_tokens") or 0),
                         latency_ms=latency)
