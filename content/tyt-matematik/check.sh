#!/usr/bin/env bash
# content/tyt-matematik/check.sh — TYT Matematik içeriği: doğrulama, SQL dışa aktarımı (anahtarsız) ve şablon testleri.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
# shellcheck source=../../scripts/lib.sh
source "$ROOT/scripts/lib.sh"
ogr_tmpdir

ogr_step "içerik: ruff"
ruff check "$HERE"

ogr_step "içerik: validate.py"
ogr_pip -e "$ROOT/packages/contracts/python" sympy matplotlib numpy pglast
python "$HERE/scripts/validate.py"

ogr_step "içerik: export-sql.py (anahtarsız, yer tutucusuz, SQL ayrıştırılabilir)"
python "$HERE/scripts/export-sql.py" --out "$WORK/seed.sql"
python -c "import pglast,sys;pglast.parse_sql(open(sys.argv[1]).read())" "$WORK/seed.sql"
if grep -qi "answer_keys\|correct_option" "$WORK/seed.sql"; then echo "HATA: seed.sql cevap anahtarı içeriyor" >&2; exit 1; fi
ogr_absent '{{' "$WORK/seed.sql"
grep -q 'ogrenmen:cocuk-dili:start' "$WORK/seed.sql"

ogr_step "içerik: export-sql.py --as-version 2027.1"
python "$HERE/scripts/export-sql.py" --as-version 2027.1 --out "$WORK/seed2.sql"
python -c "import pglast,sys;pglast.parse_sql(open(sys.argv[1]).read())" "$WORK/seed2.sql"
grep -c "insert into public.skills" "$WORK/seed2.sql" | grep -qv '^0$'

ogr_step "içerik: pytest (şablonlar × varyantlar)"
if ogr_is_live; then
  ogr_live_env   # canlı Postgres vakaları da koşar (geçici veritabanı açıp siler)
  python -m pytest "$HERE" -q
else
  env -u OGRENMEN_DATABASE_URL python -m pytest "$HERE" -q
fi
