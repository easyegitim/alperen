"""Maliyet raporu (``cost-report --month [--check]``) ve harcama denetimi (``check-spend``) — §6.2, §8.4.

İki sütun grubu (defter tek, bütçe iki):

* **Sohbet ve toplu işler** — ``runtime_flags.cap_excluded_purposes`` DIŞINDAKİ amaçlar: ay toplamı, aylık tavana
  oran, öğrenci başına gerçek maliyet (``toplam / aktif öğrenci``), sağlayıcı payı, ücretsiz düşüş oranı, en pahalı
  10 tur (``prompt_version`` ile), havuz isabet oranı.
* **Ders analizi** — ``lesson_analysis + transcribe + diarize``: ay toplamı, ders sayısı (``llm_calls.ref_table=
  'lessons'`` kimlikleri), ders başına ortalama, ``lesson_monthly_cap_usd``'ye oran. Öğrenci başına maliyete
  **dahil edilmez** (plan: ders ücretine yazılır).

``--check``: ``llm_calls`` toplamının ``spend_ledger``'la bağımsız karşılaştırması (yalnız sohbet/toplu); fark %5'i
aşarsa çıkış kodu 2 ("ledger drift"). Sohbet/toplu ay toplamı aylık tavanın %100'üne ulaşmışsa tek yönlü kill-switch
``set_runtime_flag('paid_llm_enabled', false)`` çağrılır (``batch_worker`` yalnız ``false`` yazabilir); RPC
reddederse hata yükselir, sessiz geçilmez.
"""

from __future__ import annotations

from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from ogrenmen_common.clock import iso

from . import pilot as P
from .common import (
    Students,
    Window,
    excluded_purposes,
    flag,
    safe_select,
    select_days,
    select_window,
    tr_number,
    tr_pct,
    tr_usd,
    week_window,
)

DRIFT_LIMIT = 0.05
EXIT_DRIFT = 2


@dataclass
class CostReport:
    data: dict[str, Any]
    markdown: str


def _providers(models: dict) -> dict[str, str]:
    return {name: info.get("tier", "free") for name, info in (models.get("providers") or {}).items()}


def pilot_section(db: Any, now: datetime | None) -> dict[str, Any]:
    """Son ``pilot_metrics`` dönemi; tablo okunamazsa (``batch_worker``) aynı veriden yeniden hesap."""
    rows = safe_select(db, "pilot_metrics")
    source = "pilot_metrics"
    if rows is None:
        if now is None:
            return {"period": None, "source": "okunamadı", "rows": []}
        rows = P.compute(db, week_window(None, now))
        source = "yeniden hesaplandı"
    last = max((str(p["period"])[:10] for p in rows), default=None)
    return {"period": last, "source": source,
            "rows": [{"metric": p["metric"], "value": p.get("value"), "detail": p.get("detail")}
                     for p in sorted(rows, key=lambda p: p["metric"]) if str(p["period"])[:10] == last]}


def compute(db: Any, month: Window, models: dict, now: datetime | None = None) -> dict[str, Any]:
    excluded = set(excluded_purposes(db))
    ledger = select_days(db, "spend_ledger", "day", month)
    calls = select_window(db, "llm_calls", "created_at", month)
    chat_rows = [r for r in ledger if r.get("purpose") not in excluded]
    lesson_rows = [r for r in ledger if r.get("purpose") in excluded]
    chat_usd = round(sum(float(r.get("cost_usd") or 0) for r in chat_rows), 6)
    lesson_usd = round(sum(float(r.get("cost_usd") or 0) for r in lesson_rows), 6)
    by_purpose: dict[str, dict[str, float]] = defaultdict(lambda: {"calls": 0, "cost_usd": 0.0})
    by_provider: dict[str, float] = defaultdict(float)
    for r in ledger:
        b = by_purpose[r["purpose"]]
        b["calls"] += int(r.get("calls") or 0)
        b["cost_usd"] = round(b["cost_usd"] + float(r.get("cost_usd") or 0), 6)
        if r.get("purpose") not in excluded:
            by_provider[r["provider"]] = round(by_provider[r["provider"]] + float(r.get("cost_usd") or 0), 6)
    students = Students.load(db)
    active = len(students.active_ids())
    lesson_ids = sorted({str(c["ref_id"]) for c in calls if c.get("purpose") in excluded
                         and c.get("ref_table") == "lessons" and c.get("ref_id")})
    lesson_cap = float(flag(db, "lesson_monthly_cap_usd", 30.0) or 0)
    monthly_cap = float(flag(db, "monthly_cap_usd", 0) or 0)
    tiers = _providers(models)
    responses = select_window(db, "bot_responses", "created_at", month,
                              columns=("id", "purpose", "provider", "prompt_version", "cost_usd", "cache_hit",
                                       "pool_id", "model"))
    llm_turns = [r for r in responses if r.get("provider")]
    free_turns = [r for r in llm_turns if tiers.get(r["provider"], "free") != "paid"]
    chat_turns = [r for r in responses if r.get("purpose") == "chat"]
    pool_hits = [r for r in chat_turns if r.get("cache_hit") or r.get("pool_id")]
    top = sorted(responses, key=lambda r: (-float(r.get("cost_usd") or 0), int(r["id"])))[:10]
    calls_chat = round(sum(float(c.get("cost_usd") or 0) for c in calls if c.get("purpose") not in excluded), 6)
    calls_lesson = round(sum(float(c.get("cost_usd") or 0) for c in calls if c.get("purpose") in excluded), 6)
    sizes = db.select("table_sizes_daily")
    latest = max((str(s["day"]) for s in sizes), default=None)
    return {
        "month": f"{month.start:%Y-%m}",
        "excluded_purposes": sorted(excluded),
        "chat": {
            "month_usd": chat_usd,
            "monthly_cap_usd": monthly_cap,
            "cap_share": round(chat_usd / monthly_cap, 4) if monthly_cap else None,
            "active_students": active,
            "cost_per_student": round(chat_usd / active, 4) if active else None,
            "provider_share": {p: round(v / chat_usd, 4) if chat_usd else 0.0 for p, v in sorted(by_provider.items())},
            "free_fallback_share": round(len(free_turns) / len(llm_turns), 4) if llm_turns else None,
            "pool_hit_share": round(len(pool_hits) / len(chat_turns), 4) if chat_turns else None,
            "top_turns": [{"id": int(r["id"]), "purpose": r.get("purpose"), "prompt_version": r.get("prompt_version"),
                           "model": r.get("model"), "cost_usd": float(r.get("cost_usd") or 0)} for r in top],
        },
        "lesson": {
            "month_usd": lesson_usd,
            "lessons": len(lesson_ids),
            "per_lesson_usd": round(lesson_usd / len(lesson_ids), 4) if lesson_ids else None,
            "lesson_monthly_cap_usd": lesson_cap,
            "cap_share": round(lesson_usd / lesson_cap, 4) if lesson_cap else None,
        },
        "by_purpose": {k: dict(v) for k, v in sorted(by_purpose.items())},
        "llm_calls": {"chat_usd": calls_chat, "lesson_usd": calls_lesson, "rows": len(calls)},
        "table_sizes": {"day": latest, "tables": sorted(({"table": s["table_name"], "bytes": int(s["total_bytes"])}
                                                         for s in sizes if str(s["day"]) == latest),
                                                        key=lambda t: -t["bytes"])[:10]},
        "pilot_metrics": pilot_section(db, now),
    }


def drift(data: dict[str, Any]) -> dict[str, Any]:
    """Sohbet/toplu: ``spend_ledger`` toplamı ↔ ``llm_calls`` toplamı (bağımsız yeniden hesap)."""
    ledger = float(data["chat"]["month_usd"])
    calls = float(data["llm_calls"]["chat_usd"])
    base = max(ledger, calls)
    ratio = abs(ledger - calls) / base if base else 0.0
    return {"ledger_usd": ledger, "llm_calls_usd": calls, "ratio": round(ratio, 4), "limit": DRIFT_LIMIT,
            "drift": ratio > DRIFT_LIMIT}


def render(data: dict[str, Any], *, check: dict[str, Any] | None = None) -> str:
    c, le = data["chat"], data["lesson"]
    lines = [f"# Maliyet raporu — {data['month']}", "",
             "Defter tektir, bütçe ikidir: ders analizi amaçları ("
             + ", ".join(f"`{p}`" for p in data["excluded_purposes"])
             + ") sohbet/toplu tavanına sayılmaz ve öğrenci başına maliyete dahil edilmez.", "",
             "| Kalem | Sohbet ve toplu işler | Ders analizi |", "| --- | --- | --- |",
             f"| Ay toplamı | {tr_usd(c['month_usd'])} | {tr_usd(le['month_usd'])} |",
             f"| Aylık tavan | {tr_usd(c['monthly_cap_usd'])} ({tr_pct(c['cap_share'])}) | "
             f"{tr_usd(le['lesson_monthly_cap_usd'])} ({tr_pct(le['cap_share'])}) |",
             f"| Öğrenci başına (aktif {c['active_students']}) | {tr_usd(c['cost_per_student'], 4)} | dahil değil |",
             f"| Ders sayısı | — | {le['lessons']} |",
             f"| Ders başına ortalama | — | {tr_usd(le['per_lesson_usd'])} |",
             f"| Ücretsiz katmana düşüş | {tr_pct(c['free_fallback_share'])} | — |",
             f"| Havuz isabet oranı | {tr_pct(c['pool_hit_share'])} | — |", ""]
    lines += ["## Sağlayıcı payı (sohbet ve toplu işler)", ""]
    lines += [f"- `{p}`: {tr_pct(s)}" for p, s in c["provider_share"].items()] or ["- veri yok"]
    lines += ["", "## Amaç kırılımı", "", "| Amaç | Çağrı | Tutar | Bütçe |", "| --- | --- | --- | --- |"]
    for purpose, b in data["by_purpose"].items():
        budget = "Ders analizi" if purpose in data["excluded_purposes"] else "Sohbet ve toplu işler"
        lines.append(f"| `{purpose}` | {b['calls']} | {tr_usd(b['cost_usd'])} | {budget} |")
    lines += ["", "## En pahalı 10 tur", "", "| Cevap | Amaç | İstem sürümü | Model | Tutar |",
              "| --- | --- | --- | --- | --- |"]
    lines += [f"| #{t['id']} | {t['purpose']} | {t['prompt_version'] or '—'} | {t['model'] or '—'} | "
              f"{tr_usd(t['cost_usd'], 6)} |" for t in c["top_turns"]] or ["| — | — | — | — | — |"]
    sizes = data["table_sizes"]
    lines += ["", f"## Tablo boyutları ({sizes['day'] or 'ölçüm yok'})", ""]
    lines += [f"- `{t['table']}`: {tr_number(t['bytes'] / 1024, 1)} KB" for t in sizes["tables"]] or ["- ölçüm yok"]
    pm = data["pilot_metrics"]
    lines += ["", f"## Pilot ölçütleri (dönem {pm['period'] or 'yok'})", ""]
    if pm.get("source") == "yeniden hesaplandı":
        lines += ["`pilot_metrics` bu rolle okunamadı (yetki yok); ölçütler aynı veriden yeniden hesaplandı.", ""]
    elif pm.get("source") == "okunamadı":
        lines += ["`pilot_metrics` okunamadı (yetki yok).", ""]
    for row in pm["rows"]:
        value = "henüz ölçülmedi" if row["value"] is None else tr_number(float(row["value"]), 4)
        lines.append(f"- `{row['metric']}`: {value}")
    if not pm["rows"]:
        lines.append("- henüz ölçülmedi")
    if check is not None:
        d = check["drift"]
        lines += ["", "## Defter denetimi", "",
                  f"`spend_ledger` {tr_usd(d['ledger_usd'])} · `llm_calls` {tr_usd(d['llm_calls_usd'])} · fark "
                  f"{tr_pct(d['ratio'])} (sınır {tr_pct(d['limit'])}) → "
                  + ("ledger drift" if d["drift"] else "tutarlı"),
                  f"Kill-switch (`paid_llm_enabled=false`): {'çağrıldı' if check['kill_switch'] else 'gerekmedi'}"]
    return "\n".join(lines) + "\n"


def run_check(db: Any, data: dict[str, Any], now: Any) -> dict[str, Any]:
    d = drift(data)
    share = data["chat"]["cap_share"]
    kill = share is not None and share >= 1.0
    if kill:
        db.rpc("set_runtime_flag", {"p_key": "paid_llm_enabled", "p_value": False})
    return {"checked_at": iso(now), "drift": d, "kill_switch": kill,
            "exit_code": EXIT_DRIFT if d["drift"] else 0}


def check_spend(db: Any, purposes: list[str]) -> dict[str, Any]:
    """``check_spend(p_purpose)`` her amaç için (gece işinin ilk adımı)."""
    out = {}
    for purpose in purposes:
        raw = db.rpc("check_spend", {"p_purpose": purpose})
        out[purpose] = dict(raw[0] if isinstance(raw, list) else raw)
    states = Counter(v.get("state") for v in out.values())
    return {"purposes": out, "states": dict(states)}
