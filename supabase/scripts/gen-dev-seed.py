#!/usr/bin/env python3
"""fixtures/db/dev-seed.json → supabase/seed/dev/*.sql (BLUEPRINT §3.11 adım 5).

Worker FakeDb, panel mock ve SQL testleri aynı dünyayı görsün diye geliştirme verisi tek JSON'dan üretilir.
Sütun tipleri migration'lardan (pglast) okunur; kimlik (identity) sütunlarına açık değer "overriding system value"
ile yazılır ve diziler sonra ilerletilir; üretilen (generated) sütunlar atlanır. Tüm satırlar "on conflict do nothing"
ile yazılır (müfredat seed'iyle örtüşen satırlar ezilmez). Onaylı sorular önce taslak yazılır, anahtarlar eklendikten
sonra ogrenmen.reviewer/key_peeked açıkken onaylanır (questions_approve_guard çalışır, atlanmaz); puanlanmış denemeler
ogrenmen.grader açıkken yazılır. Yalnız db-test.sh --dev yükler; M13 scripts/sync-fixtures.sh eşitliği --check ile denetler.

Kullanım: python supabase/scripts/gen-dev-seed.py [--check] [--json fixtures/db/dev-seed.json] [--out supabase/seed/dev]
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import pglast
from pglast import ast
from pglast.enums import ConstrType

ROOT = Path(__file__).resolve().parents[2]
MIGRATIONS = ROOT / "supabase" / "migrations"

# Dosya → tablo sırası (yabancı anahtar ve tetikleyici bağımlılıklarına göre)
GROUPS: list[tuple[str, str, list[str]]] = [
    ("01_reference.sql", "başvuru tabloları (kota, ayar, bayrak, saklama, hukuk, müfredat)", [
        "quota_tiers", "quota_limits", "settings", "runtime_flags", "retention_policies", "legal_texts", "curricula",
        "skills", "skill_prerequisites", "misconception_tags", "question_templates"]),
    ("02_people.sql", "kişiler (personel, öğrenciler, secure kimlik verisi, onaylar, kayıtlar)", [
        "auth.users", "staff", "students", "staff_students", "secure.student_pii", "secure.telegram_identities",
        "secure.guardian_codes", "secure.staff_codes", "secure.auth_links", "consents", "enrollments", "preferences"]),
    ("03_content.sql", "içerik (şekiller, sorular, anahtarlar, teşhis, havuz, Kalem, Kitap)", [
        "figures", "questions", "secure.answer_keys", "diagnostic_tests", "content_pool", "courses", "syllabus_topics",
        "exam_sources", "exam_clusters", "exam_items", "exam_priority_plans", "research_requests", "research_outputs",
        "citations", "generation_requests"]),
    ("04_activity.sql", "etkinlik (sohbetler, mesajlar, teşhis, denemeler, ders, gözlem, hafıza, kayıtlar, alarmlar)", [
        "tg_chats", "chat_roles", "diagnostic_sessions", "sessions", "messages", "attempts", "lessons", "lesson_analyses",
        "lesson_claims", "instructor_notes", "observations", "mastery", "mastery_history", "misconceptions",
        "misconception_evidence", "memory_facts", "weekly_summaries", "bot_responses", "llm_calls", "spend_ledger",
        "provider_health", "quota_usage", "escalations", "instructor_alerts", "proactive_messages", "pilot_metrics"]),
]

CONFLICT_UPDATE = {"spend_ledger": "(day, purpose, provider) do update set calls = excluded.calls, tokens_in = excluded.tokens_in, "
                                   "tokens_out = excluded.tokens_out, cost_usd = excluded.cost_usd"}


def load_columns() -> dict[str, dict[str, dict]]:
    """şema.tablo → sütun → {type, array, identity, generated}."""
    cols: dict[str, dict[str, dict]] = {
        "auth.users": {"id": {"type": "uuid", "array": False}, "email": {"type": "text", "array": False},
                       "created_at": {"type": "timestamptz", "array": False}}}
    for path in sorted(MIGRATIONS.glob("*.sql")):
        for raw in pglast.parse_sql(path.read_text(encoding="utf-8")):
            st = raw.stmt
            if not isinstance(st, ast.CreateStmt):
                continue
            name = f"{st.relation.schemaname or 'public'}.{st.relation.relname}"
            table: dict[str, dict] = {}
            for el in st.tableElts or ():
                if not isinstance(el, ast.ColumnDef):
                    continue
                tname = el.typeName.names[-1].sval
                cons = {c.contype for c in (el.constraints or ())}
                table[el.colname] = {"type": tname, "array": bool(el.typeName.arrayBounds),
                                     "identity": ConstrType.CONSTR_IDENTITY in cons,
                                     "generated": ConstrType.CONSTR_GENERATED in cons}
            cols[name] = table
    return cols


def qualified(table: str) -> str:
    return table if "." in table else f"public.{table}"


def lit(value, col: dict) -> str:
    t = col["type"]
    if value is None:
        return "null"
    if col["array"]:
        base = {"int8": "bigint", "int4": "int", "int2": "smallint", "text": "text", "uuid": "uuid"}.get(t, t)
        if not value:
            return f"'{{}}'::{base}[]"
        return "array[" + ", ".join(lit(v, {"type": t, "array": False}) for v in value) + f"]::{base}[]"
    if t in ("jsonb", "json"):
        return "'" + json.dumps(value, ensure_ascii=False, separators=(",", ":")).replace("'", "''") + "'::jsonb"
    if t == "bool":
        return "true" if value else "false"
    if t in ("int2", "int4", "int8", "numeric", "float4", "float8") and isinstance(value, (int, float)) and not isinstance(value, bool):
        return repr(value)
    if t == "halfvec":
        return "'" + json.dumps(value, separators=(",", ":")) + "'::halfvec"
    return "'" + str(value).replace("'", "''") + "'"


LEGAL_REF_COLUMNS = {"legal_text_id", "recording_notice_legal_id"}
# diagnostic_sessions.test_id: teşhis testi kimliği müfredat seed'inde (export-sql.py) farklı uuid5 tohumuyla üretilir;
# başvuru doğal anahtar (curriculum_id, version) ile çözülür, böylece seed/dev içerik seed'inin üstüne de yüklenir.
DIAG_REF_COLUMNS = {("diagnostic_sessions", "test_id")}


def insert_sql(table: str, rows: list[dict], cols: dict[str, dict], legal: dict[str, tuple[str, str]],
               diag: dict[str, tuple[str, str]] | None = None) -> list[str]:
    """legal: legal_texts.id → (kind, version). Hukuk metni kimliği müfredat seed'iyle (export-sql.py) farklı olabilir;
    başvurular (kind, version) üzerinden çözülür."""
    name = qualified(table)
    spec = cols[name]
    out = []
    plain = table.split(".")[-1]
    for row in rows:
        unknown = set(row) - set(spec)
        if unknown:
            raise SystemExit(f"{table}: şemada olmayan sütun(lar) {sorted(unknown)}")
        keys = [k for k in row if not spec[k].get("generated")]
        if table == "questions" and row.get("status") == "approved":
            row = {**row, "status": "draft"}   # onay, anahtarlardan sonra kapıdan geçerek
        overriding = " overriding system value" if any(spec[k].get("identity") for k in keys) else ""
        conflict = CONFLICT_UPDATE.get(plain, "do nothing")
        def value(k):
            if k in LEGAL_REF_COLUMNS and row[k] in legal:
                kind, version = legal[row[k]]
                return (f"coalesce((select lt.id from public.legal_texts as lt where lt.kind = {lit(kind, {'type': 'text', 'array': False})} "
                        f"and lt.version = {lit(version, {'type': 'text', 'array': False})}), {lit(row[k], spec[k])}::uuid)")
            if (plain, k) in DIAG_REF_COLUMNS and diag and row[k] in diag:
                cur, version = diag[row[k]]
                return (f"coalesce((select dt.id from public.diagnostic_tests as dt where dt.curriculum_id = {lit(cur, {'type': 'uuid', 'array': False})} "
                        f"and dt.version = {lit(version, {'type': 'text', 'array': False})}), {lit(row[k], spec[k])}::uuid)")
            return lit(row[k], spec[k])
        vals = ", ".join(value(k) for k in keys)
        out.append(f"insert into {name} ({', '.join(keys)}){overriding} values ({vals})\n  on conflict {conflict};")
    return out


def render(data: dict, cols: dict) -> dict[str, str]:
    files: dict[str, str] = {}
    legal = {r["id"]: (r["kind"], r["version"]) for r in data.get("legal_texts", [])}
    diag = {r["id"]: (r["curriculum_id"], r["version"]) for r in data.get("diagnostic_tests", [])}
    seen = set()
    for fname, title, tables in GROUPS:
        lines = [f"-- seed/dev/{fname} — geliştirme verisi: {title}.",
                 "-- supabase/scripts/gen-dev-seed.py fixtures/db/dev-seed.json'dan üretir; elle düzenlenmez. Yalnız db-test.sh --dev.",
                 "begin;",
                 "select set_config('ogrenmen.grader', 'on', true);"]
        for table in tables:
            seen.add(table)
            rows = data.get(table) or []
            if table == "auth.users":
                rows = [{"id": s["id"], "email": None, "created_at": s.get("created_at")} for s in data.get("staff", [])]
            if not rows:
                continue
            lines.append("")
            lines.append(f"-- {table} ({len(rows)})")
            lines.extend(insert_sql(table, rows, cols, legal, diag))
            if table == "secure.answer_keys":
                approved = [q["id"] for q in data.get("questions", []) if q.get("status") == "approved"]
                if approved:
                    lines.append("")
                    lines.append("-- onaylı sorular: anahtar yazıldıktan sonra questions_approve_guard'dan geçerek")
                    lines.append("select set_config('ogrenmen.reviewer', 'on', true);")
                    lines.append("select set_config('ogrenmen.key_peeked', 'on', true);")
                    ids = ", ".join(f"'{i}'" for i in approved)
                    lines.append(f"update public.questions set status = 'approved' where id in ({ids}) and status = 'draft';")
                    lines.append("select set_config('ogrenmen.key_peeked', 'off', true);")
                    lines.append("select set_config('ogrenmen.reviewer', 'off', true);")
        idents = [(t, c) for t in tables for c, spec in cols.get(qualified(t), {}).items() if spec.get("identity") and data.get(t)]
        if idents:
            lines.append("")
            lines.append("-- kimlik dizileri açık değerlerin ardına")
            for t, c in idents:
                lines.append(f"select setval(pg_get_serial_sequence('{qualified(t)}', '{c}'), "
                             f"(select greatest(max({c}), 1) from {qualified(t)}));")
        lines += ["", "commit;", ""]
        files[fname] = "\n".join(lines)
    missing = [k for k in data if k not in seen]
    if missing:
        raise SystemExit(f"dev-seed.json tabloları üretim listesinde yok: {missing}")
    return files


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="fixtures/db/dev-seed.json → supabase/seed/dev/*.sql")
    ap.add_argument("--json", type=Path, default=ROOT / "fixtures" / "db" / "dev-seed.json")
    ap.add_argument("--out", type=Path, default=ROOT / "supabase" / "seed" / "dev")
    ap.add_argument("--check", action="store_true", help="yazma; dosyalar güncel değilse 1 ile çık")
    args = ap.parse_args(argv)
    data = json.loads(args.json.read_text(encoding="utf-8"))
    files = render(data, load_columns())
    stale = []
    for fname, text in files.items():
        path = args.out / fname
        if args.check:
            if not path.exists() or path.read_text(encoding="utf-8") != text:
                stale.append(fname)
        else:
            args.out.mkdir(parents=True, exist_ok=True)
            path.write_text(text, encoding="utf-8")
            print(f"yazıldı: {path}")
    if stale:
        print("seed/dev güncel değil: " + ", ".join(stale) + " (python supabase/scripts/gen-dev-seed.py)", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
