#!/usr/bin/env python3
"""§2.3 LLM sahte seçim kuralının başvuru uygulaması (Worker `test/fakes/providers.ts` ve
`ogrenmen_common.fakes.FakeLLM` birebir aynısını uygular):

  dosyalar ada göre sıralanır, bad-schema*.json dışarıda bırakılır,
  i = int(sha256(prompt_text)[:8], 16) mod n

  python fixtures/scripts/select_llm.py chat "prompt metni"   → seçilen dosyanın adı
"""

from __future__ import annotations

import hashlib
import sys
from pathlib import Path

LLM = Path(__file__).resolve().parents[1] / "llm"


def candidates(purpose: str) -> list[Path]:
    files = sorted((LLM / purpose).glob("*.json"), key=lambda p: p.name)
    return [p for p in files if not p.name.startswith("bad-schema")]


def select(purpose: str, prompt_text: str) -> Path:
    files = candidates(purpose)
    if not files:
        raise FileNotFoundError(f"fixtures/llm/{purpose} boş")
    i = int(hashlib.sha256(prompt_text.encode("utf-8")).hexdigest()[:8], 16) % len(files)
    return files[i]


def bad_schema(purpose: str) -> Path:
    return LLM / purpose / "bad-schema.json"


if __name__ == "__main__":
    if len(sys.argv) != 3:
        print(__doc__, file=sys.stderr)
        raise SystemExit(2)
    print(select(sys.argv[1], sys.argv[2]).name)
