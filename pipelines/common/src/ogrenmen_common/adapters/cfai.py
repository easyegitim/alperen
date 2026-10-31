"""Cloudflare Workers AI REST adaptörü: ``POST {rest_base}/{model}`` (``CF_AI_TOKEN`` + ``CF_ACCOUNT_ID``).

Yanıt ``{"success", "result": {"response", "usage"}}``; ``response`` metin ya da (json_schema ile) nesne.
Neuron sayımı ``models.json`` ``neurons_per_1k_tokens`` ile ``CostLedger``'dadır.
"""

from __future__ import annotations

import json
from typing import Any

import httpx

from ..errors import AdapterError
from .base import LLMRequest, LLMResult
from .http import make_client, post_json
from .openai_compat import build_messages
from .structured import parse_json_text, provider_schema

REST_BASE = "https://api.cloudflare.com/client/v4/accounts/{account}/ai/run"


class CloudflareAILLM:
    def __init__(self, token: str, account_id: str, *, rest_base: str = REST_BASE,
                 transport: httpx.BaseTransport | None = None):
        if not token or not account_id:
            raise AdapterError("OGR-ADP-001 cf-ai için CF_AI_TOKEN ve CF_ACCOUNT_ID gerekli")
        self.provider_id = "cf-ai"
        self.base = rest_base.replace("{account}", account_id).rstrip("/")
        self.client = make_client(transport, headers={"Authorization": f"Bearer {token}"})

    def complete(self, request: LLMRequest) -> LLMResult:
        if request.media:
            return LLMResult.failure("config", detail="cf-ai bu zincirde medya kabul etmez")
        body: dict[str, Any] = {"messages": build_messages(request), "max_tokens": int(request.max_tokens),
                                "temperature": float(request.temperature)}
        if request.schema_id:
            body["response_format"] = {"type": "json_schema", "json_schema": provider_schema(request.schema_id)}
        response, failure, latency = post_json(self.client, f"{self.base}/{request.model.lstrip('/')}", body,
                                               timeout_s=request.timeout_s)
        if failure is not None:
            return failure
        assert response is not None
        data = response.json()
        if not data.get("success", True):
            return LLMResult.failure("server", detail=json.dumps(data.get("errors"))[:300], latency_ms=latency)
        result = data.get("result") or {}
        raw = result.get("response")
        if isinstance(raw, (dict, list)):
            text, parsed = json.dumps(raw, ensure_ascii=False), raw
        else:
            text = str(raw or "")
            parsed = parse_json_text(text) if request.schema_id else None
        usage = result.get("usage") or {}
        return LLMResult(ok=True, text=text, json=parsed, tokens_in=int(usage.get("prompt_tokens") or 0),
                         tokens_out=int(usage.get("completion_tokens") or 0), latency_ms=latency)
