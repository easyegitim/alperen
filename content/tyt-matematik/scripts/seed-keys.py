#!/usr/bin/env python3
"""Teşhis cevap anahtarlarını veritabanına yazar ve teşhis sorularını onaylı duruma çeker (BLUEPRINT §3.11 adım 4).

Yalnız kurucunun makinesinde ``service_role``/``postgres`` bağlantısıyla ve ``db-test.sh`` canlı testinde
yerel ``postgres`` rolüyle çalışır. Adımlar tek işlemde (``begin … commit``):

1. ``diagnostic/answer-keys.json`` okunur, her anahtar SymPy ile doğrulanır (``canonical_expr`` doğru şıkkı verir).
2. ``public.questions``'ta 20 teşhis sorusundan biri yoksa ``OGR-SEED-001`` ile durur (önce ``export-sql.py``
   çıktısı uygulanır).
3. ``draft``/``pending_review``/``approved`` bir teşhis sorusunun DB'deki ``content_hash``'i, anahtarın SymPy ile
   doğrulandığı ``items.json`` içeriğinden farklıysa ``OGR-SEED-003`` ile durur: anahtar, doğrulanmadığı bir
   kök/şık kümesine asla yazılmaz ve o soru onaylanmaz.
4. ``secure.answer_keys``'e ``sympy_status='verified'``, ``written_by='seed'`` yazılır (yalnız içerik özeti
   eşleşen soruya); var olan ``seed`` anahtarı güncellenir, eğitmen anahtarı (``staff:<uuid>``) değiştirilmez.
5. ``set_config('ogrenmen.reviewer','on',true)`` ile ``draft``/``pending_review`` teşhis soruları ``approved`` olur
   (``questions_approve_guard`` anahtarı ve doğrulanmış şekli bulur). Eğitmenin emekliye ayırdığı (``retired``) ya
   da reddettiği (``rejected``) soru geri çekilmez; atlanır ve kodu çıktıda listelenir. 20 sorunun her biri
   ``approved``/``retired``/``rejected`` değilse ``OGR-SEED-002``.

``OGR-SEED-00x`` kodları M03'e özgüdür (seed SQL'inin ``raise``'ı; migration'larda tanımlı DB kodu değildir).

SQL ``psql`` istemcisine stdin'den verilir; anahtar değerleri komut satırına, çıktıya ya da dosyaya yazılmaz.
Bağlantı parolası da komut satırına konmaz: URL'den ayrılıp alt sürecin ortamına ``PGPASSWORD`` olarak verilir.
``answer-keys.json`` yoksa ``SKIP: no keys`` yazar ve 0 ile çıkar.

``--schema v2`` (supabase/migrations v2 tabanı; ``supabase/scripts/db-test.sh`` bunu kullanır): inceleyen ``staff``
koordinatörü yerine ilk ``admin`` profilidir (yoksa boş); v1'in ``questions_approve_guard``/``ogrenmen.reviewer``
mekanizması yoktur (onay doğrudan yazılır). Ek olarak ``export-sql.py --schema v2``'nin teşhis testi
(``exams.kind='diagnostic'``) sorularına ``secure.exam_answer_keys`` satırı (``source='instructor'``) aynı anahtardan
yazılır; böylece teşhis testi ``grade_exam_session`` ile notlanır. Var olan ``instructor`` kaynaklı sınav anahtarı
güncellenir, diğer kaynaklar (eğitmenin ``uploaded`` düzeltmesi vb.) değiştirilmez. Varsayılan ``--schema v1``.
"""

from __future__ import annotations

import argparse
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path
from urllib.parse import parse_qsl, unquote, urlencode, urlsplit, urlunsplit

sys.path.insert(0, str(Path(__file__).resolve().parent))

import _contentlib as lib  # noqa: E402
from _contentlib import C, jsonb, num, q  # noqa: E402

REVIEW_NOTE = "seed: teşhis anahtarı yazıldı"
SCHEMAS = ("v1", "v2")
SEED_ADMIN_V2 = "(select p.id from public.profiles p where p.role = 'admin' order by p.created_at limit 1)"
SKIPPED_MARK = "ogrenmen-seed-keys-skipped:"


def verified_keys(content: lib.Content) -> list[tuple[str, dict, dict, str, str]]:
    """(question_id, anahtar, sympy_report, kod, content_hash) listesi; doğrulanamayan anahtar → ContentError."""
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
        out.append((C.uid("question", item["code"]), key, report, item["code"],
                    C.content_hash(item["stem"], item["options"])))
    if problems:
        raise lib.ContentError("; ".join(problems))
    return out


def build_sql(content: lib.Content, schema: str = "v1") -> str:
    if schema not in SCHEMAS:
        raise lib.ContentError(f"bilinmeyen şema {schema!r} (v1 | v2)")
    v2 = schema == "v2"
    rows = verified_keys(content)
    n = len(rows)
    coordinator = SEED_ADMIN_V2 if v2 else ("(select s.id from public.staff s where s.role = 'coordinator' and s.active "
                                            "order by s.created_at limit 1)")
    expected = ",\n  ".join(f"({q(qid)}, {q(code)}, {q(chash)})" for qid, _k, _r, code, chash in rows)
    lines = [
        "begin;",
        "create temporary table seed_keys_expected (id uuid primary key, code text not null, "
        "content_hash text not null) on commit drop;",
        f"insert into seed_keys_expected (id, code, content_hash) values\n  {expected};",
        "do $$",
        "declare",
        "  v_missing text;",
        "  v_drift text;",
        "begin",
        "  select string_agg(e.code, ', ' order by e.code) into v_missing from seed_keys_expected e",
        "    where not exists (select 1 from public.questions qq where qq.id = e.id and qq.source = 'diagnostic');",
        "  if v_missing is not null then",
        "    raise exception 'OGR-SEED-001 teşhis soruları yok: önce export-sql.py çıktısını uygula (%)', v_missing;",
        "  end if;",
        "  select string_agg(e.code, ', ' order by e.code) into v_drift from seed_keys_expected e",
        "    join public.questions qq on qq.id = e.id",
        "    where qq.status in ('draft', 'pending_review', 'approved') and qq.content_hash is distinct from e.content_hash;",
        "  if v_drift is not null then",
        "    raise exception 'OGR-SEED-003 veritabanındaki teşhis sorusu anahtarın doğrulandığı içerikten farklı: %', "
        "v_drift;",
        "  end if;",
        "end $$;",
    ]
    for qid, key, report, _code, _chash in rows:
        lines.append(
            "insert into secure.answer_keys (question_id, correct_option, numeric_value, numeric_tolerance, "
            "canonical_expr, solution, sympy_status, sympy_report, written_by, verified_at)\n"
            f"  select {q(qid)}::uuid, {q(key['correct_option'])}, {q(key.get('numeric_value'))}, "
            f"{num(key.get('numeric_tolerance') or 0)}, {q(key['canonical_expr'])}, {q(key['solution'])}, 'verified', "
            f"{jsonb(report)}, 'seed', now()\n"
            "  where exists (select 1 from public.questions qq join seed_keys_expected e on e.id = qq.id "
            f"where qq.id = {q(qid)}::uuid and qq.content_hash = e.content_hash)\n"
            "  on conflict (question_id) do update set correct_option = excluded.correct_option, "
            "numeric_value = excluded.numeric_value, numeric_tolerance = excluded.numeric_tolerance, "
            "canonical_expr = excluded.canonical_expr, solution = excluded.solution, sympy_status = excluded.sympy_status, "
            "sympy_report = excluded.sympy_report, verified_at = excluded.verified_at\n"
            "  where secure.answer_keys.written_by = 'seed';"
        )
    if v2:
        # teşhis testi (exams.kind='diagnostic') soruları: aynı anahtar secure.exam_answer_keys'e (source='instructor')
        lines.append(
            "insert into secure.exam_answer_keys (exam_question_id, correct_option, numeric_value, source)\n"
            "  select eq.id, case when eq.kind = 'mcq' then ak.correct_option end, "
            "case when eq.kind = 'numeric' then app.parse_number(ak.numeric_value) end, 'instructor'\n"
            "  from public.exam_questions eq join public.exams x on x.id = eq.exam_id and x.kind = 'diagnostic'\n"
            "  join seed_keys_expected e on e.id = eq.question_id\n"
            "  join secure.answer_keys ak on ak.question_id = eq.question_id and ak.written_by = 'seed'\n"
            "  where eq.kind in ('mcq', 'numeric')\n"
            "  on conflict (exam_question_id) do update set correct_option = excluded.correct_option, "
            "numeric_value = excluded.numeric_value\n"
            "  where secure.exam_answer_keys.source = 'instructor';"
        )
    lines += [] if v2 else ["select set_config('ogrenmen.reviewer', 'on', true);"]
    lines += [
        f"update public.questions set status = 'approved', reviewed_by = {coordinator}, reviewed_at = now(), "
        f"review_note = {q(REVIEW_NOTE)}",
        "  where id in (select e.id from seed_keys_expected e) and status in ('draft', 'pending_review');",
        "do $$ begin",
        "  if (select count(*) from public.questions qq join seed_keys_expected e on e.id = qq.id",
        f"      where qq.status in ('approved', 'retired', 'rejected')) <> {n} then",
        "    raise exception 'OGR-SEED-002 teşhis soruları onaylanamadı';",
        "  end if;",
        "end $$;",
        f"select {q(SKIPPED_MARK)} || coalesce(string_agg(e.code || '=' || qq.status, ',' order by e.code), '')",
        "  from seed_keys_expected e join public.questions qq on qq.id = e.id where qq.status in ('retired', 'rejected');",
        "commit;",
        "",
    ]
    return "\n".join(lines)


_CONNINFO_PASSWORD = re.compile(r"(?:^|\s)password\s*=\s*('(?:[^'\\]|\\.)*'|\S+)")


def split_password(database_url: str) -> tuple[str, str | None]:
    """Bağlantı dizesinden parolayı ayırır: (parolasız dize, parola | None). URL ve ``key=value`` biçimi."""
    if re.match(r"^postgres(ql)?://", database_url):
        parts = urlsplit(database_url)
        password = unquote(parts.password) if parts.password is not None else None
        netloc = parts.netloc
        if "@" in netloc:
            userinfo, host = netloc.rsplit("@", 1)
            user = userinfo.split(":", 1)[0]
            netloc = f"{user}@{host}" if user else host
        query = parse_qsl(parts.query, keep_blank_values=True)
        for k, v in query:
            if k == "password":
                password = v
        query = [(k, v) for k, v in query if k != "password"]
        return urlunsplit((parts.scheme, netloc, parts.path, urlencode(query), parts.fragment)), password
    m = _CONNINFO_PASSWORD.search(database_url)
    if not m:
        return database_url, None
    raw = m.group(1)
    password = re.sub(r"\\(.)", r"\1", raw[1:-1]) if raw.startswith("'") else raw
    return (database_url[:m.start()] + database_url[m.end():]).strip(), password


def run_psql(database_url: str, sql: str) -> subprocess.CompletedProcess:
    psql = shutil.which("psql")
    if psql is None:
        raise lib.ContentError("psql istemcisi bulunamadı (PATH)")
    dsn, password = split_password(database_url)
    env = {**os.environ, "PGAPPNAME": "ogrenmen-seed-keys"}
    if password is not None:
        env["PGPASSWORD"] = password
    return subprocess.run([psql, "-X", "-q", "-At", "-v", "ON_ERROR_STOP=1", "-d", dsn, "-f", "-"], input=sql,
                          capture_output=True, text=True, env=env, timeout=120)


def skipped_codes(stdout: str) -> list[str]:
    for line in stdout.splitlines():
        if line.startswith(SKIPPED_MARK):
            return [x for x in line[len(SKIPPED_MARK):].split(",") if x]
    return []


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Teşhis anahtarlarını yazar, teşhis sorularını onaylar")
    ap.add_argument("--database-url", default=os.environ.get("OGRENMEN_DATABASE_URL"),
                    help="postgres bağlantısı (service_role/postgres); varsayılan $OGRENMEN_DATABASE_URL")
    ap.add_argument("--content", type=Path, default=lib.CONTENT_DIR)
    ap.add_argument("--dry-run", action="store_true", help="anahtarları doğrula, DB'ye yazma (anahtar yazdırılmaz)")
    ap.add_argument("--schema", choices=SCHEMAS, default="v1",
                    help="hedef veritabanı tabanı: v1 (eski, varsayılan) | v2 (supabase/migrations v2; admin profili, "
                         "teşhis testi sınav anahtarları)")
    args = ap.parse_args(argv)
    keys_path = args.content / "diagnostic" / "answer-keys.json"
    if not keys_path.exists():
        print("SKIP: no keys")
        return 0
    try:
        content = lib.load_content(args.content)
        sql = build_sql(content, schema=args.schema)
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
    skipped = skipped_codes(result.stdout)
    for entry in skipped:
        code, _, status = entry.partition("=")
        print(f"seed-keys: atlandı {code} (durum {status}; eğitmen kararı korunur)")
    print(f"seed-keys: {count - len(skipped)} teşhis sorusu onaylı, {len(skipped)} atlandı ({content.code})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
