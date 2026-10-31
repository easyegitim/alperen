#!/usr/bin/env python3
"""Teşhis cevap anahtarlarını veritabanına yazar ve teşhis sorularını onaylı duruma çeker (BLUEPRINT §3.11 adım 4).

Yalnız kurucunun makinesinde ``service_role``/``postgres`` bağlantısıyla ve ``db-test.sh`` canlı testinde
yerel ``postgres`` rolüyle çalışır. Adımlar tek işlemde (``begin … commit``):

1. ``diagnostic/answer-keys.json`` okunur, her anahtar SymPy ile doğrulanır (``canonical_expr`` doğru şıkkı verir).
2. ``public.questions``'ta 20 teşhis sorusu yoksa ``OGR-SEED-001`` ile durur (önce ``export-sql.py`` çıktısı uygulanır).
3. ``secure.answer_keys``'e ``sympy_status='verified'``, ``written_by='seed'`` yazılır; var olan ``seed`` anahtarı
   güncellenir, eğitmen anahtarı (``staff:<uuid>``) değiştirilmez.
4. ``set_config('ogrenmen.reviewer','on',true)`` ile teşhis soruları ``approved`` olur (``questions_approve_guard``
   anahtarı ve doğrulanmış şekli bulur).

SQL ``psql`` istemcisine stdin'den verilir; anahtar değerleri komut satırına, çıktıya ya da dosyaya yazılmaz.
``answer-keys.json`` yoksa ``SKIP: no keys`` yazar ve 0 ile çıkar.
"""

from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import _contentlib as lib  # noqa: E402
from _contentlib import C, jsonb, q, uuid_array  # noqa: E402

REVIEW_NOTE = "seed: teşhis anahtarı yazıldı"


def verified_keys(content: lib.Content) -> list[tuple[str, dict, dict]]:
    """(question_id, anahtar, sympy_report) listesi; doğrulanamayan anahtar → ContentError."""
    if content.keys is None:
        raise lib.ContentError("answer-keys.json yok")
    from ogrenmen_contracts import errors

    problems = [f"answer-keys.json: {e}" for e in errors("diagnostic-keys", content.keys)[:10]]
    out = []
    for item in content.items:
        key = content.keys.get(item["code"])
        if key is None:
            problems.append(f"{item['code']}: anahtar yok")
            continue
        problem, report = lib.verify_key(item, key)
        if problem:
            problems.append(f"{item['code']}: {problem}")
            continue
        out.append((C.uid("question", item["code"]), key, report))
    if problems:
        raise lib.ContentError("; ".join(problems))
    return out


def build_sql(content: lib.Content) -> str:
    rows = verified_keys(content)
    ids = [qid for qid, _, _ in rows]
    n = len(ids)
    coordinator = ("(select s.id from public.staff s where s.role = 'coordinator' and s.active "
                   "order by s.created_at limit 1)")
    lines = [
        "begin;",
        "do $$ begin",
        f"  if (select count(*) from public.questions where id = any({uuid_array(ids)}) and source = 'diagnostic') <> {n} then",
        "    raise exception 'OGR-SEED-001 teşhis soruları yok: önce export-sql.py çıktısını uygula';",
        "  end if;",
        "end $$;",
    ]
    for qid, key, report in rows:
        lines.append(
            "insert into secure.answer_keys (question_id, correct_option, numeric_value, numeric_tolerance, "
            "canonical_expr, solution, sympy_status, sympy_report, written_by, verified_at) values "
            f"({q(qid)}, {q(key['correct_option'])}, {q(key.get('numeric_value'))}, "
            f"{key.get('numeric_tolerance', 0)}, {q(key['canonical_expr'])}, {q(key['solution'])}, 'verified', "
            f"{jsonb(report)}, 'seed', now())\n"
            "  on conflict (question_id) do update set correct_option = excluded.correct_option, "
            "numeric_value = excluded.numeric_value, numeric_tolerance = excluded.numeric_tolerance, "
            "canonical_expr = excluded.canonical_expr, solution = excluded.solution, sympy_status = excluded.sympy_status, "
            "sympy_report = excluded.sympy_report, verified_at = excluded.verified_at\n"
            "  where secure.answer_keys.written_by = 'seed';"
        )
    lines += [
        "select set_config('ogrenmen.reviewer', 'on', true);",
        f"update public.questions set status = 'approved', reviewed_by = {coordinator}, reviewed_at = now(), "
        f"review_note = {q(REVIEW_NOTE)}",
        f"  where id = any({uuid_array(ids)}) and status in ('draft', 'pending_review');",
        "do $$ begin",
        f"  if (select count(*) from public.questions where id = any({uuid_array(ids)}) and status = 'approved') <> {n} then",
        "    raise exception 'OGR-SEED-002 teşhis soruları onaylanamadı';",
        "  end if;",
        "end $$;",
        "commit;",
        "",
    ]
    return "\n".join(lines)


def run_psql(database_url: str, sql: str) -> subprocess.CompletedProcess:
    psql = shutil.which("psql")
    if psql is None:
        raise lib.ContentError("psql istemcisi bulunamadı (PATH)")
    env = {**os.environ, "PGAPPNAME": "ogrenmen-seed-keys"}
    return subprocess.run([psql, database_url, "-X", "-q", "-v", "ON_ERROR_STOP=1", "-f", "-"], input=sql,
                          capture_output=True, text=True, env=env, timeout=120)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Teşhis anahtarlarını yazar, teşhis sorularını onaylar")
    ap.add_argument("--database-url", default=os.environ.get("OGRENMEN_DATABASE_URL"),
                    help="postgres bağlantısı (service_role/postgres); varsayılan $OGRENMEN_DATABASE_URL")
    ap.add_argument("--content", type=Path, default=lib.CONTENT_DIR)
    ap.add_argument("--dry-run", action="store_true", help="anahtarları doğrula, DB'ye yazma (anahtar yazdırılmaz)")
    args = ap.parse_args(argv)
    keys_path = args.content / "diagnostic" / "answer-keys.json"
    if not keys_path.exists():
        print("SKIP: no keys")
        return 0
    try:
        content = lib.load_content(args.content)
        sql = build_sql(content)
    except lib.ContentError as exc:
        print(f"HATA: {exc}", file=sys.stderr)
        return 1
    count = sql.count("insert into secure.answer_keys")
    if args.dry_run:
        print(f"seed-keys: {count} anahtar SymPy ile doğrulandı (dry-run; DB'ye yazılmadı)")
        return 0
    if not args.database_url:
        print("HATA: --database-url ya da OGRENMEN_DATABASE_URL gerekli", file=sys.stderr)
        return 2
    try:
        result = run_psql(args.database_url, sql)
    except (lib.ContentError, subprocess.TimeoutExpired) as exc:
        print(f"HATA: {exc}", file=sys.stderr)
        return 1
    if result.returncode != 0:
        # psql hata metni SQL'i yankılamaz (-q, ON_ERROR_STOP); yalnız hata satırları gösterilir
        err = "\n".join(line for line in result.stderr.splitlines() if "ERROR" in line or "HATA" in line or "OGR-" in line)
        print(f"HATA: anahtarlar yazılamadı (psql çıkış {result.returncode}):\n{err}", file=sys.stderr)
        return 1
    print(f"seed-keys: {count} teşhis anahtarı yazıldı, {count} soru onaylandı ({content.code})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
