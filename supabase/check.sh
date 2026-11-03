#!/usr/bin/env bash
# supabase/check.sh — veritabanı v2: statik SQL denetimi (lint.sh + check_sql.py) ve OGRENMEN_LIVE=1 ile canlı Postgres
# testleri (db-test.sh). Canlı kip OGRENMEN_DATABASE_URL (yoksa yerel varsayılan) sunucusunda geçici bir test
# veritabanı açar ve siler; bağlanılan veritabanına dokunulmaz.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
# shellcheck source=../scripts/lib.sh
source "$ROOT/scripts/lib.sh"

ogr_step "supabase: lint.sh (sqlfluff, comment on, BKT/PII kopyaları, denetleyici testleri)"
ogr_pip sqlfluff pglast pytest
bash "$HERE/scripts/lint.sh"

ogr_step "supabase: check_sql.py --require-policies (RLS + politikalar, secure/audit, search_path, created_at, uuid pk, halfvec(1024))"
python "$HERE/scripts/check_sql.py" "$HERE/migrations" --require-policies

if ogr_is_live; then
  ogr_step "supabase: db-test.sh (canlı Postgres)"
  ogr_live_env
  export OGRENMEN_TEST_DB="${OGRENMEN_TEST_DB:-ogrenmen_check_$$}"
  out="$(bash "$HERE/scripts/db-test.sh" 2>&1)" || { printf '%s\n' "$out" | grep -v NOTICE | tail -60; exit 1; }
  printf '%s\n' "$out" | grep -v NOTICE | tail -25
  if grep -q '^SKIP: no database' <<<"$out"; then echo "HATA: canlı kipte db-test.sh veritabanı bulamadı" >&2; exit 1; fi
else
  ogr_skip "supabase canlı Postgres testleri (OGRENMEN_LIVE=1 değil)"
fi
