#!/usr/bin/env bash
# supabase/scripts/db-test.sh — canlı Postgres'te v2 migration + seed + SQL testleri.
#
#   OGRENMEN_DATABASE_URL yoksa "SKIP: no database" yazar ve 0 ile çıkar (statik denetim lint.sh/check_sql.py'dedir).
#   Varsa o sunucuda geçici bir test veritabanı açar (OGRENMEN_TEST_DB, varsayılan ogrenmen_test; bağlanılan
#   veritabanına DOKUNMAZ — "ogrenmen" adı reddedilir), sırayla uygular:
#     tests/00_local_stub.sql (süper kullanıcıyla) → migrations/*.sql → seed/*.sql → müfredat seed'i
#     (content/tyt-matematik/scripts/export-sql.py --schema v2, çalışma anında üretilir; betik yoksa "SKIP: no content")
#     → seed'ler ve müfredat seed'i ikinci kez (tekrar uygulanabilirlik) → TYT teşhis anahtarları (content/tyt-matematik/
#     scripts/seed-keys.py --schema v2, iki kez: SymPy ile doğrulanır, secure.answer_keys + teşhis testi
#     secure.exam_answer_keys, 20 soru approved; betik ya da içerik yoksa "SKIP: no keys") → tests/[0-9][0-9]_*.sql
#     → scripts/pgboss-check.mjs (enqueue_job ↔ gerçek pg-boss şeması; apps/worker'ın pg-boss'u yoksa SKIP).
#   Migration ve seed adımları süper kullanıcı OLMAYAN migration sahibiyle (ogrenmen_owner, 00_local_stub.sql; Supabase'de
#   "postgres"in eşleniği) çalışır; testler bağlanan kullanıcıyla. v2'de cevap anahtarları yalnız public.set_exam_key()
#   ile, soru bankası anahtarları güvenilir oturumda secure.answer_keys'e yazılır; TYT anahtarlarını seed-keys.py yazar.
#   01_schema.sql pg_cron zamanlamalarını apps/worker/src/schedules.ts SCHEDULES ile karşılaştırır (dosya yoksa SKIP).
#   Çıktıda FAIL geçerse ya da bir adım düşerse 1 ile çıkar.
#
# Seçenekler:  --keep  test veritabanını bırak (incelemek için)
set -uo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ROOT="$(cd "$DIR/.." && pwd)"
PY="${PYTHON:-python3}"
KEEP=0
for arg in "$@"; do
  case "$arg" in
    --keep) KEEP=1 ;;
    -h|--help) sed -n '2,16p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) echo "HATA: bilinmeyen seçenek $arg" >&2; exit 2 ;;
  esac
done

if [ -z "${OGRENMEN_DATABASE_URL:-}" ]; then
  echo "SKIP: no database (OGRENMEN_DATABASE_URL tanımlı değil; statik denetim: scripts/lint.sh, scripts/check_sql.py)"
  exit 0
fi
if ! command -v psql >/dev/null 2>&1; then
  echo "HATA: psql istemcisi yok" >&2
  exit 1
fi

TESTDB="${OGRENMEN_TEST_DB:-ogrenmen_test}"
case "$TESTDB" in
  ogrenmen|postgres|template0|template1) echo "HATA: test veritabanı adı $TESTDB olamaz (silinir)" >&2; exit 2 ;;
esac
MIGRATION_ROLE="ogrenmen_owner"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

db_url() {   # aynı sunucu ve kimlik bilgileri, farklı veritabanı adı
  "$PY" - "$OGRENMEN_DATABASE_URL" "$1" <<'PYEOF'
import sys
from urllib.parse import urlsplit, urlunsplit
url, name = sys.argv[1], sys.argv[2]
p = urlsplit(url)
if p.scheme.startswith("postgres"):
    print(urlunsplit((p.scheme, p.netloc, "/" + name, p.query, p.fragment)))
else:   # key=value bağlantı dizesi
    import re
    print((re.sub(r"(^|\s)dbname=\S+", "", url).strip() + f" dbname={name}").strip())
PYEOF
}

PSQL=(psql -X -q -v ON_ERROR_STOP=1)
FAILED=0

run_file() {   # run_file <url> <dosya> [psql seçenekleri…]
  local url="$1" file="$2"
  shift 2
  "${PSQL[@]}" -d "$url" "$@" -f "$file"
}

recreate_db() {
  local name="$1"
  "${PSQL[@]}" -d "$OGRENMEN_DATABASE_URL" -c "set client_min_messages = warning" -c "drop database if exists \"$name\" with (force)" -c "create database \"$name\"" \
    || { echo "HATA: $name veritabanı oluşturulamadı (CREATEDB yetkisi gerekir)" >&2; exit 1; }
}

apply_seeds() {   # apply_seeds <url> — seed/*.sql + müfredat seed'i (tekrar uygulanabilir olmalı)
  local url="$1"
  for f in "$DIR"/seed/*.sql; do
    run_file "$url" "$f" --single-transaction >"$WORK/seed.log" 2>&1 || { cat "$WORK/seed.log"; echo "HATA: seed düştü: $(basename "$f")" >&2; exit 1; }
  done
  if [ "$HAVE_CONTENT" = 1 ]; then
    run_file "$url" "$WORK/curriculum.sql" -o /dev/null >"$WORK/cur.log" 2>&1 || { cat "$WORK/cur.log"; echo "HATA: müfredat seed'i" >&2; exit 1; }
  fi
}

TESTURL="$(db_url "$TESTDB")"
echo "== test veritabanı: $TESTDB"
recreate_db "$TESTDB"

# stub süper kullanıcıyla (Supabase'in hazır nesneleri); sonrası süper kullanıcı OLMAYAN migration sahibiyle
PGOPTIONS="" run_file "$TESTURL" "$DIR/tests/00_local_stub.sql" >"$WORK/stub.log" 2>&1 || { cat "$WORK/stub.log"; echo "HATA: 00_local_stub.sql" >&2; exit 1; }
export PGOPTIONS="-c role=$MIGRATION_ROLE"
for f in "$DIR"/migrations/*.sql; do
  if ! run_file "$TESTURL" "$f" --single-transaction >"$WORK/mig.log" 2>&1; then
    cat "$WORK/mig.log"; echo "HATA: migration düştü: $(basename "$f")" >&2; exit 1
  fi
done
echo "  migrations: $(ls "$DIR"/migrations/*.sql | wc -l) dosya uygulandı"

HAVE_CONTENT=0
CDIR="${OGRENMEN_CONTENT_SCRIPTS:-$ROOT/content/tyt-matematik/scripts}"   # yalnız sınama için geçersiz kılınabilir
EXPORT="$CDIR/export-sql.py"
: >"$WORK/seed2.sql"
if [ -f "$EXPORT" ]; then
  "$PY" "$EXPORT" --schema v2 --out "$WORK/curriculum.sql" >"$WORK/export.log" 2>&1 || { cat "$WORK/export.log"; echo "HATA: export-sql.py --schema v2" >&2; exit 1; }
  "$PY" "$EXPORT" --schema v2 --as-version 2027.1 --out "$WORK/curriculum-2027.sql" >>"$WORK/export.log" 2>&1 || { cat "$WORK/export.log"; exit 1; }
  sed -e '/^begin;$/d' -e '/^commit;$/d' "$WORK/curriculum-2027.sql" >"$WORK/seed2.sql"   # test işleminin içinde uygulanır
  HAVE_CONTENT=1
else
  echo "  SKIP: no content (content/tyt-matematik/scripts/export-sql.py yok)"
fi
apply_seeds "$TESTURL"
apply_seeds "$TESTURL"   # ikinci kez: seed'ler ve müfredat seed'i tekrar uygulanabilir
echo "  seed'ler iki kez uygulandı; have_content=$HAVE_CONTENT"
HAVE_KEYS=0
SEED_KEYS="$CDIR/seed-keys.py"
if [ "$HAVE_CONTENT" = 1 ] && [ -f "$SEED_KEYS" ] && [ -f "$CDIR/../diagnostic/answer-keys.json" ]; then
  for pass in 1 2; do   # ikinci kez: anahtar seed'i tekrar uygulanabilir
    "$PY" "$SEED_KEYS" --schema v2 --database-url "$TESTURL" >"$WORK/keys.log" 2>&1 \
      || { cat "$WORK/keys.log"; echo "HATA: seed-keys.py --schema v2 (geçiş $pass)" >&2; exit 1; }
  done
  HAVE_KEYS=1
  echo "  $(tail -1 "$WORK/keys.log")"
else
  echo "  SKIP: no keys (content/tyt-matematik seed-keys.py ya da answer-keys.json yok)"
fi
unset PGOPTIONS

PII_CASES="$("$PY" -c "import json,sys;print(json.dumps(json.load(open(sys.argv[1]))['hash_cases']))" "$ROOT/packages/pii/cases.json" 2>/dev/null || echo '[]')"
# apps/worker SCHEDULES → 'iş|cron' satırları (01_schema.sql pg_cron ↔ worker zamanlama eşliği; yoksa boş → SKIP)
WORKER_SCHEDULES="$(grep -oE "job: '[^']+', cron: '[^']+'" "$ROOT/apps/worker/src/schedules.ts" 2>/dev/null \
  | sed -E "s/job: '([^']+)', cron: '([^']+)'/\1|\2/" | paste -sd ';' - || true)"
BKT_VECTORS="$("$PY" -c "import json,sys;print(json.dumps(json.load(open(sys.argv[1]))))" "$ROOT/packages/mastery-math/fixtures/bkt-vectors.json" 2>/dev/null || echo '{"vectors":[]}')"

for f in "$DIR"/tests/[0-9][0-9]_*.sql; do
  name="$(basename "$f")"
  [ "$name" = "00_local_stub.sql" ] && continue
  echo "== $name"
  if run_file "$TESTURL" "$f" -v have_content="$HAVE_CONTENT" -v have_keys="$HAVE_KEYS" -v seed2="$WORK/seed2.sql" \
       -v pii_hash_cases="$PII_CASES" -v bkt_vectors="$BKT_VECTORS" -v worker_schedules="$WORKER_SCHEDULES" >"$WORK/out.log" 2>&1; then
    :
  else
    FAILED=1
  fi
  sed -e 's/^psql:[^:]*:[0-9]*: //' -e 's/^NOTICE:  //' "$WORK/out.log" | grep -E '^(OK|SKIP|FAIL|ERROR|WARNING)|FAIL' | sed 's/^/  /'
  if grep -q 'FAIL' "$WORK/out.log"; then FAILED=1; fi
  if grep -q '^psql:.*ERROR' "$WORK/out.log"; then FAILED=1; fi
done

# enqueue_job ↔ gerçek pg-boss şeması (apps/worker'ın pg-boss'u; yoksa SKIP). Testler geri alındığından veritabanı temizdir.
echo "== pg-boss (gerçek şema)"
if command -v node >/dev/null 2>&1; then
  if node "$DIR/scripts/pgboss-check.mjs" "$TESTURL" "$MIGRATION_ROLE" >"$WORK/pgboss.log" 2>&1; then :; else FAILED=1; fi
  grep -E '^(OK|SKIP|FAIL)' "$WORK/pgboss.log" | sed 's/^/  /'
  if ! grep -qE '^(OK|SKIP)' "$WORK/pgboss.log"; then cat "$WORK/pgboss.log"; FAILED=1; fi
else
  echo "  SKIP: no node"
fi

if [ "$KEEP" = 0 ]; then
  "${PSQL[@]}" -d "$OGRENMEN_DATABASE_URL" -c "drop database if exists \"$TESTDB\" with (force)" >/dev/null 2>&1 || true
else
  echo "test veritabanı bırakıldı: $TESTDB"
fi

if [ "$FAILED" != 0 ]; then
  echo "db-test: FAIL"
  exit 1
fi
echo "db-test: tüm SQL testleri geçti"
exit 0
