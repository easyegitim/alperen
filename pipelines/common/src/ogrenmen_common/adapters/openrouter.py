"""OpenRouter adaptörü (``:free`` modeller; OpenAI uyumlu)."""

from __future__ import annotations

import httpx

from .openai_compat import OpenAICompatibleLLM

BASE = "https://openrouter.ai/api/v1"


class OpenRouterLLM(OpenAICompatibleLLM):
    def __init__(self, api_key: str, *, base: str = BASE, transport: httpx.BaseTransport | None = None):
        super().__init__(api_key, base=base, provider_id="openrouter", transport=transport,
                         extra_headers={"HTTP-Referer": "https://ogrenmen.easy", "X-Title": "Ogrenmen"})
