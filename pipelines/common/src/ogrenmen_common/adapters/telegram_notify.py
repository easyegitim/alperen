"""Operasyon bildirimi: kurucuya Telegram DM (``TELEGRAM_OPS_BOT_TOKEN`` + ``ADMIN_CHAT_ID``; §8.2).

Bildirim metinleri telegram.md kuralına uyar (emoji ve ünlem yok, ≤ 4 satır); ``notify`` bunu denetler.
"""

from __future__ import annotations

import re

import httpx

from ..errors import AdapterError
from .http import make_client

API = "https://api.telegram.org"
LEVEL_PREFIX = {"info": "Bilgi", "warning": "Dikkat", "danger": "Acil"}
_EMOJI = re.compile("[\U0001F300-\U0001FAFF☀-⛿✀-➿]")


def format_notice(text: str, level: str = "info") -> str:
    """``"Dikkat · <metin>"``; ünlem nokta olur, emoji atılır, en çok 4 satır."""
    if level not in LEVEL_PREFIX:
        raise ValueError(f"bilinmeyen bildirim düzeyi: {level}")
    clean = _EMOJI.sub("", text).replace("!", ".")
    lines = [ln.rstrip() for ln in clean.strip().splitlines() if ln.strip()][:4]
    if not lines:
        raise ValueError("boş bildirim")
    lines[0] = f"{LEVEL_PREFIX[level]} · {lines[0]}"
    return "\n".join(lines)


class TelegramNotifier:
    def __init__(self, token: str, chat_id: str | int, *, api: str = API, transport: httpx.BaseTransport | None = None):
        if not token or not chat_id:
            raise AdapterError("OGR-ADP-001 TELEGRAM_OPS_BOT_TOKEN ve ADMIN_CHAT_ID gerekli")
        self.url = f"{api.rstrip('/')}/bot{token}/sendMessage"
        self.chat_id = chat_id
        self.client = make_client(transport)

    def notify(self, text: str, *, level: str = "info") -> None:
        body = {"chat_id": self.chat_id, "text": format_notice(text, level), "disable_web_page_preview": True}
        try:
            r = self.client.post(self.url, json=body)
        except httpx.HTTPError as exc:
            raise AdapterError(f"OGR-ADP-001 Telegram bildirimi gönderilemedi: {exc}") from exc
        if r.status_code != 200 or not r.json().get("ok", False):
            raise AdapterError(f"OGR-ADP-001 Telegram bildirimi reddedildi ({r.status_code})")
