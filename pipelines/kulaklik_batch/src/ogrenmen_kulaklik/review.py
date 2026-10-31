"""İşaretli cevap örneklemi (``review-sample --week``) — BLUEPRINT §6.2.

Haftanın tüm ``flagged`` cevapları + işaretsizlerden deterministik rastgele 20 (tohum: hafta başlangıcı) →
``bot_responses.review_week`` (``batch_worker`` ``u (review_week)``) ve ``out/review-<hafta>.md`` (weekly.yml Issue
yorumu). ``prompt_text`` girişte temizlenmiş olsa da rapora girmeden temizleyiciden bir kez daha geçer; rapora
öğrenci kimliği yazılmaz (yalnız cevap numarası).
"""

from __future__ import annotations

import random
from collections.abc import Sequence
from dataclasses import dataclass, field
from typing import Any

from ogrenmen_common.adapters.base import in_
from ogrenmen_common.pii import scrub_for_llm

from .common import Window, select_window, tr_usd

SAMPLE_SIZE = 20
PROMPT_CHARS = 700


@dataclass
class ReviewReport:
    week_start: str
    total: int = 0
    flagged: list[int] = field(default_factory=list)
    sampled: list[int] = field(default_factory=list)
    file: str | None = None

    def as_dict(self) -> dict[str, Any]:
        return dict(self.__dict__)


def pick(rows: list[dict], week: str, size: int = SAMPLE_SIZE) -> tuple[list[dict], list[dict]]:
    flagged = sorted((r for r in rows if r.get("flagged")), key=lambda r: int(r["id"]))
    rest = sorted((r for r in rows if not r.get("flagged")), key=lambda r: int(r["id"]))
    rng = random.Random(f"review-sample:{week}")
    sample = sorted(rng.sample(rest, min(size, len(rest))), key=lambda r: int(r["id"]))
    return flagged, sample


def _quote(text: Any, name_hashes: Sequence[str], limit: int) -> str:
    cleaned = scrub_for_llm(str(text or ""), name_hashes).text
    if len(cleaned) > limit:
        cleaned = cleaned[:limit].rstrip() + " …"
    return "\n".join("> " + line if line else ">" for line in cleaned.splitlines()) or "> —"


def render(week: Window, flagged: list[dict], sample: list[dict], name_hashes: Sequence[str]) -> str:
    lines = [f"# İşaretli cevap örneklemi — {week.label()}", "",
             f"İşaretli cevap: {len(flagged)} · rastgele örneklem: {len(sample)}. Metinler temizlenmiştir; "
             "öğrenci kimliği yazılmaz.", ""]
    for title, rows in (("İşaretli cevaplar", flagged), ("Rastgele örneklem", sample)):
        lines += [f"## {title}", ""]
        if not rows:
            lines += ["Bu hafta satır yok.", ""]
        for r in rows:
            head = (f"### Cevap #{r['id']} · {r.get('purpose')} · {r.get('prompt_version') or 'sürüm yok'} · "
                    f"{r.get('provider') or 'sağlayıcı yok'} · {tr_usd(float(r.get('cost_usd') or 0), 6)}")
            lines += [head, ""]
            if r.get("flagged"):
                reason = scrub_for_llm(str(r.get("flag_reason") or "belirtilmedi"), name_hashes).text
                lines += [f"İşaret nedeni: {reason}", ""]
            if r.get("prompt_text"):
                lines += ["İstem (temizlenmiş):", "", _quote(r["prompt_text"], name_hashes, PROMPT_CHARS), ""]
            lines += ["Cevap:", "", _quote(r.get("response_text"), name_hashes, 1200), ""]
    return "\n".join(lines).rstrip() + "\n"


def run_review(rt: Any, week: Window, *, name_hashes: Sequence[str] = ()) -> tuple[ReviewReport, str]:
    db = rt.db
    rows = select_window(db, "bot_responses", "created_at", week,
                         columns=("id", "purpose", "prompt_version", "prompt_text", "response_text", "provider",
                                  "cost_usd", "flagged", "flag_reason", "review_week", "created_at"))
    flagged, sample = pick(rows, week.start.isoformat())
    ids = [int(r["id"]) for r in flagged + sample]
    if ids:
        db.update("bot_responses", {"review_week": week.start.isoformat()}, where={"id": in_(ids)})
    report = ReviewReport(week_start=week.start.isoformat(), total=len(rows), flagged=[int(r["id"]) for r in flagged],
                          sampled=[int(r["id"]) for r in sample])
    return report, render(week, flagged, sample, name_hashes)
