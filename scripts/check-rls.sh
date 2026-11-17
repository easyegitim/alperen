#!/usr/bin/env bash
# Kullanım: DATABASE_URL=postgres://... pnpm db:check-rls
set -euo pipefail
: "${DATABASE_URL:?DATABASE_URL gerekli}"
out=$(psql "$DATABASE_URL" -At -v ON_ERROR_STOP=1 -f "$(dirname "$0")/check-rls.sql")
if [ -n "$out" ]; then
  echo "RLS kapalı tablolar:"; echo "$out"; exit 1
fi
echo "RLS: public şemasındaki tüm tablolarda açık."
