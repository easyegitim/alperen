"""``ogrenmen_pii`` sarmalayıcısı: LLM'e giden her metin buradan geçer (§9.1).

* ``scrub_for_llm(text, name_hashes, role_hashes=None)`` — temizlenmiş metin + değişiklik sayısı.
* ``role_hashes_from_labels(labels)`` — ``resolve_lesson_labels`` yanıtı → ``{hash: rol}``.
* ``label_transcript(transcript, labels)`` — transkript bölümlerindeki adları rol etiketine
  (``[ÖĞRENCİ]``/``[EĞİTMEN]``/``[VELİ]``) çevirir; kalan "hocam X" kalıbı ``[AD]`` olur (§6.3).
* ``name_leaks(text, name_hashes)`` — metinde hâlâ duran ad tokenları (testler ve son kemer).

Düz ad listesi hiçbir fonksiyona girdi değildir; yalnız ad-token hash'leri.
"""

from __future__ import annotations

import re
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from typing import Any

from ogrenmen_pii import normalize_token, scrub, sha256_hex
from ogrenmen_pii.scrub import LETTERS, LOWER, STOP_CAP, UPPER

ROLES = ("ÖĞRENCİ", "EĞİTMEN", "VELİ")
_TOKEN = re.compile(rf"(?<![{LETTERS}\[])[{LETTERS}]+(?:['’][{LOWER}]+)?")
_HOCAM = re.compile(rf"\b([Hh]ocam)\s+([{UPPER}][{LOWER}]+)(['’][{LOWER}]+)?")
_STOP = frozenset(STOP_CAP)


@dataclass(frozen=True)
class Scrubbed:
    text: str
    replacements: int
    by_kind: dict[str, int]


def scrub_for_llm(text: str, name_hashes: Sequence[str], role_hashes: Mapping[str, str] | None = None) -> Scrubbed:
    """``ogrenmen_pii.scrub`` ile temizler; ``name_hashes`` zorunludur (boş liste olabilir, ``None`` olamaz)."""
    if name_hashes is None or isinstance(name_hashes, str):
        raise TypeError("name_hashes hash listesi olmalı (düz ad değil)")
    result = scrub(text, {"nameHashes": list(name_hashes), "roleHashes": dict(role_hashes or {})})
    by_kind = {r["kind"]: int(r["count"]) for r in result["replacements"] if r["count"]}
    return Scrubbed(text=result["text"], replacements=sum(by_kind.values()), by_kind=by_kind)


def role_hashes_from_labels(labels: Iterable[Mapping[str, Any]]) -> dict[str, str]:
    """``[{hash, label}]`` → ``{hash: label}``; bilinmeyen rol ``ValueError``."""
    out: dict[str, str] = {}
    for row in labels:
        label = row["label"]
        if label not in ROLES:
            raise ValueError(f"bilinmeyen rol etiketi: {label}")
        out[str(row["hash"])] = label
    return out


def _hocam(text: str) -> tuple[str, int]:
    count = 0

    def repl(m: re.Match[str]) -> str:
        nonlocal count
        if m.group(2) in _STOP:
            return m.group(0)
        count += 1
        return f"{m.group(1)} [AD]{m.group(3) or ''}"

    return _HOCAM.sub(repl, text), count


def label_transcript(transcript: Mapping[str, Any], labels: Iterable[Mapping[str, Any]],
                     name_hashes: Sequence[str] = ()) -> tuple[dict, int]:
    """Her bölümü rol hash'leriyle temizler; ``(yeni transkript, toplam değişiklik)`` döner."""
    roles = role_hashes_from_labels(labels)
    total = 0
    segments = []
    for seg in transcript.get("segments") or []:
        cleaned = scrub_for_llm(str(seg.get("text", "")), name_hashes, roles)
        text, extra = _hocam(cleaned.text)
        total += cleaned.replacements + extra
        segments.append({**seg, "text": text})
    return {**dict(transcript), "segments": segments}, total


def name_leaks(text: str, name_hashes: Iterable[str]) -> list[str]:
    """Metindeki, hash'i listede olan tokenlar (boş liste = sızıntı yok)."""
    wanted = set(name_hashes)
    leaks = []
    for m in _TOKEN.finditer(text):
        base = re.split(r"['’]", m.group(0), maxsplit=1)[0]
        if len(base) >= 3 and sha256_hex(normalize_token(base)) in wanted:
            leaks.append(base)
    return leaks
