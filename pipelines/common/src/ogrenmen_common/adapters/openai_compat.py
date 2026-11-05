"""OpenAI uyumlu sohbet tamamlama adaptörü (Groq, OpenRouter): ``POST {base}/chat/completions``.

Yapılandırılmış çıktı ``response_format: {type: json_schema, json_schema: {name, schema}}``; sağlayıcı
bunu 400 ile reddederse aynı çağrı ``json_object`` + prompt'a gömülü şema ile bir kez yinelenir (§4).
"""

from __future__ import annotations

import base64
from typing import Any

import httpx

from ..errors import AdapterError
from .base import LLMRequest, LLMResult
from .http import make_client, post_json
from .structured import api_model, parse_json_text, provider_schema, schema_instruction, schema_title


def build_messages(request: LLMRequest, *, embed_schema: bool = False) -> list[dict[str, Any]]:
    prompt = request.prompt
    if embed_schema and request.schema_id:
        prompt = f"{prompt}\n\n{schema_instruction(request.schema_id)}"
    images = [m for m in request.media if m.is_image]
    if images:
        content: Any = [{"type": "text", "text": prompt}] + [
            {"type": "image_url", "image_url": {"url": f"data:{m.mime};base64,{base64.b64encode(m.data).decode()}"}}
            for m in images]
    else:
        content = prompt
    messages: list[dict[str, Any]] = []
    if request.system:
        messages.append({"role": "system", "content": request.system})
    messages.append({"role": "user", "content": content})
    return messages


class OpenAICompatibleLLM:
    """``LLM`` Protocol'ü; ``extra_headers`` OpenRouter'ın ``HTTP-Referer``/``X-Title`` başlıkları içindir."""

    def __init__(self, api_key: str, *, base: str, provider_id: str, transport: httpx.BaseTransport | None = None,
                 extra_headers: dict[str, str] | None = None):
        if not api_key:
            raise AdapterError(f"OGR-ADP-001 {provider_id} anahtarı yok")
        self.provider_id = provider_id
        self.base = base.rstrip("/")
        headers = {"Authorization": f"Bearer {api_key}"}
        headers.update(extra_headers or {})
        self.client = make_client(transport, headers=headers)

    def _body(self, request: LLMRequest, mode: str) -> dict[str, Any]:
        body: dict[str, Any] = {"model": api_model(request.model),
                                "messages": build_messages(request, embed_schema=(mode == "json_object")),
                                "max_tokens": int(request.max_tokens), "temperature": float(request.temperature)}
        if request.schema_id:
            if mode == "json_schema":
                body["response_format"] = {"type": "json_schema", "json_schema": {
                    "name": schema_title(request.schema_id), "schema": provider_schema(request.schema_id)}}
            else:
                body["response_format"] = {"type": "json_object"}
        return body

    def complete(self, request: LLMRequest) -> LLMResult:
        if any(m.is_audio for m in request.media):
            return LLMResult.failure("config", detail=f"{self.provider_id} sohbet ucu ses kabul etmez")
        modes = ["json_schema", "json_object"] if request.schema_id else ["text"]
        failure: LLMResult | None = None
        for mode in modes:
            response, failure, latency = post_json(self.client, f"{self.base}/chat/completions",
                                                   self._body(request, mode), timeout_s=request.timeout_s)
            if failure is not None:
                if failure.status == 400 and mode == "json_schema":
                    continue
                return failure
            assert response is not None
            data = response.json()
            choices = data.get("choices") or []
            if not choices:
                return LLMResult.failure("bad_output", detail="yanıtta seçenek yok", latency_ms=latency)
            text = (choices[0].get("message") or {}).get("content") or ""
            usage = data.get("usage") or {}
            return LLMResult(ok=True, text=text, json=parse_json_text(text) if request.schema_id else None,
                             tokens_in=int(usage.get("prompt_tokens") or 0),
                             tokens_out=int(usage.get("completion_tokens") or 0), latency_ms=latency)
        assert failure is not None
        return failure
