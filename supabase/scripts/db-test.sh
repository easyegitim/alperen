#!/usr/bin/env bash
# supabase/scripts/db-test.sh — canlı Postgres'te migration + seed + SQL testleri (BLUEPRINT §2.4).
#
#   OGRENMEN_DATABASE_URL yoksa "SKIP: no database" yazar ve 0 ile çıkar (statik denetim lint.sh/check_sql.py'dedir).
#   Varsa o sunucuda geçici bir test veritabanı açar (OGRENMEN_TEST_DB, varsayılan ogrenmen_test; bağlanılan
#   veritabanına DOKUNMAZ), sırayla uygular:
#     tests/00_local_stub.sql → migrations/*.sql → seed/*.sql → müfredat seed'i (content/tyt-matematik/scripts/export-sql.py,
#     çalışma anında üretilir; betik yoksa "SKIP: no content") → cevap anahtarları (seed-keys.py --database-url;
#     answer-keys.json yoksa "SKIP: no keys", have_keys=0) → seed/dev/*.sql (fixtures/db/dev-seed.json'ın SQL'i; Worker
#     FakeDb ve panel mock ile aynı dünya, §2.4; satır sayıları dev-seed.json ile karşılaştırılır) → tests/01…11
#     (psql -v ON_ERROR_STOP=1).
#   Ardından ayrı bir veritabanında (…_dev) içerik seed'i OLMADAN migration + seed/*.sql + seed/dev/*.sql yüklenir
#   (--dev dünyası kendi müfredatını, sorularını ve anahtarlarını taşır; tek başına da yüklenebilmeli).
#   Migration, seed, anahtar ve seed/dev adımları süper kullanıcı OLMAYAN migration sahibiyle (ogrenmen_owner,
#   00_local_stub.sql) çalışır; testler bağlanan kullanıcıyla (t.as_admin = Supabase service/postgres yerine).
#   Çıktıda FAIL geçerse ya da bir adım düşerse 1 ile çıkar.
#
# Seçenekler:  --keep  test veritabanlarını bırak (incelemek için)
#              --dev   yalnız geliştirme veritabanını hazırla (migration + seed + seed/dev), testleri koşma, bırak
set -uo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ROOT="$(cd "$DIR/.." && pwd)"
PY="${PYTHON:-python3}"
KEEP=0
DEV_ONLY=0
for arg in "$@"; do
  case "$arg" in
    --keep) KEEP=1 ;;
    --dev) DEV_ONLY=1; KEEP=1 ;;
    -h|--help) sed -n '2,17p' "${BASH_SOURCE[0]}"; exit 0 ;;
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
MIGRATION_ROLE="ogrenmen_owner"   # 00_local_stub.sql yaratır; Supabase'de karşılığı süper kullanıcı olmayan "postgres"
DEVDB="${TESTDB}_dev"
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

prepare_db() {   # prepare_db <url> [content] — stub, migration'lar, seed; "content" ise müfredat seed'i ve anahtarlar
  local url="$1" with_content="${2:-content}"
  # stub süper kullanıcıyla (Supabase'in hazır nesneleri); sonrası Supabase "postgres"inin eşleniği olan süper kullanıcı
  # OLMAYAN migration sahibiyle (00_local_stub.sql başı): PGOPTIONS bu fonksiyonun alt süreçlerine (psql, seed-keys.py) geçer
  PGOPTIONS="" run_file "$url" "$DIR/tests/00_local_stub.sql" >"$WORK/stub.log" 2>&1 || { cat "$WORK/stub.log"; echo "HATA: 00_local_stub.sql" >&2; exit 1; }
  local PGOPTIONS="-c role=$MIGRATION_ROLE"
  export PGOPTIONS
  for f in "$DIR"/migrations/*.sql; do
    if ! run_file "$url" "$f" --single-transaction >"$WORK/mig.log" 2>&1; then
      cat "$WORK/mig.log"; echo "HATA: migration düştü: $(basename "$f")" >&2; exit 1
    fi
  done
  for f in "$DIR"/seed/*.sql; do
    run_file "$url" "$f" --single-transaction >"$WORK/seed.log" 2>&1 || { cat "$WORK/seed.log"; echo "HATA: seed düştü: $(basename "$f")" >&2; exit 1; }
  done
  HAVE_CONTENT=0
  HAVE_KEYS=0
  local cdir="${OGRENMEN_CONTENT_SCRIPTS:-$ROOT/content/tyt-matematik/scripts}"   # yalnız sınama için geçersiz kılınabilir
  local export="$cdir/export-sql.py"
  local keys="$cdir/seed-keys.py"
  if [ "$with_content" != "content" ]; then
    : >"$WORK/seed2.sql"
  elif [ -f "$export" ]; then
    "$PY" "$export" --out "$WORK/curriculum.sql" >"$WORK/export.log" 2>&1 || { cat "$WORK/export.log"; echo "HATA: export-sql.py" >&2; exit 1; }
    "$PY" "$export" --as-version 2027.1 --out "$WORK/curriculum-2027.sql" >>"$WORK/export.log" 2>&1 || { cat "$WORK/export.log"; exit 1; }
    sed -e '/^begin;$/d' -e '/^commit;$/d' "$WORK/curriculum-2027.sql" >"$WORK/seed2.sql"   # test işleminin içinde uygulanır
    run_file "$url" "$WORK/curriculum.sql" -o /dev/null >"$WORK/cur.log" 2>&1 || { cat "$WORK/cur.log"; echo "HATA: müfredat seed'i" >&2; exit 1; }
    HAVE_CONTENT=1
    if [ -f "$keys" ]; then
      local out
      out="$("$PY" "$keys" --database-url "$url" 2>&1)" || { echo "$out"; echo "HATA: seed-keys.py" >&2; exit 1; }
      echo "  $out"
      if ! grep -q "SKIP: no keys" <<<"$out"; then HAVE_KEYS=1; fi
    else
      echo "  SKIP: no keys (seed-keys.py yok)"
    fi
  else
    echo "  SKIP: no content (content/tyt-matematik/scripts/export-sql.py yok)"
    : >"$WORK/seed2.sql"
  fi
}

TESTURL="$(db_url "$TESTDB")"
DEVURL="$(db_url "$DEVDB")"

load_dev_seed() {
  local url="$1"
  local PGOPTIONS="-c role=$MIGRATION_ROLE"   # Supabase'de seed'i de postgres uygular
  export PGOPTIONS
  for f in "$DIR"/seed/dev/*.sql; do
    run_file "$url" "$f" -o /dev/null >"$WORK/dev.log" 2>&1 || { cat "$WORK/dev.log"; echo "FAIL: seed/dev $(basename "$f") yüklenemedi"; return 1; }
  done
  "$PY" - "$ROOT/fixtures/db/dev-seed.json" >"$WORK/devcounts.sql" <<'PYEOF'
import json, sys
data = json.load(open(sys.argv[1], encoding="utf-8"))
checks = []
for table, rows in data.items():
    name = table if "." in table else f"public.{table}"
    if not rows:
        continue
    ids = [r.get("id") for r in rows if isinstance(r.get("id"), str)]
    checks.append(f"select '{name}' as t, {len(rows)} as want, (select count(*) from {name}) as have")
print("select string_agg(t || ' ' || want || '>' || have, ', ') from (" + " union all ".join(checks) + ") x where have < want;")
PYEOF
  local short
  short="$("${PSQL[@]}" -d "$url" -At -f "$WORK/devcounts.sql")" || return 1
  if [ -n "$short" ]; then
    echo "FAIL: seed/dev satır sayıları eksik: $short"; return 1
  fi
  echo "OK: seed/dev yüklendi; her tabloda dev-seed.json satırları mevcut"
}

echo "== test veritabanı: $TESTDB"
if [ "$DEV_ONLY" = 1 ]; then
  recreate_db "$DEVDB"
  prepare_db "$DEVURL" no-content
  load_dev_seed "$DEVURL" || exit 1
  echo "geliştirme veritabanı hazır: $DEVDB (bırakıldı)"
  exit 0
fi

recreate_db "$TESTDB"
prepare_db "$TESTURL"
echo "  have_content=$HAVE_CONTENT have_keys=$HAVE_KEYS"
echo "== seed/dev (test veritabanı; içerik seed'inin üstüne, testlerden önce — §2.4)"
if ! load_dev_seed "$TESTURL" | sed 's/^/  /'; then echo "db-test: FAIL"; exit 1; fi

PII_CASES="$("$PY" -c "import json,sys;print(json.dumps(json.load(open(sys.argv[1]))['hash_cases']))" "$ROOT/packages/pii/cases.json" 2>/dev/null || echo '[]')"
BKT_VECTORS="$("$PY" -c "import json,sys;print(json.dumps(json.load(open(sys.argv[1]))))" "$ROOT/packages/mastery-math/fixtures/bkt-vectors.json" 2>/dev/null || echo '{"vectors":[]}')"
MATRIX="$(cat "$DIR/tests/grants_matrix.json")"

for f in "$DIR"/tests/[0-9][0-9]_*.sql; do
  name="$(basename "$f")"
  [ "$name" = "00_local_stub.sql" ] && continue
  echo "== $name"
  if run_file "$TESTURL" "$f" -v have_content="$HAVE_CONTENT" -v have_keys="$HAVE_KEYS" -v seed2="$WORK/seed2.sql" \
       -v pii_hash_cases="$PII_CASES" -v bkt_vectors="$BKT_VECTORS" -v matrix="$MATRIX" >"$WORK/out.log" 2>&1; then
    :
  else
    FAILED=1
  fi
  sed -e 's/^psql:[^:]*:[0-9]*: //' -e 's/^NOTICE:  //' "$WORK/out.log" | grep -E '^(OK|SKIP|FAIL|ERROR|WARNING)|FAIL' | sed 's/^/  /'
  if grep -q 'FAIL' "$WORK/out.log"; then FAILED=1; fi
  if grep -q '^psql:.*ERROR' "$WORK/out.log"; then FAILED=1; fi
done

echo "== seed/dev tek başına (ayrı veritabanı: $DEVDB, içerik seed'i yok)"
recreate_db "$DEVDB"
prepare_db "$DEVURL" no-content >/dev/null
if ! load_dev_seed "$DEVURL"; then FAILED=1; fi

if [ "$KEEP" = 0 ]; then
  "${PSQL[@]}" -d "$OGRENMEN_DATABASE_URL" -c "drop database if exists \"$TESTDB\" with (force)" -c "drop database if exists \"$DEVDB\" with (force)" >/dev/null 2>&1 || true
fi

if [ "$FAILED" != 0 ]; then
  echo "db-test: FAIL"
  exit 1
fi
echo "db-test: tüm SQL testleri geçti"
exit 0
