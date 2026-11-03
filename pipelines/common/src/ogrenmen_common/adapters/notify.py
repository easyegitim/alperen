"""Operasyon bildirimi: kısa, tek fikirli metin; gerçek çalıştırmada stderr günlüğüne yazılır (``LogNotifier``).

Bildirim metinleri sade kurala uyar (emoji ve ünlem yok, ≤ 4 satır); ``format_notice`` bunu uygular. Dış bir kanala
(e-posta, ops sohbeti) gönderim v2'de ``apps/worker`` tarafındadır; boru hatları yalnız günlük yazar.
"""

from __future__ import annotations

import re
import sys
from typing import TextIO

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


class LogNotifier:
    """Bildirimi stderr'e (ya da verilen akışa) yazar; ağ yok, gizli anahtar yok."""

    def __init__(self, stream: TextIO | None = None):
        self.stream = stream

    def notify(self, text: str, *, level: str = "info") -> None:
        print(f"[bildirim] {format_notice(text, level)}", file=self.stream or sys.stderr)
