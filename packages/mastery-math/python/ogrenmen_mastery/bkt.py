"""Bayesian Knowledge Tracing — TS `src/bkt.ts` ve SQL `sql/bkt.sql` ile birebir aynı formüller.

Adlar SQL ile aynıdır (`bkt_step`, `blend_step`, `inferred_guess`); TS adları
(`bktStep`, `blendStep`, `inferredGuess`) takma ad olarak da sunulur.
"""

from __future__ import annotations

import math
from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Any

P_MIN = 0.01
"""Ustalık değerinin alt sınırı (kırpma)."""
P_MAX = 0.99
"""Ustalık değerinin üst sınırı (kırpma)."""
BLEND_RATE = 0.30
"""Sürekli gözlemde w = 0.30·c."""
DEFAULT_CONFIDENCE = 0.8
"""Sürekli gözlemde güven boşsa kullanılan değer."""
NUMERIC_GUESS = 0.05
"""Sayısal sorularda gözleme yazılan tahmin olasılığı (`guess_override`)."""
INFERRED_WEIGHT = 0.5
"""Ön koşul çıkarım gözleminin ağırlığı."""

BINARY_KINDS = frozenset({"diagnostic", "practice", "test", "resolution"})
CONTINUOUS_KINDS = frozenset({"lesson", "instructor"})
CHAT_KINDS = frozenset({"chat_question", "chat_misconception"})


class MasteryMathError(ValueError):
    """Geçersiz girdi (OGR-MAST-001 bilinmeyen tür, OGR-MAST-003 sayısal hata)."""


def _finite(name: str, value: float) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise MasteryMathError(f"OGR-MAST-003 {name} sonlu bir sayı olmalı: {value!r}")
    return float(value)


def clip(x: float) -> float:
    """Değeri [P_MIN, P_MAX] aralığına kırpar (SQL: least(0.99, greatest(0.01, x)))."""
    return min(P_MAX, max(P_MIN, x))


def bkt_step(p: float, correct: bool, g: float, s: float, t: float) -> float:
    """İkili gözlem adımı.

    Doğruysa p_obs = p(1−s) / (p(1−s) + (1−p)g), yanlışsa p_obs = ps / (ps + (1−p)(1−g));
    sonra p_new = p_obs + (1−p_obs)·t, [0.01, 0.99] aralığına kırpılır. Payda sıfırsa
    SQL NULL döner (mastery.p not null kısıtı yazımı düşürür); burada hata fırlatılır.
    """
    p, g, s, t = _finite("p", p), _finite("g", g), _finite("s", s), _finite("t", t)
    if correct:
        num = p * (1 - s)
        den = p * (1 - s) + (1 - p) * g
    else:
        num = p * s
        den = p * s + (1 - p) * (1 - g)
    if den == 0:
        raise MasteryMathError("OGR-MAST-003 BKT paydası sıfır (p, g, s parametrelerini denetle)")
    p_obs = num / den
    return clip(p_obs + (1 - p_obs) * t)


def blend_step(p: float, m: float, c: float | None = None) -> float:
    """Sürekli gözlem: p + w·(m − p), w = 0.30·c; c boşsa 0.8; sonuç kırpılır."""
    p, m = _finite("p", p), _finite("m", m)
    conf = DEFAULT_CONFIDENCE if c is None else _finite("c", c)
    return clip(p + BLEND_RATE * conf * (m - p))


def inferred_guess(g: float, w: float) -> float:
    """Çıkarım gözlemi için yumuşatılmış tahmin olasılığı: g' = g + (1 − g)(1 − w)."""
    g, w = _finite("g", g), _finite("w", w)
    return g + (1 - g) * (1 - w)


@dataclass(frozen=True)
class ObservationStep:
    """Tek gözlemin ustalığa etkisi; `mastery_history` satırının karşılığı."""

    p: float
    evidence_increment: int
    method: str | None
    params: dict[str, float | None] = field(default_factory=dict)


def _get(obj: Mapping[str, Any] | Any, key: str, default: Any = None) -> Any:
    if isinstance(obj, Mapping):
        value = obj.get(key, default)
    else:
        value = getattr(obj, key, default)
    return default if value is None else value


def observation_step(p0: float, obs: Mapping[str, Any] | Any, skill: Mapping[str, Any] | Any) -> ObservationStep:
    """`public.apply_observation` gövdesindeki türe göre dallanmanın saf karşılığı.

    `obs`: `kind`, `value`, `weight`, `confidence`, `guess_override`, `counts_for_mastery`
    alanları (sözlük ya da nesne). `skill`: `p_guess`, `p_slip`, `p_learn`.
    """
    kind = _get(obs, "kind")
    value = _get(obs, "value")
    if kind in CHAT_KINDS:
        return ObservationStep(p=p0, evidence_increment=0, method=None, params={})
    p_guess, p_slip, p_learn = _get(skill, "p_guess"), _get(skill, "p_slip"), _get(skill, "p_learn")
    if kind in BINARY_KINDS:
        guess_override = _get(obs, "guess_override")
        g = p_guess if guess_override is None else guess_override
        correct = value is not None and value >= 0.5
        counts = _get(obs, "counts_for_mastery", True)
        return ObservationStep(
            p=bkt_step(p0, correct, g, p_slip, p_learn),
            evidence_increment=1 if counts is not False else 0,
            method="bkt",
            params={"g": g, "s": p_slip, "t": p_learn, "w": _get(obs, "weight", 1.0), "guess_override": guess_override},
        )
    if kind in CONTINUOUS_KINDS:
        if value is None:
            raise MasteryMathError("OGR-MAST-003 sürekli gözlemde value zorunlu")
        confidence = _get(obs, "confidence")
        conf = DEFAULT_CONFIDENCE if confidence is None else confidence
        return ObservationStep(
            p=blend_step(p0, value, confidence),
            evidence_increment=1,
            method="blend",
            params={"w": BLEND_RATE * conf, "m": value},
        )
    if kind == "inferred":
        w = _get(obs, "weight", 1.0)
        guess_override = _get(obs, "guess_override")
        g = inferred_guess(p_guess if guess_override is None else guess_override, w)
        return ObservationStep(
            p=bkt_step(p0, False, g, p_slip, p_learn),
            evidence_increment=0,
            method="inferred",
            params={"g_eff": g, "s": p_slip, "t": p_learn, "w": w},
        )
    raise MasteryMathError(f"OGR-MAST-001 bilinmeyen gözlem türü {kind}")


# TS ile aynı adlar (BLUEPRINT §2.2: "aynı adlar").
bktStep = bkt_step  # noqa: N816
blendStep = blend_step  # noqa: N816
inferredGuess = inferred_guess  # noqa: N816
observationStep = observation_step  # noqa: N816
