#!/usr/bin/env bash
# supabase/scripts/lint.sh — statik SQL denetimi (canlı DB gerekmez; v2).
#   1. sqlfluff (postgres lehçesi, supabase/.sqlfluff) — migrations/ + seed/
#   2. sync_comments.py --check — her tablo ve sütunun "comment on" bloğu güncel
#   3. BKT ve PII kopyaları — packages/mastery-math/sql/bkt.sql (0011_mastery.sql) ve
#      packages/pii/sql/name_token_hashes.sql (0003_identity.sql) ile birebir
#   4. check_sql.py denetleyicisinin kendi testleri (pytest)
# Herhangi biri başarısızsa 1 ile çıkar. Her cwd'den çalışır.
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ROOT="$(cd "$DIR/.." && pwd)"
PY="${PYTHON:-python3}"

if ! command -v sqlfluff >/dev/null 2>&1; then
  echo "HATA: sqlfluff yok (python -m pip install sqlfluff pglast)" >&2
  exit 1
fi

echo "== sqlfluff (migrations, seed)"
sqlfluff lint --config "$DIR/.sqlfluff" --processes "$(nproc 2>/dev/null || echo 2)" "$DIR/migrations" "$DIR/seed"

echo "== comment on blokları"
"$PY" "$DIR/scripts/sync_comments.py" --check "$DIR/migrations"

echo "== BKT kopyası (0011_mastery.sql ↔ packages/mastery-math/sql/bkt.sql)"
diff "$ROOT/packages/mastery-math/sql/bkt.sql" \
  <(sed -n '/^-- begin bkt$/,/^-- end bkt$/p' "$DIR/migrations/0011_mastery.sql" | sed '1d;$d')

echo "== PII kopyası (0003_identity.sql ↔ packages/pii/sql/name_token_hashes.sql)"
diff <(sed -n '/^-- begin pii$/,/^-- end pii$/p' "$ROOT/packages/pii/sql/name_token_hashes.sql") \
  <(sed -n '/^-- begin pii$/,/^-- end pii$/p' "$DIR/migrations/0003_identity.sql")

echo "== check_sql.py testleri"
"$PY" -m pytest -q -p no:cacheprovider "$DIR/scripts/tests"

echo "lint: tamam"
