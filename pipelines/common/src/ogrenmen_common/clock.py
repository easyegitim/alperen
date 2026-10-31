"""Zaman yardımcıları: sabit/sistem saati, ISO biçimleri, Europe/Istanbul günü.

Veritabanı "gün"ü ``(now() at time zone 'Europe/Istanbul')::date`` ile hesaplar (``check_spend``,
``spend_rollup``, ``proactive_one_per_day``); buradaki ``istanbul_date`` aynı kuralı uygular.
Sahte dünyanın "şimdi"si ``fixtures/README.md``'deki gibi ``2026-10-20T09:00:00Z``'dir;
``OGRENMEN_NOW`` ortam değişkeni bunu değiştirir.
"""

from __future__ import annotations

import os
from collections.abc import Callable
from datetime import UTC, date, datetime, timedelta, timezone, tzinfo

try:
    from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

    try:
        ISTANBUL: tzinfo = ZoneInfo("Europe/Istanbul")
    except ZoneInfoNotFoundError:  # tzdata yoksa: Türkiye 2016'dan beri sabit UTC+3
        ISTANBUL = timezone(timedelta(hours=3), "Europe/Istanbul")
except ImportError:  # pragma: no cover - Python 3.11+ her zaman zoneinfo taşır
    ISTANBUL = timezone(timedelta(hours=3), "Europe/Istanbul")

FIXTURE_NOW = datetime(2026, 10, 20, 9, 0, 0, tzinfo=UTC)
"""Sahte dünyanın 'şimdi'si (fixtures/README.md)."""

Clock = Callable[[], datetime]


def system_clock() -> datetime:
    """Gerçek saat (UTC)."""
    return datetime.now(UTC)


class FixedClock:
    """Deterministik saat; ``advance`` ile ileri alınır (testler ve sahte çalışma)."""

    def __init__(self, at: datetime | str = FIXTURE_NOW):
        self._now = parse_ts(at) if isinstance(at, str) else _aware(at)

    def __call__(self) -> datetime:
        return self._now

    def advance(self, **delta: float) -> datetime:
        self._now = self._now + timedelta(**delta)
        return self._now

    def __repr__(self) -> str:
        return f"FixedClock({iso(self._now)})"


def fake_clock_from_env(env: dict[str, str] | None = None) -> FixedClock:
    """``OGRENMEN_NOW`` (ISO) varsa onu, yoksa fixture 'şimdi'sini kullanan sabit saat."""
    env = os.environ if env is None else env
    raw = env.get("OGRENMEN_NOW")
    return FixedClock(raw) if raw else FixedClock(FIXTURE_NOW)


def _aware(value: datetime) -> datetime:
    return value if value.tzinfo is not None else value.replace(tzinfo=UTC)


def parse_ts(value: str | datetime | date) -> datetime:
    """ISO zaman damgası → UTC-farkında ``datetime``; yalnız tarih verilirse UTC gece yarısı."""
    if isinstance(value, datetime):
        return _aware(value)
    if isinstance(value, date):
        return datetime(value.year, value.month, value.day, tzinfo=UTC)
    text = value.strip()
    if text.endswith("Z") or text.endswith("z"):
        text = text[:-1] + "+00:00"
    if len(text) == 10:
        d = date.fromisoformat(text)
        return datetime(d.year, d.month, d.day, tzinfo=UTC)
    return _aware(datetime.fromisoformat(text))


def iso(value: datetime) -> str:
    """UTC ISO biçimi, ``Z`` sonekiyle (fixtures ile aynı yazım)."""
    value = _aware(value).astimezone(UTC)
    if value.microsecond:
        return value.strftime("%Y-%m-%dT%H:%M:%S.%fZ")
    return value.strftime("%Y-%m-%dT%H:%M:%SZ")


def istanbul_date(value: datetime | str) -> date:
    """Zaman damgasının Europe/Istanbul takvim günü."""
    return parse_ts(value).astimezone(ISTANBUL).date()


def month_start(day: date) -> date:
    return day.replace(day=1)


def hms_seconds(ts: str | None) -> int:
    """Transkript zamanı ``HH:MM:SS`` → saniye; boş değer 0 (``lesson_claims.t_start_sec`` kuralı)."""
    if not ts:
        return 0
    h, m, s = (int(x) for x in str(ts).split(":"))
    return h * 3600 + m * 60 + s
