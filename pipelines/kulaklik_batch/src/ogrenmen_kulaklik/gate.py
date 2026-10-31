"""Pilot kapısı (``metrics --gate``; ADR-0013, §6.2, §12 #57).

Eşikler **yalnız** ``settings.pilot_gate`` satırından okunur (kodda varsayılan eşik yoktur; satır yoksa iş
``OGR-KLK-020`` ile durur). Son ``pilot_metrics`` dönemine uygulanır; ölçüt başına:

* ``NO_DATA`` — satır yok, ``value=null`` ya da ``n_min`` tanımlı ve ``n < n_min`` (``n`` = ``detail.n``,
  yoksa ``detail.n_rated``),
* ``PASS`` / ``FAIL`` — ``min`` (≥), ``max`` (≤), ``max_usd`` (≤) eşiklerine göre.

Dize eşikli ölçütler (``isolation_tests: "pass"``, ``key_leak_tests: "pass"``) CI'dan ``--ci-status`` ile gelir;
verilmezse ``NO_DATA``. ``required: false`` ölçütler bilgi satırıdır. Zorunlu ölçütlerin **hepsi** ``PASS`` ise
"Kapı: AÇIK", aksi hâlde "Kapı: KAPALI" — ``NO_DATA`` kapıyı açmaz; hiç zorunlu ölçüt yoksa da KAPALI.

Eşikler elle (ADR ile) düzenlendiği için kapı **kapalı kalacak biçimde** doğrulanır: her giriş ya ``"pass"``
dizesi ya da anahtarları yalnız ``min, max, max_usd, n_min, required`` olan, sınır değerleri sayı (bool değil),
``required`` değeri bool olan ve en az bir ``min``/``max``/``max_usd`` taşıyan bir nesnedir. Yazım hatası
(``{"mn": 0.9}``), tırnaklı sayı (``{"max": "0.05"}``) ya da boş nesne ``OGR-KLK-020`` ile durur (sessizce PASS
olmaz). Panel ``/maliyet`` "Pilot kapısı" bloğu (``apps/panel/lib/pilot-gate.ts``) aynı kuralı uygular; ortak
vaka dosyası ``tests/gate-cases.json``'dır.
"""

from __future__ import annotations

import json
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .common import KulaklikError, setting, tr_number, tr_usd

LABELS = {
    "question_accuracy": "Soru doğruluğu",
    "diagnostic_agreement": "Teşhis örtüşmesi",
    "citation_relevance": "Atıf ilgisi",
    "priority_uplift": "Öncelik katkısı",
    "cost_per_student": "Öğrenci başına maliyet (ders hariç)",
    "flagged_response_share": "İşaretli cevap payı",
    "degraded_share": "Bozulmuş / şema onarımı payı",
    "distractor_unused_share": "Kullanılmayan çeldirici payı",
    "isolation_tests": "Veri yalıtımı testleri",
    "key_leak_tests": "Cevap anahtarı sızıntı testleri",
}


@dataclass
class GateRow:
    metric: str
    required: bool
    value: float | None
    n: int | None
    threshold: str
    verdict: str
    note: str = ""

    def as_dict(self) -> dict[str, Any]:
        return dict(self.__dict__)


@dataclass
class GateResult:
    period: str | None
    rows: list[GateRow]
    open: bool

    @property
    def label(self) -> str:
        return "AÇIK" if self.open else "KAPALI"

    def as_dict(self) -> dict[str, Any]:
        return {"period": self.period, "gate": self.label, "rows": [r.as_dict() for r in self.rows]}


THRESHOLD_KEYS = frozenset({"min", "max", "max_usd", "n_min", "required"})
BOUND_KEYS = ("min", "max", "max_usd")
CI_VALUES = ("pass",)


def _is_number(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def validate_thresholds(value: Any) -> dict[str, Any]:
    """``settings.pilot_gate`` değerini doğrular; şüpheli her giriş ``OGR-KLK-020`` (kapı açık kalmasın)."""
    if not isinstance(value, Mapping) or not value:
        raise KulaklikError("OGR-KLK-020 settings.pilot_gate yok; pilot kapısı eşikleri kodda tanımlı değildir "
                            "(ADR-0013: eşik yalnız settings.pilot_gate + ADR ile değişir)")
    for metric, raw in value.items():
        where = f"settings.pilot_gate.{metric}"
        if isinstance(raw, str):
            if raw not in CI_VALUES:
                raise KulaklikError(f"OGR-KLK-020 {where} dize eşiği yalnız \"pass\" olabilir: {raw!r}")
            continue
        if not isinstance(raw, Mapping):
            raise KulaklikError(f"OGR-KLK-020 {where} nesne ya da \"pass\" olmalı")
        unknown = sorted(set(raw) - THRESHOLD_KEYS)
        if unknown:
            raise KulaklikError(f"OGR-KLK-020 {where} bilinmeyen anahtar: {unknown[0]}")
        for key in (*BOUND_KEYS, "n_min"):
            if key in raw and not _is_number(raw[key]):
                raise KulaklikError(f"OGR-KLK-020 {where}.{key} sayı olmalı: {raw[key]!r}")
        if "n_min" in raw and raw["n_min"] < 0:
            raise KulaklikError(f"OGR-KLK-020 {where}.n_min negatif olamaz")
        if "required" in raw and not isinstance(raw["required"], bool):
            raise KulaklikError(f"OGR-KLK-020 {where}.required true/false olmalı: {raw['required']!r}")
        if not any(key in raw for key in BOUND_KEYS):
            raise KulaklikError(f"OGR-KLK-020 {where} en az bir sınır (min, max, max_usd) taşımalı")
    return dict(value)


def load_thresholds(db: Any) -> dict[str, Any]:
    return validate_thresholds(setting(db, "pilot_gate", None))


def load_ci_status(spec: str | None) -> dict[str, str]:
    """``--ci-status``: JSON dosyası yolu ya da satır içi JSON (``{"isolation_tests": "pass", ...}``)."""
    if not spec:
        return {}
    text = spec
    path = Path(spec)
    if not spec.lstrip().startswith("{") and path.is_file():
        text = path.read_text(encoding="utf-8")
    try:
        data = json.loads(text)
    except json.JSONDecodeError as exc:
        raise KulaklikError(f"OGR-KLK-021 --ci-status JSON değil: {exc}") from exc
    if not isinstance(data, Mapping):
        raise KulaklikError("OGR-KLK-021 --ci-status bir nesne olmalı")
    out = {}
    for k, v in data.items():
        if v not in ("pass", "fail"):
            raise KulaklikError(f"OGR-KLK-021 --ci-status değeri pass|fail olmalı: {k}={v!r}")
        out[str(k)] = str(v)
    return out


def _n(detail: Mapping[str, Any] | None) -> int | None:
    for key in ("n", "n_rated"):
        value = (detail or {}).get(key)
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            return int(value)
    return None


def _threshold_text(metric: str, t: Mapping[str, Any] | str) -> str:
    if isinstance(t, str):
        return f"= {t}"
    parts = []
    if isinstance(t.get("min"), (int, float)):
        parts.append(f"≥ {tr_number(float(t['min']), 2)}")
    if isinstance(t.get("max"), (int, float)):
        parts.append(f"≤ {tr_number(float(t['max']), 2)}")
    if isinstance(t.get("max_usd"), (int, float)):
        parts.append(f"≤ {tr_usd(float(t['max_usd']))}")
    if isinstance(t.get("n_min"), (int, float)):
        parts.append(f"n ≥ {int(t['n_min'])}")
    return ", ".join(parts)


def evaluate(thresholds: Mapping[str, Any], metrics: list[Mapping[str, Any]],
             ci_status: Mapping[str, str] | None = None) -> GateResult:
    """``metrics``: ``pilot_metrics`` satırları (birden çok dönem olabilir; en son dönem kullanılır)."""
    thresholds = validate_thresholds(thresholds)
    ci_status = dict(ci_status or {})
    periods = [str(m["period"])[:10] for m in metrics]
    period = max(periods) if periods else None
    latest = {m["metric"]: m for m in metrics if str(m["period"])[:10] == period}
    rows: list[GateRow] = []
    for metric, raw in thresholds.items():
        if isinstance(raw, str):
            status = ci_status.get(metric)
            verdict = "NO_DATA" if status is None else ("PASS" if status == raw else "FAIL")
            note = "CI durumu verilmedi (--ci-status)" if status is None else f"CI: {status}"
            rows.append(GateRow(metric, True, None, None, _threshold_text(metric, raw), verdict, note))
            continue
        t = dict(raw)
        row = latest.get(metric)
        value = row.get("value") if row else None
        value = float(value) if isinstance(value, (int, float)) and not isinstance(value, bool) else None
        n = _n(row.get("detail") if row else None)
        if row is None:
            verdict, note = "NO_DATA", "bu dönemde ölçüm yok"
        elif value is None:
            verdict, note = "NO_DATA", "yeterli veri yok (value=null)"
        elif "n_min" in t and (n is None or n < t["n_min"]):
            verdict, note = "NO_DATA", f"örnek az (n={n if n is not None else 0} < {int(t['n_min'])})"
        else:
            checks = []
            if "min" in t:
                checks.append(value >= float(t["min"]))
            if "max" in t:
                checks.append(value <= float(t["max"]))
            if "max_usd" in t:
                checks.append(value <= float(t["max_usd"]))
            ok = bool(checks) and all(checks)
            verdict, note = ("PASS", "") if ok else ("FAIL", "eşik sağlanmadı")
        rows.append(GateRow(metric, t.get("required", True) is not False, value, n, _threshold_text(metric, t),
                            verdict, note))
    is_open = all(r.verdict == "PASS" for r in rows if r.required) and any(r.required for r in rows)
    return GateResult(period=period, rows=rows, open=is_open)


def _value_text(row: GateRow) -> str:
    if row.value is None:
        return "—"
    if row.metric == "cost_per_student":
        return tr_usd(row.value, 4)
    return tr_number(row.value, 4)


def render_markdown(result: GateResult) -> str:
    lines = [f"# Pilot kapısı — dönem {result.period or 'yok'}", "",
             "Eşikler `settings.pilot_gate` satırından okunur (ADR-0013). Zorunlu ölçütlerin hepsi PASS olmadıkça "
             "kapı açılmaz; NO_DATA kapıyı açmaz. Zorunlu olmayan ölçütler bilgi satırıdır.", "",
             "| Ölçüt | Zorunlu | Değer | Eşik | n | Sonuç | Not |", "| --- | --- | --- | --- | --- | --- | --- |"]
    for r in result.rows:
        required = "evet" if r.required else "hayır (bilgi)"
        lines.append(f"| {LABELS.get(r.metric, r.metric)} (`{r.metric}`) | {required} | "
                     f"{_value_text(r)} | {r.threshold} | {'—' if r.n is None else r.n} | {r.verdict} | "
                     f"{r.note or '—'} |")
    missing = [r for r in result.rows if r.required and r.verdict != "PASS"]
    lines.append("")
    if missing:
        lines.append("Kapıyı kapalı tutan zorunlu ölçütler: " + ", ".join(
            f"`{r.metric}` ({r.verdict})" for r in missing) + ".")
        lines.append("")
    lines.append(f"Kapı: {result.label}")
    return "\n".join(lines) + "\n"
