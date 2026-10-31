"""Saklama (``retention [--report] [--export-md <yol>]``) — BLUEPRINT §3.10, §6.2.

* İşler (pg_cron yedeği; ``batch_worker``'a açık RPC'ler): ``run_retention()`` (``retention_policies where
  enabled``: delete / null_columns / expire / custom ``app.retention_*``), ``cap_memory_facts()`` (öğrenci başına
  300 aktif olgu; ``storage_pressure`` iken 200), ``compute_table_sizes()`` (350 MB uyarı, 450 MB
  ``storage_pressure``).
* ``--report``: bu çalışmanın ``retention_runs`` sonuçları + ``storage_deletions`` kuyruğu (bekleyen/başarısız) +
  tablo boyutları → ``out/retention-report.md`` ve ``out/retention_report.json``.
* ``--export-md <yol>``: ``retention_policies``'ten insan-okur ``saklama-sureleri.md`` (M13 bunu
  ``docs/generated/saklama-sureleri.md`` olarak yazar). Kullanıcıya gösterilen süre metni aynı satırdan gelir
  (``user_facing_text`` + ``{days}``); ``messages.hard_delete`` için gün ``tg_chats.retention_days``'tir.
  Yalnız ``--export-md`` verilirse saklama işleri çalıştırılmaz.
"""

from __future__ import annotations

from collections import Counter
from typing import Any

from ogrenmen_common.clock import iso

from .common import tr_number

MB = 1024 * 1024

HANDLER_TEXT = {
    "app.retention_students_anonymize": "silme talebinden sonra kişisel veriler (ad, Telegram kimliği, veli "
                                        "iletişimi) silinir, mesaj metinleri boşaltılır, hafıza olguları ve haftalık "
                                        "özetler silinir; öğrenme verisi rastgele kimlikle kalır",
    "app.retention_lessons_video": "ders videosunun silinmesi için koordinatöre bildirim açılır; dosyayı kurucu "
                                   "makinesindeki `ders purge` siler ve öğrenciye ve veliye bildirilir",
    "app.retention_lessons_transcript": "kapalı kaydın isimsiz transkripti depodan silinir",
    "app.retention_enrollments_learning_data": "kapalı kayıtta kanıt alıntıları ve seçilen şıklar anonimleştirilir; "
                                               "ustalık sayıları rastgele kimlikle kalır",
    "app.retention_enrollments_closed": "kapalı kaydın hafıza olguları silinir; ustalık ve gözlemler kalır",
}
"""``mode='custom'`` işleyicilerinin insan-okur açıklaması (§3.0 tablosu)."""


def message_days(db: Any) -> int:
    """Mesaj saklama günü: grupların ``tg_chats.retention_days``'i (en sık değer; grup yoksa tüm sohbetler, o da yoksa
    90 — ``tg_chats.retention_days`` varsayılanı)."""
    chats = db.select("tg_chats", columns=("kind", "retention_days"))
    groups = [int(c["retention_days"]) for c in chats if c.get("kind") != "private" and c.get("retention_days")]
    pool = groups or [int(c["retention_days"]) for c in chats if c.get("retention_days")]
    if not pool:
        return 90
    return Counter(pool).most_common(1)[0][0]


def effective_days(policy: dict, db: Any) -> int:
    if policy["id"] == "messages.hard_delete":
        return message_days(db)
    return int(policy["days"])


def mode_text(policy: dict) -> str:
    mode = policy["mode"]
    if mode == "delete":
        return "silinir"
    if mode == "null_columns":
        return "şu alanlar boşaltılır: " + ", ".join(f"`{c}`" for c in policy.get("columns") or [])
    if mode == "expire":
        return "süresi dolmuş sayılır (`status='expired'`)"
    return HANDLER_TEXT.get(policy.get("handler") or "", f"özel işleyici `{policy.get('handler')}`")


def export_markdown(db: Any) -> str:
    policies = sorted(db.select("retention_policies"), key=lambda p: p["id"])
    lines = ["# Saklama süreleri", "",
             "Bu dosya `retention_policies` tablosundan `python -m ogrenmen_kulaklik retention --export-md` ile "
             "üretilir; elle düzenlenmez. Kullanıcıya gösterilen metin aynı satırdan gelir.", "",
             "| Kimlik | Tablo | Zaman sütunu | Gün | İşlem | Koşul | Kullanıcıya gösterilen metin | Etkin |",
             "| --- | --- | --- | --- | --- | --- | --- | --- |"]
    for p in policies:
        days = effective_days(p, db)
        shown = (p.get("user_facing_text") or "").replace("{days}", str(days)) or "—"
        schema = p.get("schema_name", "public")
        table = p["table_name"] if schema == "public" else f"{schema}.{p['table_name']}"
        lines.append(f"| `{p['id']}` | `{table}` | `{p['ts_column']}` | {days} | {mode_text(p)} | "
                     f"{('`' + p['condition_sql'] + '`') if p.get('condition_sql') else '—'} | {shown} | "
                     f"{'evet' if p.get('enabled', True) else 'hayır'} |")
    lines += ["", "`messages.hard_delete` satırının günü `tg_chats.retention_days` değeridir (mesajın `expires_at`'i "
              "`sent_at + retention_days`); depolama baskısında 60'a iner ve grup bildirimi yenilenir."]
    return "\n".join(lines) + "\n"


def run_jobs(db: Any) -> dict[str, Any]:
    runs = db.rpc("run_retention", {}) or []
    capped = db.rpc("cap_memory_facts", {})
    total = db.rpc("compute_table_sizes", {})
    return {"runs": runs, "cap_memory_facts": capped, "total_bytes": total}


def build_report(db: Any, jobs: dict[str, Any], now: Any) -> dict[str, Any]:
    queue = db.select("storage_deletions")
    pending = [q for q in queue if q.get("done_at") is None and not q.get("error")]
    failed = [q for q in queue if q.get("error")]
    sizes = db.select("table_sizes_daily")
    latest_day = max((str(s["day"]) for s in sizes), default=None)
    top = sorted((s for s in sizes if str(s["day"]) == latest_day), key=lambda s: -int(s["total_bytes"]))[:10]
    pressure = db.select("runtime_flags", where={"key": "storage_pressure"}, limit=1)
    return {
        "ran_at": iso(now),
        "runs": [{"policy_id": r["policy_id"], "affected_rows": int(r["affected_rows"])} for r in jobs["runs"]],
        "affected_total": sum(int(r["affected_rows"]) for r in jobs["runs"]),
        "cap_memory_facts": jobs["cap_memory_facts"],
        "storage_deletions": {"pending": len(pending), "failed": len(failed),
                              "by_bucket": dict(Counter(q["bucket"] for q in pending))},
        "total_bytes": jobs["total_bytes"],
        "storage_pressure": bool(pressure[0]["value"]) if pressure else False,
        "largest_tables": [{"table": s["table_name"], "bytes": int(s["total_bytes"]),
                            "rows": s.get("row_estimate")} for s in top],
    }


def render_report(rep: dict[str, Any]) -> str:
    lines = ["# Saklama raporu", "", f"Çalışma: {rep['ran_at']}", "",
             f"Etkilenen satır toplamı: {rep['affected_total']} · olgu tavanı ile `merged`: {rep['cap_memory_facts']}",
             "", "| Politika | Etkilenen satır |", "| --- | --- |"]
    lines += [f"| `{r['policy_id']}` | {r['affected_rows']} |" for r in rep["runs"]]
    sd = rep["storage_deletions"]
    lines += ["", "## Depolama silme kuyruğu", "",
              f"Bekleyen: {sd['pending']} · hatalı: {sd['failed']}"
              + ("" if not sd["by_bucket"] else " · " + ", ".join(
                  f"{k}: {v}" for k, v in sorted(sd["by_bucket"].items()))),
              "", "## Veritabanı boyutu", "",
              f"Toplam: {tr_number(rep['total_bytes'] / MB, 1)} MB (uyarı 350 MB, baskı 450 MB) · "
              f"depolama baskısı: {'açık' if rep['storage_pressure'] else 'kapalı'}", "",
              "| Tablo | Boyut | Satır |", "| --- | --- | --- |"]
    for t in rep["largest_tables"]:
        rows = t["rows"] if t["rows"] is not None else "—"
        lines.append(f"| `{t['table']}` | {tr_number(t['bytes'] / 1024, 1)} KB | {rows} |")
    return "\n".join(lines) + "\n"
