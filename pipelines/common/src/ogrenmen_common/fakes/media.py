"""FakeVision, FakeOCR, FakeTranscriber — maliyetsiz, ağsız fixture okuyucular.

İstekler ``adapters/media.py`` kurucularıyla kurulur ve dosya ``FakeLLM`` ile aynı kuralla
seçilir (§2.3 + ``fixture_hint``); yani aynı girdiyle ``LLMVision(ledger + FakeLLM)`` ile aynı
yanıtı verirler. Testler için zorlama seçenekleri vardır (``verdicts``, ``transcript``, ``items``).
"""

from __future__ import annotations

import json
from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import Any

from ..adapters.media import apply_exam_meta, ocr_request, transcribe_request, vision_request
from ..paths import llm_fixtures_root
from .llm import select_fixture


def _load(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


class FakeVision:
    """``Vision`` Protocol'ü. ``verdicts`` verilirse (ör. ``["mismatch", "mismatch"]``) sırayla
    ``fixtures/llm/vision_check`` içindeki o durumdaki ilk rapor döner; bitince §2.3 kuralı."""

    def __init__(self, root: Path | None = None, *, verdicts: Sequence[str] | None = None):
        self.root = Path(root) if root is not None else llm_fixtures_root()
        self.verdicts = list(verdicts or [])
        self.calls: list[dict] = []

    def _by_status(self, status: str) -> dict:
        for path in sorted((self.root / "vision_check").glob("*.json")):
            if path.name.startswith("bad-schema"):
                continue
            data = _load(path)
            if data.get("status") == status:
                return data
        raise ValueError(f"vision_check fixture'ında '{status}' durumu yok")

    def check_figure(self, image: bytes, *, stem: str, stem_values: Mapping[str, Any], alt_text: str = "") -> dict:
        req = vision_request(image, stem=stem, stem_values=stem_values, alt_text=alt_text)
        if self.verdicts:
            report = self._by_status(self.verdicts.pop(0))
            source = "verdict"
        else:
            path = select_fixture(self.root / "vision_check", req.prompt_text)
            report, source = _load(path), path.name
        self.calls.append({"stem": stem, "fixture": source, "bytes": len(image)})
        return report


class FakeOCR:
    """``OCR`` Protocol'ü; ``meta['fixture_hint']`` (ör. ``exam-2022``) dosyayı seçer, yoksa §2.3 kuralı.
    Kaynak alanları (``source_id``, ``year``, ``term``, ``instructor_alias``) ``meta``'dan yazılır."""

    def __init__(self, root: Path | None = None, *, items: Sequence[dict] | None = None):
        self.root = Path(root) if root is not None else llm_fixtures_root()
        self.items = [dict(i) for i in items] if items is not None else None
        self.calls: list[dict] = []

    def extract_items(self, pages: Sequence[bytes], *, meta: Mapping[str, Any]) -> list[dict]:
        req = ocr_request(pages, meta=meta)
        if self.items is not None:
            data, source = [dict(i) for i in self.items], "items"
        else:
            path = select_fixture(self.root / "ocr", req.prompt_text, hint=req.fixture_hint)
            data, source = _load(path), path.name
        self.calls.append({"pages": len(pages), "fixture": source})
        return apply_exam_meta(list(data), meta)


class FakeTranscriber:
    """``Transcriber`` Protocol'ü; ses dosyasının adı (``lesson-01``) fixture'ı seçer, yoksa §2.3 kuralı.
    ``transcript`` verilirse (ör. ``fixtures/ders/lesson-01.transcript.json`` içeriği) o döner."""

    def __init__(self, root: Path | None = None, *, transcript: dict | None = None):
        self.root = Path(root) if root is not None else llm_fixtures_root()
        self.transcript = transcript
        self.calls: list[dict] = []

    def transcribe(self, audio: Path, *, language: str = "tr") -> dict:
        audio = Path(audio)
        req = transcribe_request(audio, b"", language=language)
        if self.transcript is not None:
            data, source = json.loads(json.dumps(self.transcript)), "transcript"
        else:
            path = select_fixture(self.root / "transcribe", req.prompt_text, hint=req.fixture_hint)
            data, source = _load(path), path.name
        self.calls.append({"audio": audio.name, "fixture": source})
        return data
