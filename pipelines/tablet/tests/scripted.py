"""Testlere özgü senaryolu LLM sahtesi (``LLM`` Protocol'ü; ağ yok, deterministik).

``fixtures/llm/question_gen`` dosyaları birkaç kazanımı kapsar; ``generation_requests`` testleri her hedef kazanım
için geçerli bir zarf ister. ``ScriptedLLM`` istemdeki "Hedef kazanım:" satırını okur ve o kazanım için
``question-generation`` zarfı kurar; kazanım başına deneme sırasıyla davranış seçilir (``ok``, ``bad_sympy``,
``figure``, ``wrong_skill``, ``bad_schema``). Vision çağrıları ``vision`` listesinden (varsayılan ``match``);
diğer amaçlar ``FakeLLM``'e gider.
"""

from __future__ import annotations

import json
import re
from collections import Counter
from pathlib import Path

from ogrenmen_common.adapters.base import LLMRequest, LLMResult
from ogrenmen_common.fakes import FakeLLM
from ogrenmen_common.paths import fixtures_root

GOOD_FIGURE = (fixtures_root() / "tablet" / "figures" / "good.py").read_text(encoding="utf-8")
_TARGET = re.compile(r"^Hedef kazanım: (\S+)", re.MULTILINE)
_TAG_LINE = re.compile(r"^- ([a-z0-9-]+(?:\.[a-z0-9-]+)+): ", re.MULTILINE)


def envelope(skill: str, n: int, *, kind: str = "mcq", mode: str = "ok", tags: list[str] | None = None) -> dict:
    a, b = 3 + n, 5 + 2 * n
    tags = (tags or []) + [None, None]
    item: dict = {
        "schema_version": "1.0", "curriculum_code": "TYT-MAT@2026.1", "kind": kind,
        "skill_ids": ["tyt.mat.temel.sayilar" if mode == "wrong_skill" else skill],
        "stem": f"Bir sınıfta `{a}` kız ve `{b}` erkek öğrenci var. Sınıfta toplam kaç öğrenci vardır?",
        "stem_values": {"kiz": a, "erkek": b}, "figure": None, "difficulty": 0.5, "source": "llm",
        "verification": {"schema": True, "sympy": "pending", "render": "pending", "vision": "pending", "attempts": 0,
                         "status": "draft", "review_note": None},
        "provenance": {"model": "senaryo", "prompt_version": "question_gen.v1"},
    }
    key: dict = {"canonical_expr": "kiz + erkek", "solution": f"Kız ve erkek sayıları toplanır: `{a} + {b} = {a + b}`.",
                 "sympy_status": "verified"}
    if kind == "mcq":
        item["options"] = [
            {"key": "A", "text": f"`{a + b}`", "misconception_tag": None},
            {"key": "B", "text": f"`{a * b}`", "misconception_tag": tags[0]},
            {"key": "C", "text": f"`{a + b + 2}`", "misconception_tag": None},
            {"key": "D", "text": f"`{b - a}`", "misconception_tag": tags[1]},
        ]
        key["correct_option"] = "C" if mode == "bad_sympy" else "A"
    else:
        key["numeric_value"] = str(a + b + (1 if mode == "bad_sympy" else 0))
    if mode == "figure":
        item["stem_values"] = {"kiz": a, "erkek": b, "pay1": 5, "payda1": 6, "pay2": 1, "payda2": 4}
        item["figure"] = {"tool": "matplotlib", "code": GOOD_FIGURE + f"# varyant {n}\n",
                          "alt_text": "Üstte 6 eş parçadan 5'i, altta 4 eş parçadan 1'i boyalı iki dikdörtgen.",
                          "expected_px": {"min_w": 600, "max_w": 1000, "min_h": 300, "max_h": 600}}
    env = {"schema_version": "1.0", "item": item, "key": key}
    if mode == "bad_schema":
        env.pop("key")
    return env


VISION_MATCH = {"schema_version": "1.0", "matches_stem": True, "status": "match", "mismatches": [],
                "notes": "Şekil kökle uyumlu."}
VISION_MISMATCH = {"schema_version": "1.0", "matches_stem": False, "status": "mismatch",
                   "mismatches": [{"field": "payda2", "expected": 4, "observed": 3}], "notes": "Alt model yanlış."}


class ScriptedLLM:
    name = "scripted"

    def __init__(self, modes: dict[str, list[str]] | None = None, *, vision: list[str] | None = None,
                 fix_mode: str = "figure"):
        self.modes = modes or {}
        self.vision = list(vision or [])
        self.fix_mode = fix_mode
        self.fallback = FakeLLM()
        self.calls: list[LLMRequest] = []
        self._per_skill: Counter = Counter()
        self._n = 0
        self._vision_n = 0

    def prompts(self, purpose: str = "question_gen") -> list[str]:
        return [c.prompt_text for c in self.calls if c.purpose == purpose]

    def complete(self, request: LLMRequest) -> LLMResult:
        self.calls.append(request)
        if request.purpose == "question_gen":
            data = self._question(request)
        elif request.purpose == "vision_check":
            seq = self.vision or ["match"]
            verdict = seq[min(self._vision_n, len(seq) - 1)]
            self._vision_n += 1
            data = VISION_MATCH if verdict == "match" else VISION_MISMATCH
        else:
            return self.fallback.complete(request)
        text = json.dumps(data, ensure_ascii=False)
        return LLMResult(ok=True, text=text, json=json.loads(text), tokens_in=len(request.prompt_text) // 4,
                         tokens_out=len(text) // 4)

    def _question(self, request: LLMRequest) -> dict:
        m = _TARGET.search(request.prompt)
        self._n += 1
        if m is None:  # şekil düzeltme istemi
            return envelope("tyt.mat.temel.rasyonel-sayilar", 900 + self._n, mode=self.fix_mode)
        skill = m.group(1)
        modes = self.modes.get(skill, ["ok"])
        mode = modes[min(self._per_skill[skill], len(modes) - 1)]
        self._per_skill[skill] += 1
        kind = "numeric" if "Soru türü: sayısal cevaplı (numeric)" in request.prompt else "mcq"
        tags = _TAG_LINE.findall(request.prompt)[:2]
        return envelope(skill, self._n, kind=kind, mode=mode, tags=tags)


def write_envelope(path: Path, data: dict) -> Path:
    path.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    return path
