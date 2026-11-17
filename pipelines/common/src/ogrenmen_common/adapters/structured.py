"""Yapılandırılmış çıktı yardımcıları: sağlayıcıya verilecek şema ve yanıt metninden JSON ayıklama."""

from __future__ import annotations

import json
import re
from typing import Any

import ogrenmen_contracts as contracts

_FENCE = re.compile(r"^```(?:json)?\s*(.*?)\s*```$", re.S)


def provider_schema(schema_spec: str) -> dict:
    """Gemini ``responseSchema`` / OpenAI ``json_schema`` için düzleştirilmiş şema (``"<ad>[]"`` → dizi)."""
    if schema_spec.endswith("[]"):
        return {"type": "array", "items": contracts.gemini_schema(schema_spec[:-2])}
    return contracts.gemini_schema(schema_spec)


def schema_title(schema_spec: str) -> str:
    """OpenAI ``json_schema.name`` (``^[a-zA-Z0-9_-]+$``)."""
    return re.sub(r"[^a-zA-Z0-9_-]", "_", schema_spec.replace("[]", "_list"))


def parse_json_text(text: str) -> Any:
    """Model metni → JSON; kod çiti (```json … ```) temizlenir; çözülemezse ``None``."""
    if not text:
        return None
    body = text.strip()
    m = _FENCE.match(body)
    if m:
        body = m.group(1)
    try:
        return json.loads(body)
    except json.JSONDecodeError:
        return None


def schema_instruction(schema_spec: str) -> str:
    """Yerel ``response_format`` desteği olmayan sağlayıcılar için prompt'a gömülen şema talimatı."""
    return ("Yalnızca aşağıdaki JSON şemasına uygun JSON döndür; açıklama ya da kod çiti ekleme.\n"
            + json.dumps(provider_schema(schema_spec), ensure_ascii=False))


def api_model(model_key: str) -> str:
    """models.json anahtarı → sağlayıcı model adı (``gemini-2.5-flash@free`` → ``gemini-2.5-flash``)."""
    return model_key[: -len("@free")] if model_key.endswith("@free") else model_key
