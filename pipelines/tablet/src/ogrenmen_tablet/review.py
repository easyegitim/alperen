"""``tablet review-queue [--push]``: eğitmen onay kuyruğunun Tablet payı (BLUEPRINT §6.1, §10.5).

Panel kuyruğu ``v_review_queue`` görünümünden okur (yalnız ``authenticated``). ``batch_worker`` bu görünümü okuyamaz;
bu komut aynı sayıları temel tablolardan çıkarır: ``questions.status='pending_review'`` (kaynak, kazanım, en eski),
``figures.review_status='pending'`` (yalnız bekleyen bir soruya bağlı şekiller; düzeltmeyle yerine yenisi konmuş
eski şekiller sayılmaz) ve açık ``generation_requests``. "İki denemede doğrulamayı geçemedi" satırı yalnız 2 deneme
kuralının notunu (``2 başarısız deneme`` öneki) sayar; diğer üretim notları (şekil düzeltme vb.) ayrı satırdır. Çıktı
``out/review_queue.json``; ``--push`` kurucuya/koordinatöre tek satırlık bildirim gönderir (``Notifier``; gerçek
kipte Telegram ops botu, dry-run'da stdout). Metin Türkçe, emoji ve ünlem yok; öğrenci kimliği ya da soru metni yok.
"""

from __future__ import annotations

from collections import Counter
from datetime import datetime
from typing import Any

from ogrenmen_common.adapters.base import in_, is_null
from ogrenmen_common.clock import iso, parse_ts

from .shared import TWO_ATTEMPT_PREFIX


def _age_days(now: datetime, created: Any) -> int | None:
    if not created:
        return None
    try:
        return max(0, (now - parse_ts(created)).days)
    except (TypeError, ValueError):
        return None


def collect(rt: Any) -> dict[str, Any]:
    now = rt.clock()
    questions = [dict(q) for q in rt.db.select(
        "questions", where={"status": "pending_review"},
        columns=["id", "source", "skill_ids", "figure_id", "created_at", "verification"], order="created_at")]
    linked = sorted({str(q["figure_id"]) for q in questions if q.get("figure_id")})
    figures = [dict(f) for f in rt.db.select(
        "figures", where={"review_status": "pending", "id": in_(linked)},
        columns=["id", "tool", "render_status", "vision_status", "attempts", "created_at"], order="created_at")
        ] if linked else []
    requests = rt.db.select("generation_requests", where={"needs_generation": True, "served_question_id": is_null()},
                            columns=["id", "kind", "skill_id", "created_at"])
    by_source = Counter(q.get("source") for q in questions)
    by_skill = Counter((q.get("skill_ids") or ["-"])[0] for q in questions)
    notes = [str((q.get("verification") or {}).get("review_note") or "") for q in questions]
    flagged = [n for n in notes if n]
    two_attempts = [n for n in flagged if n.startswith(TWO_ATTEMPT_PREFIX)]
    oldest = _age_days(now, questions[0]["created_at"]) if questions else None
    return {
        "generated_at": iso(now),
        "questions": {"pending_review": len(questions), "by_source": dict(sorted(by_source.items())),
                      "by_skill": dict(sorted(by_skill.items())), "with_generation_note": len(flagged),
                      "failed_two_attempts": len(two_attempts),
                      "oldest_days": oldest},
        "figures": {"pending": len(figures),
                    "by_render": dict(sorted(Counter(f.get("render_status") for f in figures).items())),
                    "by_vision": dict(sorted(Counter(f.get("vision_status") for f in figures).items()))},
        "generation_requests": {"open": len(requests),
                                "by_kind": dict(sorted(Counter(r.get("kind") for r in requests).items()))},
    }


def message(summary: dict[str, Any]) -> str:
    """Bildirim metni (telegram.md: bir fikir, dört satırı geçmez, emoji/ünlem yok)."""
    q = summary["questions"]
    f = summary["figures"]
    lines = [f"Onay kuyruğunda {q['pending_review']} soru ve {f['pending']} şekil bekliyor."]
    if q.get("failed_two_attempts"):
        lines.append(f"{q['failed_two_attempts']} soru iki denemede doğrulamayı geçemedi; notuna bakman gerekiyor.")
    elif q["with_generation_note"]:
        lines.append(f"{q['with_generation_note']} sorunun üretim notu var; notuna bakman gerekiyor.")
    if q["oldest_days"]:
        lines.append(f"En eski soru {q['oldest_days']} gündür bekliyor.")
    lines.append("Panelde Kuyruk sayfasından onaylayabilir ya da yeniden üretime gönderebilirsin.")
    return "\n".join(lines[:4])


def push(rt: Any, summary: dict[str, Any]) -> str:
    text = message(summary)
    rt.notifier.notify(text, level="info")
    return text
