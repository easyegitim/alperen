"""Ortak HTTP yardımcıları (httpx; ``transport`` enjeksiyonu testlerde ``httpx.MockTransport`` içindir).

Hiçbir test ağa çıkmaz: gerçek adaptörlerin testleri sahte taşıyıcıyla koşar, canlı denemeler
``@pytest.mark.live`` ile atlanır.
"""

from __future__ import annotations

import time
from typing import Any

import httpx

from .base import LLMResult

DEFAULT_TIMEOUT_S = 20.0
USER_AGENT = "ogrenmen-pipelines/0.1 (+https://ogrenmen.easy)"


def make_client(transport: httpx.BaseTransport | None = None, *, timeout_s: float = DEFAULT_TIMEOUT_S,
                headers: dict[str, str] | None = None) -> httpx.Client:
    base_headers = {"User-Agent": USER_AGENT}
    base_headers.update(headers or {})
    return httpx.Client(transport=transport, timeout=timeout_s, headers=base_headers)


def retry_after_ms(response: httpx.Response) -> int | None:
    raw = response.headers.get("retry-after")
    if raw is None:
        return None
    try:
        return int(float(raw) * 1000)
    except ValueError:
        return None


def classify_failure(response: httpx.Response, *, latency_ms: int = 0) -> LLMResult:
    """HTTP durumunu §5.6 hata türüne çevirir: 429 → rate_limited, 5xx → server, diğer 4xx → config."""
    code = response.status_code
    detail = response.text[:300]
    if code == 429:
        return LLMResult.failure("rate_limited", status=code, detail=detail, retry_after_ms=retry_after_ms(response),
                                 latency_ms=latency_ms)
    if code >= 500:
        return LLMResult.failure("server", status=code, detail=detail, latency_ms=latency_ms)
    return LLMResult.failure("config", status=code, detail=detail, latency_ms=latency_ms)


def post_json(client: httpx.Client, url: str, body: Any, *, headers: dict[str, str] | None = None,
              timeout_s: float | None = None) -> tuple[httpx.Response | None, LLMResult | None, int]:
    """POST; ``(yanıt, hata, gecikme_ms)`` — zaman aşımı/ağ hatası ``LLMResult`` olarak döner."""
    started = time.monotonic()
    try:
        response = client.post(url, json=body, headers=headers, timeout=timeout_s)
    except httpx.TimeoutException as exc:
        return None, LLMResult.failure("timeout", detail=str(exc), latency_ms=_ms(started)), _ms(started)
    except httpx.TransportError as exc:
        return None, LLMResult.failure("server", detail=f"ağ hatası: {exc}", latency_ms=_ms(started)), _ms(started)
    latency = _ms(started)
    if response.status_code >= 400:
        return response, classify_failure(response, latency_ms=latency), latency
    return response, None, latency


def _ms(started: float) -> int:
    return int((time.monotonic() - started) * 1000)
