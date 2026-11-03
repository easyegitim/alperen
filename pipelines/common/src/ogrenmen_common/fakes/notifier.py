"""FakeNotifier — bildirimi stdout'a yazar ve ``sent`` listesinde tutar (``Notifier`` Protocol'ü)."""

from __future__ import annotations

import sys
from typing import TextIO

from ..adapters.notify import format_notice


class FakeNotifier:
    def __init__(self, stream: TextIO | None = None, *, echo: bool = True):
        self.stream = stream
        self.echo = echo
        self.sent: list[dict] = []

    def notify(self, text: str, *, level: str = "info") -> None:
        message = format_notice(text, level)
        self.sent.append({"level": level, "text": message})
        if self.echo:
            print(f"[bildirim] {message}", file=self.stream or sys.stdout)
