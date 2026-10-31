"""Sahte kipte sözleşme örneğini öğrenciye göre seçen LLM sarmalayıcısı (yalnız dry-run/sahte çalışma).

``FakeLLM``'in §2.3 seçim kuralı (``sha256(prompt) mod n``) bir öğrencinin istemine başka bir öğrencinin
fixture'ını döndürebilir; gece olgu işi bu yanıtı (doğru olarak) reddeder, ama o zaman dry-run'da hiçbir olgu
oluşmaz. Bu sarmalayıcı istemdeki ``Öğrenci: s_…`` ve ``Gün:``/``Hafta:`` satırlarını okur ve aynı
``student_ref`` + gün (``nightly-facts-output.day``) ya da hafta (``weekly-summary.week_start``) için yazılmış
sözleşme örneğini döndürür:

* ``<--fixtures>/facts-day.json`` (``nightly-facts-output`` dizisi; §6.2 "fake LLM fixtures/kulaklik/facts-day.json"),
* ``fixtures/llm/<amaç>/*.json`` (``bad-schema*`` hariç, ada göre sıralı).

Eşleşme yoksa ``FakeLLM``'e devreder (§2.3 kuralı). Token sayımı ``FakeLLM`` ile aynıdır (~4 karakter = 1 token);
böylece ``CostLedger`` maliyet satırları gerçekçi kalır. Gerçek kipte kullanılmaz.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from ogrenmen_common.adapters.base import LLM, LLMRequest, LLMResult
from ogrenmen_common.fakes.llm import BAD_SCHEMA_PREFIX, estimate_tokens
from ogrenmen_common.paths import llm_fixtures_root

REF_LINE = re.compile(r"^Öğrenci: (s_[a-z2-7]{12})$", re.M)
DAY_LINE = re.compile(r"^(?:Gün|Hafta): (\d{4}-\d{2}-\d{2})$", re.M)
KEY_FIELD = {"nightly_facts": "day", "weekly_summary": "week_start"}


@dataclass(frozen=True)
class ServedCall:
    purpose: str
    student_ref: str | None
    source: str
    prompt_text: str


def _load(path: Path) -> list[dict]:
    data = json.loads(path.read_text(encoding="utf-8"))
    items = data if isinstance(data, list) else [data]
    return [d for d in items if isinstance(d, dict)]


class ContractFixtureLLM:
    """``LLM`` Protocol'ü; ``nightly_facts`` ve ``weekly_summary`` için öğrenciye göre örnek seçer."""

    name = "fake"

    def __init__(self, inner: LLM, *, fixtures: Path | None = None, llm_root: Path | None = None):
        self.inner = inner
        self.calls: list[ServedCall] = []
        self.examples: dict[str, list[tuple[str, dict]]] = {p: [] for p in KEY_FIELD}
        if fixtures is not None and (Path(fixtures) / "facts-day.json").is_file():
            for item in _load(Path(fixtures) / "facts-day.json"):
                self.examples["nightly_facts"].append(("facts-day.json", item))
        root = Path(llm_root) if llm_root is not None else llm_fixtures_root()
        for purpose in KEY_FIELD:
            folder = root / purpose
            if not folder.is_dir():
                continue
            for path in sorted(folder.glob("*.json")):
                if path.name.startswith(BAD_SCHEMA_PREFIX):
                    continue
                for item in _load(path):
                    self.examples[purpose].append((f"{purpose}/{path.name}", item))

    def __getattr__(self, name: str) -> Any:
        if name == "inner":
            raise AttributeError(name)
        return getattr(self.inner, name)

    def match(self, request: LLMRequest) -> tuple[str, dict] | None:
        key = KEY_FIELD.get(request.purpose)
        if key is None:
            return None
        ref = REF_LINE.search(request.prompt)
        day = DAY_LINE.search(request.prompt)
        if not ref or not day:
            return None
        for source, item in self.examples.get(request.purpose, []):
            if item.get("student_ref") == ref.group(1) and item.get(key) == day.group(1):
                return source, item
        return None

    def complete(self, request: LLMRequest) -> LLMResult:
        found = self.match(request)
        ref = REF_LINE.search(request.prompt)
        if found is None:
            self.calls.append(ServedCall(request.purpose, ref.group(1) if ref else None, "FakeLLM",
                                         request.prompt_text))
            return self.inner.complete(request)
        source, item = found
        self.calls.append(ServedCall(request.purpose, ref.group(1) if ref else None, source, request.prompt_text))
        text = json.dumps(item, ensure_ascii=False)
        return LLMResult(ok=True, text=text, json=json.loads(text), tokens_in=estimate_tokens(request.prompt_text),
                         tokens_out=estimate_tokens(text), latency_ms=0)


def install(rt: Any, fixtures: Path | None) -> ContractFixtureLLM | None:
    """Sahte Runtime'ın defter LLM'ini sarmalar (gerçek kipte hiçbir şey yapmaz)."""
    if not getattr(rt, "is_fake", False):
        return None
    wrapped = ContractFixtureLLM(rt.ledger.llm, fixtures=fixtures)
    rt.ledger.llm = wrapped
    rt.llm = wrapped
    return wrapped
