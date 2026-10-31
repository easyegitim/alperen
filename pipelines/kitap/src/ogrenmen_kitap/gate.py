"""Kapı (§6.5 adım 1): ``runtime_flags.research_enabled`` + ``check_spend('research')`` + ``research_monthly_cap``.

Kapı her zaman **ağdan ve modelden önce** denetlenir (``test_quota_checked_before_network``). Öğrenci kotası
Worker'da ``enqueue_research`` ile zaten düşmüştür; burada yalnız sistem tavanları vardır.

Aylık tavan sayımı: Europe/Istanbul takvim ayında ``finished_at``'i olan ``research_requests(status='done')``
satırları. ``--query`` elle çalıştırmasının istek satırı yoktur, bu yüzden sayıma girmez (maliyeti yine
``llm_calls``/``spend_ledger``'a ve ``check_spend`` tavanına yazılır).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from ogrenmen_common.adapters.base import DB, not_null
from ogrenmen_common.clock import istanbul_date, month_start, parse_ts
from ogrenmen_common.ledger import CostLedger

from .errors import GateBlocked

DEFAULT_MONTHLY_CAP = 40
PURPOSES = ("query_expand", "research")
"""Bir araştırmanın çağırdığı model amaçları (ikisinin de zinciri kapıdan geçmeli)."""


def flag(db: DB, key: str, default: Any = None) -> Any:
    rows = db.select("runtime_flags", where={"key": key}, limit=1)
    return rows[0].get("value") if rows else default


def research_enabled(db: DB) -> bool:
    value = flag(db, "research_enabled", False)
    if isinstance(value, str):
        return value.strip().lower() in ("1", "true", "yes", "on")
    return bool(value)


def monthly_cap(db: DB) -> int:
    value = flag(db, "research_monthly_cap", DEFAULT_MONTHLY_CAP)
    try:
        return int(value)
    except (TypeError, ValueError):
        return DEFAULT_MONTHLY_CAP


def done_this_month(db: DB, now) -> int:  # noqa: ANN001 - datetime
    """Bu Istanbul ayında tamamlanan araştırma sayısı."""
    first = month_start(istanbul_date(now))
    rows = db.select("research_requests", where={"status": "done", "finished_at": not_null()},
                     columns=["id", "finished_at"])
    return sum(1 for r in rows if istanbul_date(parse_ts(r["finished_at"])) >= first)


@dataclass(frozen=True)
class GateState:
    enabled: bool
    spend_state: str
    month_done: int
    month_cap: int


def check(db: DB, ledger: CostLedger, now, *, require_enabled: bool) -> GateState:  # noqa: ANN001
    """Kapıyı denetler; engel varsa ``GateBlocked`` (ağ/model çağrısı yapılmadan)."""
    enabled = research_enabled(db)
    if require_enabled and not enabled:
        raise GateBlocked("disabled", "research disabled (runtime_flags.research_enabled=false)")
    state = "normal"
    for purpose in PURPOSES:
        gate = ledger.gate(purpose, refresh=True)
        state = str(gate.get("state") or state)
        if ledger.is_degraded(gate):
            raise GateBlocked("degraded", f"degraded kip: model çağrılmaz ({purpose})")
        needs_paid = all(ledger.is_paid(m) for m in ledger.chain(purpose))
        if needs_paid and not gate.get("paid_allowed", False):
            raise GateBlocked("spend", f"harcama tavanı ücretli çağrıya izin vermiyor ({purpose}; durum {state})")
    cap = monthly_cap(db)
    done = done_this_month(db, now)
    if done >= cap:
        raise GateBlocked("monthly_cap", f"aylık araştırma tavanı doldu ({done}/{cap})")
    return GateState(enabled=enabled, spend_state=state, month_done=done, month_cap=cap)


__all__ = ["GateState", "check", "done_this_month", "flag", "monthly_cap", "research_enabled"]
