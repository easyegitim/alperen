"""ProviderRouter — model adını ``models.json`` sağlayıcısına göre doğru adaptöre yönlendirir.

Kendisi de ``LLM`` Protocol'üdür; ``available(model)`` anahtarı olmayan/kapalı sağlayıcıları
bildirir (``CostLedger`` bunları çağırmadan atlar — Worker'daki "anahtarı olmayan sağlayıcı
zincirden çıkar" kuralı).
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from .base import LLM, LLMRequest, LLMResult


class ProviderRouter:
    def __init__(self, models: Mapping[str, Any], adapters: Mapping[str, LLM]):
        self.models = models
        self.adapters = dict(adapters)

    def provider_of(self, model: str) -> str | None:
        info = (self.models.get("models") or {}).get(model)
        return info.get("provider") if info else None

    def available(self, model: str) -> bool:
        info = (self.models.get("models") or {}).get(model)
        if info is None or info.get("enabled") is False:
            return False
        provider = info.get("provider")
        pinfo = (self.models.get("providers") or {}).get(provider) or {}
        return pinfo.get("enabled") is not False and provider in self.adapters

    def complete(self, request: LLMRequest) -> LLMResult:
        provider = self.provider_of(request.model)
        adapter = self.adapters.get(provider or "")
        if adapter is None:
            return LLMResult.failure("config", detail=f"sağlayıcı yapılandırılmamış: {provider or request.model}")
        return adapter.complete(request)
