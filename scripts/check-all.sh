#!/usr/bin/env bash
# scripts/check-all.sh — tamamlanmış her modülün kabul komutları sırayla (BLUEPRINT §11; M13L).
#
# Modüller: M00 M01 M02 M03 M04 M05 M06 M07 M08 M09 M10 M11 M12 + M13 (kopya sapması, fixtures-valid, RPC paritesi,
# betik testleri, workflow lint'i). Her adım için bir satır: PASS/FAIL/SKIP + süre; sonunda özet. Herhangi bir FAIL → çıkış 1.
#
#   --quick       ağır build adımlarını atlar (wrangler build, panel üretim derlemesi); SKIP olarak yazılır
#   --live-only   yalnız canlı veritabanı adımları (db-test.sh + tablet ve ders live); OGRENMEN_DATABASE_URL yoksa SKIP
#   --only LISTE  yalnız bu modüller, virgülle (ör. --only M02,M13; M13L = M13, M06T/M06R = M06); bilinmeyen ad → çıkış 2
#   --list        adımları listele, çalıştırma (--only ile yalnız seçilenler)
#   -h, --help    bu metin
#
# OGRENMEN_DATABASE_URL tanımlıysa supabase/scripts/db-test.sh canlı koşar (geçici OGRENMEN_TEST_DB veritabanı;
# bağlanılan veritabanına dokunulmaz), tablet ve ders live testleri ayrı adımda koşar (kalem ve kitap live testleri
# kendi pytest adımlarında); yoksa db-test "SKIP: no database" ile geçer.
# Komutlar §11'deki biçimleriyle, depo kökü mutlak yoluyla ve nötr bir çalışma dizininden koşar ("her cwd'den").
# /tmp altındaki sabit çıktı yolları (/tmp/seed.sql, /tmp/tablet-out …) bu çalışmaya özel geçici dizine taşınır.
# Depo içi derleme çıktıları (apps/panel/.next ve out/, apps/worker/dist, packages/contracts/src/generated,
# node_modules) paylaşıldığı için aynı depoda koşular bir kilitle (flock) sıraya girer (README "Kabul komutu notu").
# Günlükler: her adımın tam çıktısı geçici dizindeki logs/ altında; FAIL olan adımın son 40 satırı ekrana yazılır.
# Seçimle eşleşen hiç adım yoksa (ör. --live-only --only M00) çıkış 1: boş koşu yeşil sayılmaz.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
QUICK=0
LIVE_ONLY=0
ONLY=""
LIST=0
while [ $# -gt 0 ]; do
  case "$1" in
    --quick) QUICK=1; shift ;;
    --live-only) LIVE_ONLY=1; shift ;;
    --only) ONLY="${2:?--only modül listesi ister (ör. M02,M13)}"; shift 2 ;;
    --only=*) ONLY="${1#--only=}"; shift ;;
    --list) LIST=1; shift ;;
    -h|--help) sed -n '2,21p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "HATA: bilinmeyen seçenek $1 (bkz. --help)" >&2; exit 2 ;;
  esac
done

WORK="$(mktemp -d "${TMPDIR:-/tmp}/ogrenmen-check-all.XXXXXX")"
W="$WORK/out"          # komutların /tmp çıktıları
LOGS="$WORK/logs"
NEUTRAL="$WORK/cwd"    # komutlar bu boş dizinden çalışır
mkdir -p "$W" "$LOGS" "$NEUTRAL"
export ROOT W
# Canlı db-test kendi geçici veritabanını açar; eş zamanlı koşular çakışmasın diye ada süreç kimliği eklenir.
export OGRENMEN_TEST_DB="${OGRENMEN_TEST_DB:-ogrenmen_checkall_$$}"
HAS_DB=0
[ -n "${OGRENMEN_DATABASE_URL:-}" ] && HAS_DB=1

# ------------------------------------------------------------------------------------------- adımlar
# Her adım bir fonksiyondur; gövdesi modülün §11 kabul komutudur (kök yolu $ROOT, /tmp çıktıları $W).

m00_contracts_ts() {
  bun install --cwd "$ROOT/packages/contracts" && bun run --cwd "$ROOT/packages/contracts" gen \
    && bun run --cwd "$ROOT/packages/contracts" typecheck && bun run --cwd "$ROOT/packages/contracts" test \
    && git -C "$ROOT" diff --exit-code packages/contracts/src/generated packages/contracts/schemas/gemini
}
m00_contracts_py() {
  python -m pip install -e "$ROOT/packages/contracts/python[dev]" && python -m pytest "$ROOT/packages/contracts/python" -q
}
m00_mastery_ts() {
  bun install --cwd "$ROOT/packages/mastery-math" && bun test --cwd "$ROOT/packages/mastery-math"
}
m00_mastery_py() {
  python -m pip install -e "$ROOT/packages/mastery-math/python[dev]" && python -m pytest "$ROOT/packages/mastery-math/python" -q
}

m01_pii_ts() {
  bun install --cwd "$ROOT/packages/pii/ts" && bun run --cwd "$ROOT/packages/pii/ts" typecheck \
    && bun run --cwd "$ROOT/packages/pii/ts" test
}
m01_pii_py() {
  python -m pip install -e "$ROOT/packages/pii/py[dev]" && python -m pytest "$ROOT/packages/pii/py" -q
}
m01_pii_parity() {
  bun run --cwd "$ROOT/packages/pii/ts" dump > "$W/pii-ts.json" && python -m ogrenmen_pii.dump > "$W/pii-py.json" \
    && diff "$W/pii-ts.json" "$W/pii-py.json"
}
m01_fixtures_json() {
  python -c "import json,glob;[json.load(open(f)) for f in glob.glob('$ROOT/fixtures/**/*.json',recursive=True)]"
}
m01_ffmpeg() {
  ffmpeg -v error -i "$ROOT/fixtures/ders/lesson-01.wav" -f null -
}

m02_lint() {
  python -m pip install sqlfluff pglast && bash "$ROOT/supabase/scripts/lint.sh"
}
m02_check_sql() {
  python "$ROOT/supabase/scripts/check_sql.py" "$ROOT/supabase/migrations" --grants-matrix "$ROOT/supabase/tests/grants_matrix.json"
}
m02_db_test() {
  bash "$ROOT/supabase/scripts/db-test.sh"
}
m02_mint_jwt() {
  bun install --cwd "$ROOT/supabase" \
    && bun run --cwd "$ROOT/supabase" scripts/mint-jwt.ts --role bot_runtime --secret test-secret --exp 1h \
    | python3 -c "import sys,base64,json;t=sys.stdin.read().strip().split('.');print(json.loads(base64.urlsafe_b64decode(t[1]+'=='))['role'])" \
    | grep -qx bot_runtime
}

m03_validate() {
  python -m pip install -e "$ROOT/packages/contracts/python" sympy matplotlib numpy pglast \
    && python "$ROOT/content/tyt-matematik/scripts/validate.py"
}
m03_export() {
  python "$ROOT/content/tyt-matematik/scripts/export-sql.py" --out "$W/seed.sql" \
    && python -c "import pglast;pglast.parse_sql(open('$W/seed.sql').read())" \
    && ! grep -qi "answer_keys\|correct_option" "$W/seed.sql" && ! grep -q '{{' "$W/seed.sql" \
    && grep -q 'ogrenmen:cocuk-dili:start' "$W/seed.sql"
}
m03_export_version() {
  python "$ROOT/content/tyt-matematik/scripts/export-sql.py" --as-version 2027.1 --out "$W/seed2.sql" \
    && python -c "import pglast;pglast.parse_sql(open('$W/seed2.sql').read())" \
    && grep -c "insert into public.skills" "$W/seed2.sql" | grep -qv '^0$'
}
m03_pytest() {
  python -m pytest "$ROOT/content/tyt-matematik" -q
}

m04_worker() {
  bun install --cwd "$ROOT/apps/worker" && bun run --cwd "$ROOT/apps/worker" typecheck \
    && bun run --cwd "$ROOT/apps/worker" lint && bun run --cwd "$ROOT/apps/worker" test
}
m04_build() {
  bun run --cwd "$ROOT/apps/worker" build
}
m04_no_keys() {
  # §11: ! grep -rn … apps/worker/src --include=*.ts | grep -v "// anahtar yok". pipefail altında ilk grep'in
  # hatası (çıkış 2, ör. dizin yok) "bulgu yok" sayılmasın diye çıkış kodu ayrıca denetlenir (m04_texts gibi).
  test -d "$ROOT/apps/worker/src" || { echo "apps/worker/src yok"; return 1; }
  local hits rc
  hits="$(grep -rn "answer-key\|correct_option\|service_role\|SUPABASE_JWT_SECRET" "$ROOT/apps/worker/src" --include=*.ts)"
  rc=$?
  [ "$rc" -le 1 ] || { echo "grep hatası (çıkış $rc)"; return 1; }
  hits="$(grep -v "// anahtar yok" <<<"$hits")"
  [ -z "$hits" ] || { echo "Worker kaynağında yasak dize:"; echo "$hits"; return 1; }
}
m04_texts() {
  # apps/worker/README.md "Kabul komutu notu" 8: açık UTF-8 yerel ayarı; grep 1 = temiz, 0 = bulgu, 2 = hata.
  LC_ALL=C.UTF-8 grep -rnP '[!\x{1F300}-\x{1FAFF}]' "$ROOT/apps/worker/src/texts.ts"
  local rc=$?
  [ "$rc" -eq 1 ] || { echo "texts.ts: ünlem/emoji bulundu ya da grep hatası (çıkış $rc)"; return 1; }
}

m05_common() {
  python -m pip install -e "$ROOT/packages/contracts/python" -e "$ROOT/packages/mastery-math/python" \
    -e "$ROOT/packages/pii/py" -e "$ROOT/pipelines/common[dev]" \
    && ruff check "$ROOT/pipelines/common" && python -m pytest "$ROOT/pipelines/common" -q
}
m05_selftest() {
  OGRENMEN_FAKES=1 python -m ogrenmen_common.selftest
}
m05_runtime() {
  python -c "from ogrenmen_common.runtime import Runtime;r=Runtime.from_env(dry_run=True);assert r.llm.__class__.__name__=='FakeLLM'"
}

# Ortak taban (pipelines/common README'si): M06/M08/M09/M10 kurulum adımları bunu da kurar ki --only ile tek başına
# koşabilsinler (m05_common, m07_kulaklik ile aynı).
pip_base() {
  python -m pip install -e "$ROOT/packages/contracts/python" -e "$ROOT/packages/mastery-math/python" \
    -e "$ROOT/packages/pii/py" -e "$ROOT/pipelines/common" "$@"
}
# Live testleri ayrı adımda bir kez koşar: atlanan test PASS sayılmaz (live fikstürleri psql/ffmpeg yoksa pytest.skip
# çağırır); en az bir test geçmeli, hiçbiri atlanmamalı.
live_only_passes() {   # live_only_passes <pytest komutu…>
  command -v psql >/dev/null || { echo "psql yok: live testleri koşamaz (postgresql-client kur)"; return 1; }
  local out rc
  out="$("$@" 2>&1)"
  rc=$?
  echo "$out"
  [ "$rc" -eq 0 ] || return "$rc"
  if grep -qE '[0-9]+ skipped|^SKIPPED' <<<"$out"; then echo "HATA: live testleri atlandı (yukarıdaki SKIPPED satırları)"; return 1; fi
  grep -qE '[0-9]+ passed' <<<"$out" || { echo "HATA: hiç live testi geçmedi"; return 1; }
}

m06_tablet() {
  # Veritabanı varken live testleri ayrı adımda (m06_live) bir kez koşar; burada seçilmez.
  local deselect=()
  [ "$HAS_DB" -eq 1 ] && deselect=(-m "not live")
  pip_base -e "$ROOT/pipelines/tablet[dev]" && ruff check "$ROOT/pipelines/tablet" \
    && python -m pytest "$ROOT/pipelines/tablet" -q "${deselect[@]}"
}
m06_live() {
  # README: OGRENMEN_DATABASE_URL=… python -m pytest …/pipelines/tablet -q -k live (URL kabuktan gelir).
  live_only_passes python -m pytest "$ROOT/pipelines/tablet" -q -k live -rs
}
m06_generate() {
  # ! grep dosya yoksa da (çıkış 2) başarı sayardı; questions.jsonl'in varlığı ayrıca denetlenir.
  python -m ogrenmen_tablet generate --skill tyt.mat.temel.rasyonel-sayilar --count 2 --dry-run --fixtures "$ROOT/fixtures/tablet" --out "$W/tablet-out" \
    && test -f "$W/tablet-out/cost_estimate.json" && test -f "$W/tablet-out/questions.jsonl" \
    && ! grep -q correct_option "$W/tablet-out/questions.jsonl"
}
m06_template() {
  python -m ogrenmen_tablet template --id kesir-modeli-toplama --count 5 --seed 7 --out "$W/tablet-out2" \
    && ls "$W"/tablet-out2/figures/*.png && test -f "$W/tablet-out2/questions.jsonl" \
    && ! grep -q correct_option "$W/tablet-out2/questions.jsonl"
}
m06_fill() {
  python -m ogrenmen_tablet template --fill --min-stock 30 --dry-run --fixtures "$ROOT/fixtures/tablet" --out "$W/tablet-fill" \
    && grep -q register_template_question "$W/tablet-fill/rpc_calls.jsonl" && test -f "$W/tablet-fill/questions.jsonl" \
    && ! grep -q '"source": "llm"' "$W/tablet-fill/questions.jsonl" && test -f "$W/tablet-fill/template_fill.json"
}

m07_kulaklik() {
  # Ortak taban (pipelines/common README'si) da kurulur: --only M07 tek başına koşabilsin (m05_common ile aynı).
  python -m pip install -e "$ROOT/packages/contracts/python" -e "$ROOT/packages/mastery-math/python" \
    -e "$ROOT/packages/pii/py" -e "$ROOT/pipelines/common" -e "$ROOT/pipelines/kulaklik_batch[dev]" \
    && ruff check "$ROOT/pipelines/kulaklik_batch" && python -m pytest "$ROOT/pipelines/kulaklik_batch" -q
}
m07_facts() {
  python -m ogrenmen_kulaklik facts --day 2026-10-18 --dry-run --fixtures "$ROOT/fixtures/kulaklik" --out "$W/kk-out" \
    && python3 -c "import json,sys;rows=[json.loads(l) for l in open(sys.argv[1])];assert rows and all(len(r['source_message_ids'])>=1 for r in rows)" \
      "$W/kk-out/memory_facts.jsonl"
}
m07_metrics() {
  # §11: ! grep -qiE "depresif|tembel". Dosya yoksa grep 2 döner ve ! onu PASS'e çevirirdi; varlığı ayrıca denetlenir.
  python -m ogrenmen_kulaklik metrics --dry-run --fixtures "$ROOT/fixtures/kulaklik" --out "$W/kk-out" || return 1
  test -f "$W/kk-out/instructor_alerts.jsonl" || { echo "instructor_alerts.jsonl yazılmadı"; return 1; }
  LC_ALL=C.UTF-8 grep -niE "depresif|tembel" "$W/kk-out/instructor_alerts.jsonl"
  local rc=$?
  [ "$rc" -eq 1 ] || { echo "instructor_alerts.jsonl: yargı kelimesi bulundu ya da grep hatası (çıkış $rc)"; return 1; }
}
m07_gate() {
  python -m ogrenmen_kulaklik metrics --gate --dry-run --fixtures "$ROOT/fixtures/kulaklik" --out "$W/kk-gate" \
    && test -f "$W/kk-gate/pilot_gate.md" && LC_ALL=C.UTF-8 grep -E "Kapı: (AÇIK|KAPALI)" "$W/kk-gate/pilot_gate.md"
}
m07_cost() {
  python -m ogrenmen_kulaklik cost-report --month 2026-10 --dry-run --fixtures "$ROOT/fixtures/kulaklik" --out "$W/kk-out" \
    && test -f "$W/kk-out/cost-report.md"
}

m08_ders() {
  # Veritabanı varken live testi (tests/test_live_db.py) ayrı adımda (m08_live) bir kez koşar; burada seçilmez.
  local deselect=()
  [ "$HAS_DB" -eq 1 ] && deselect=(-k "not live")
  pip_base -e "$ROOT/pipelines/ders[dev]" && ruff check "$ROOT/pipelines/ders" \
    && python -m pytest "$ROOT/pipelines/ders" -q "${deselect[@]}"
}
m08_analyze() {
  # ! grep -q Elif api_payload.json dosya yoksa da geçerdi; varlığı ayrıca denetlenir.
  python -m ogrenmen_ders analyze --lesson 00000000-0000-0000-0000-000000000001 --video "$ROOT/fixtures/ders/lesson-01.wav" --dry-run --fixtures "$ROOT/fixtures/ders" --out "$W/ders-out" \
    && test -f "$W/ders-out/lesson_analyses.jsonl" && test -f "$W/ders-out/lesson_claims.jsonl" \
    && ! test -f "$W/ders-out/observations.jsonl" && test -f "$W/ders-out/api_payload.json" \
    && ! grep -q Elif "$W/ders-out/api_payload.json"
}
m08_live() {
  # tests/test_live_db.py (ffmpeg de ister); -k live dosya adıyla seçer.
  live_only_passes python -m pytest "$ROOT/pipelines/ders" -q -k live -rs
}

m09_kalem() {
  pip_base -e "$ROOT/pipelines/kalem[dev]" && ruff check "$ROOT/pipelines/kalem" && python -m pytest "$ROOT/pipelines/kalem" -q
}
m09_plan() {
  python -m ogrenmen_kalem plan --course DEMO --period 2026 --dry-run --fixtures "$ROOT/fixtures/kalem" --out "$W/kalem-out" \
    && python3 -c "import json;p=json.loads(open('$W/kalem-out/exam_priority_plans.jsonl').readline())['plan'];assert p['title']=='Sıklık analizine göre öncelikler' and p['rows'];s=json.dumps(p,ensure_ascii=False).lower();assert 'ocr_text' not in s and 'tahmin' not in s and 'çıkacak' not in s"
}

m10_kitap() {
  pip_base -e "$ROOT/pipelines/kitap[dev]" && ruff check "$ROOT/pipelines/kitap" && python -m pytest "$ROOT/pipelines/kitap" -q
}
m10_run() {
  python -m ogrenmen_kitap run --query "spaced repetition matematik" --dry-run --fixtures "$ROOT/fixtures/kitap" --out "$W/kitap-out" \
    && python3 -c "import json;o=json.load(open('$W/kitap-out/output.json'));assert all(c['crossref_status'] in ('verified','no_doi') for c in o['citations']);assert o['removed'];ords={c['ordinal'] for c in o['citations']};assert all(set(p['cites'])<=ords for p in o['synthesis'])" \
    && ! grep -q "10.9999/fake" "$W/kitap-out/output.json"
}

m11_panel() {
  bun install --cwd "$ROOT/apps/panel" && bun run --cwd "$ROOT/apps/panel" sync:ds \
    && bun run --cwd "$ROOT/apps/panel" typecheck && bun run --cwd "$ROOT/apps/panel" lint \
    && bun run --cwd "$ROOT/apps/panel" test
}
m11_build() {
  NEXT_PUBLIC_DATA_SOURCE=mock bun run --cwd "$ROOT/apps/panel" build && test -f "$ROOT/apps/panel/out/index.html" \
    && ! grep -rlE "AIza|gsk_|sk-or-|service_role|cdn.jsdelivr|unpkg.com" "$ROOT/apps/panel/out/"
}
m11_lang() {
  grep -q 'lang="tr"' "$ROOT/apps/panel/app/layout.tsx"
}

m12_docs() {
  for f in aydinlatma-metni veli-onay-formu grup-kayit-bildirimi ders-kaydi-bildirimi saklama-politikasi \
    yurt-disi-aktarim veri-isleme-envanteri telif-notu; do
    test -s "$ROOT/docs/hukuk/$f.md" && head -1 "$ROOT/docs/hukuk/$f.md" | grep -q 'HUKUKİ İNCELEME GEREKLİ' || exit 1
  done
}
m12_placeholders() {
  python3 -c "import json,re,glob;ph=set(json.load(open('$ROOT/docs/hukuk/placeholders.json')));used={m for f in glob.glob('$ROOT/docs/hukuk/*.md') for m in re.findall(r'{{(\w+)}}',open(f).read())};assert used<=ph,used-ph"
}
m12_retention_placeholder() {
  grep -q "{{RETENTION_MESSAGES_DAYS}}" "$ROOT/docs/hukuk/grup-kayit-bildirimi.md"
}
m12_child_language() {
  grep -q 'ogrenmen:cocuk-dili:start' "$ROOT/docs/hukuk/aydinlatma-metni.md" \
    && grep -q 'ogrenmen:cocuk-dili:end' "$ROOT/docs/hukuk/aydinlatma-metni.md"
}

m13_drift() {
  python "$ROOT/scripts/check-drift.py" \
    && diff "$ROOT/packages/mastery-math/sql/bkt.sql" \
      <(sed -n '/-- begin bkt/,/-- end bkt/p' "$ROOT/supabase/migrations/0011_mastery.sql" | sed '1d;$d')
}
m13_fixtures() {
  python "$ROOT/scripts/check-fixtures.py"
}
m13_rpc_parity() {
  python "$ROOT/scripts/check-rpc-parity.py" --only-problems
}
m13_scripts_tests() {
  ruff check "$ROOT/scripts" && python -m pytest "$ROOT/scripts/tests" -q
}
m13_workflows() {
  yamllint -d relaxed "$ROOT/.github/workflows" \
    && python3 -c "import yaml,glob;[yaml.safe_load(open(f)) for f in glob.glob('$ROOT/.github/workflows/*.yml')]" \
    && make -C "$ROOT" -n check >/dev/null || return 1
  # actionlint CI'da sabit sürümle kurulur (ci.yml); yerelde kuruluysa burada da koşar.
  if command -v actionlint >/dev/null; then
    actionlint "$ROOT"/.github/workflows/*.yml
  else
    echo "not: actionlint kurulu değil; CI'da koşar (python -m pip install actionlint-py==1.7.12.25)"
  fi
}
m13_secret_scan() {
  bash "$ROOT/scripts/secret-scan.sh"
}

# id | modül | tür (normal | heavy | live | livealways) | açıklama | fonksiyon
#   heavy: --quick ile atlanır;  live: yalnız OGRENMEN_DATABASE_URL varsa;  livealways: her koşuda (DB yoksa SKIP yazar)
STEPS=(
  "M00|normal|contracts: gen + typecheck + test + üretilen dosyalar commit'liyle aynı|m00_contracts_ts"
  "M00|normal|contracts (Python): pip -e + pytest|m00_contracts_py"
  "M00|normal|mastery-math (TS): bun test|m00_mastery_ts"
  "M00|normal|mastery-math (Python): pip -e + pytest|m00_mastery_py"
  "M01|normal|pii (TS): typecheck + test|m01_pii_ts"
  "M01|normal|pii (Python): pip -e + pytest|m01_pii_py"
  "M01|normal|pii TS ↔ Python dump diff|m01_pii_parity"
  "M01|normal|fixtures/**/*.json okunuyor|m01_fixtures_json"
  "M01|normal|fixtures/ders/lesson-01.wav ffmpeg ile çözülüyor|m01_ffmpeg"
  "M02|normal|supabase lint.sh (sqlfluff, yorumlar, dev seed, kopyalar)|m02_lint"
  "M02|normal|check_sql.py --grants-matrix|m02_check_sql"
  "M02|livealways|db-test.sh (DB yoksa SKIP: no database)|m02_db_test"
  "M02|normal|mint-jwt.ts bot_runtime jetonu|m02_mint_jwt"
  "M03|normal|içerik validate.py|m03_validate"
  "M03|normal|export-sql.py (anahtarsız, yer tutucusuz)|m03_export"
  "M03|normal|export-sql.py --as-version 2027.1|m03_export_version"
  "M03|normal|içerik pytest (6 şablon × 50 varyant)|m03_pytest"
  "M04|normal|worker: typecheck + lint + test|m04_worker"
  "M04|heavy|worker build (wrangler deploy --dry-run)|m04_build"
  "M04|normal|worker kaynağında anahtar/service_role yok|m04_no_keys"
  "M04|normal|worker texts.ts ünlem/emoji yok|m04_texts"
  "M05|normal|ogrenmen_common: pip -e + ruff + pytest|m05_common"
  "M05|normal|ogrenmen_common selftest (OGRENMEN_FAKES=1)|m05_selftest"
  "M05|normal|Runtime.from_env(dry_run) → FakeLLM|m05_runtime"
  "M06|normal|tablet: pip -e + ruff + pytest|m06_tablet"
  "M06|live|tablet live (gerçek register_template_question, generate yazımları)|m06_live"
  "M06|normal|tablet generate --skill tyt.mat.temel.rasyonel-sayilar --count 2 --dry-run (correct_option yok)|m06_generate"
  "M06|normal|tablet template --id kesir-modeli-toplama (PNG şekiller)|m06_template"
  "M06|normal|tablet template --fill --min-stock 30 --dry-run (LLM kaynağı yok)|m06_fill"
  "M07|normal|kulaklik_batch: pip -e + ruff + pytest|m07_kulaklik"
  "M07|normal|kulaklik facts --day 2026-10-18 --dry-run (source_message_ids dolu)|m07_facts"
  "M07|normal|kulaklik metrics --dry-run (alarmlarda yargı kelimesi yok)|m07_metrics"
  "M07|normal|kulaklik metrics --gate --dry-run (pilot_gate.md \"Kapı: AÇIK/KAPALI\")|m07_gate"
  "M07|normal|kulaklik cost-report --month 2026-10 --dry-run|m07_cost"
  "M08|normal|ders: pip -e + ruff + pytest|m08_ders"
  "M08|live|ders live (boru hattı çağrıları gerçek SQL'e karşı)|m08_live"
  "M08|normal|ders analyze --dry-run (taslak rapor + iddialar; observations yok, api_payload'da ad yok)|m08_analyze"
  "M09|normal|kalem: pip -e + ruff + pytest|m09_kalem"
  "M09|normal|kalem plan --dry-run (\"Sıklık analizine göre öncelikler\", OCR metni ve tahmin dili yok)|m09_plan"
  "M10|normal|kitap: pip -e + ruff + pytest|m10_kitap"
  "M10|normal|kitap run --query --dry-run (atıflar Crossref'te doğrulanmış, uydurma DOI silinmiş)|m10_run"
  "M11|normal|panel: sync:ds + typecheck + lint + test|m11_panel"
  "M11|heavy|panel mock build + anahtar/CDN taraması|m11_build"
  "M11|normal|panel layout lang=\"tr\"|m11_lang"
  "M12|normal|hukuk: 8 belge, ilk satır uyarısı|m12_docs"
  "M12|normal|hukuk: yer tutucular placeholders.json'da|m12_placeholders"
  "M12|normal|hukuk: grup bildiriminde RETENTION_MESSAGES_DAYS|m12_retention_placeholder"
  "M12|normal|hukuk: aydınlatma metninde çocuk dili işaretleri|m12_child_language"
  "M13|normal|BKT/PII kopya sapması (check-drift.py + §11 diff)|m13_drift"
  "M13|normal|fixtures-valid (fixtures/llm sözleşmeleri, dev-seed)|m13_fixtures"
  "M13|normal|RPC adı + parametre paritesi|m13_rpc_parity"
  "M13|normal|scripts/ ruff + pytest|m13_scripts_tests"
  "M13|normal|workflow yamllint + YAML + make -n check (+ actionlint)|m13_workflows"
  "M13|normal|sır taraması (gerçek görünümlü anahtar yok)|m13_secret_scan"
)

# --only doğrulaması: her ad STEPS'teki bir modül olmalı (M13L, modülün kendi adı, M13'ün eşidir; M06T ve M06R,
# tablet dilimlerinin eski adları, M06'nın eşidir).
ONLY_MODS=()
if [ -n "$ONLY" ]; then
  known=" $(for s in "${STEPS[@]}"; do printf '%s ' "${s%%|*}"; done)"
  unknown=()
  IFS=',' read -ra raw_mods <<< "$ONLY"
  for m in "${raw_mods[@]}"; do
    m="$(echo "$m" | tr -d '[:space:]' | tr '[:lower:]' '[:upper:]')"
    [ -z "$m" ] && continue
    [ "$m" = "M13L" ] && m="M13"
    { [ "$m" = "M06T" ] || [ "$m" = "M06R" ]; } && m="M06"
    if [[ "$known" == *" $m "* ]]; then ONLY_MODS+=("$m"); else unknown+=("$m"); fi
  done
  if [ "${#unknown[@]}" -gt 0 ] || [ "${#ONLY_MODS[@]}" -eq 0 ]; then
    echo "HATA: --only içinde bilinmeyen modül: ${unknown[*]:-(boş liste)}" >&2
    echo "      geçerli modüller:$(printf ' %s' $(tr ' ' '\n' <<<"$known" | awk 'NF && !seen[$0]++'))" >&2
    rm -rf "$WORK"
    exit 2
  fi
fi

selected() {   # selected <modül>
  [ -z "$ONLY" ] && return 0
  local m
  for m in "${ONLY_MODS[@]}"; do
    [ "$m" = "$1" ] && return 0
  done
  return 1
}

if [ "$LIST" -eq 1 ]; then
  for s in "${STEPS[@]}"; do
    IFS='|' read -r mod kind desc fn <<< "$s"
    selected "$mod" || continue
    printf '%-5s %-10s %-24s %s\n' "$mod" "$kind" "$fn" "$desc"
  done
  rm -rf "$WORK"
  exit 0
fi

# Aynı depoda tek koşu: depo içi derleme çıktıları paylaşılır (iki eş zamanlı koşu M11'i yanlış FAIL ettirdi).
# Kilit deponun dışında, kök yolunun sağlamasıyla adlandırılır; flock yoksa (macOS) uyarıp kilitsiz devam eder.
if command -v flock >/dev/null; then
  LOCK="${TMPDIR:-/tmp}/ogrenmen-check-all-$(printf %s "$ROOT" | cksum | cut -d' ' -f1).lock"
  exec 9>"$LOCK"
  if ! flock -n 9; then
    echo "Başka bir check-all koşusu sürüyor ($LOCK); bitmesi bekleniyor (en çok 30 dk)…"
    flock -w 1800 9 || { echo "HATA: başka bir check-all koşuyor; kilit 30 dakikada bırakılmadı" >&2; rm -rf "$WORK"; exit 2; }
  fi
else
  echo "UYARI: flock yok; eş zamanlı koşular depo içi derleme çıktılarını paylaşır (aynı anda iki koşu başlatma)."
fi

fmt_secs() { awk -v s="$1" 'BEGIN { printf "%6.1f sn", s }'; }
now() { date +%s.%N; }

N_PASS=0; N_FAIL=0; N_SKIP=0
FAILED=()
START_ALL="$(now)"
mode="tam"
[ "$QUICK" -eq 1 ] && mode="hızlı (--quick)"
[ "$LIVE_ONLY" -eq 1 ] && mode="yalnız canlı (--live-only)"
db_note="yok (canlı adımlar SKIP)"
[ "$HAS_DB" -eq 1 ] && db_note="var (geçici veritabanı: $OGRENMEN_TEST_DB)"
echo "Öğrenmen kabul denetimi — kip: $mode; OGRENMEN_DATABASE_URL: $db_note"
echo "Depo: $ROOT · günlükler: $LOGS"
echo

i=0
for s in "${STEPS[@]}"; do
  IFS='|' read -r mod kind desc fn <<< "$s"
  selected "$mod" || continue
  i=$((i + 1))
  label="$(printf '%-5s %s' "$mod" "$desc")"
  if [ "$LIVE_ONLY" -eq 1 ] && [ "$kind" != "live" ] && [ "$kind" != "livealways" ]; then
    continue
  fi
  if [ "$kind" = "heavy" ] && [ "$QUICK" -eq 1 ]; then
    printf 'SKIP  %s  %s  (--quick)\n' "$(fmt_secs 0)" "$label"
    N_SKIP=$((N_SKIP + 1)); continue
  fi
  if [ "$kind" = "live" ] && [ "$HAS_DB" -eq 0 ]; then
    printf 'SKIP  %s  %s  (OGRENMEN_DATABASE_URL yok)\n' "$(fmt_secs 0)" "$label"
    N_SKIP=$((N_SKIP + 1)); continue
  fi
  if [ "$kind" = "livealways" ] && [ "$HAS_DB" -eq 0 ] && [ "$LIVE_ONLY" -eq 1 ]; then
    printf 'SKIP  %s  %s  (OGRENMEN_DATABASE_URL yok)\n' "$(fmt_secs 0)" "$label"
    N_SKIP=$((N_SKIP + 1)); continue
  fi
  log="$LOGS/$(printf '%02d' "$i")-$fn.log"
  { echo "# $label"; declare -f "$fn"; echo "# ---- çıktı"; } > "$log"
  t0="$(now)"
  ( cd "$NEUTRAL" && "$fn" ) >> "$log" 2>&1 < /dev/null
  rc=$?
  dt="$(awk -v a="$t0" -v b="$(now)" 'BEGIN { print b - a }')"
  if [ "$rc" -eq 0 ] && [ "$kind" = "livealways" ] && [ "$HAS_DB" -eq 1 ] && grep -q '^SKIP: no database' "$log"; then
    echo "HATA: OGRENMEN_DATABASE_URL tanımlı ama adım 'SKIP: no database' yazdı" >> "$log"
    rc=1
  fi
  if [ "$rc" -eq 0 ]; then
    if [ "$kind" = "livealways" ]; then
      # Günlükteki gerçek SKIP satırları etikete yazılır (ör. DB yokken "no database", DB varken "no keys").
      skips="$(grep -oE '^[[:space:]]*SKIP: [^(]*' "$log" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' \
        | awk '!seen[$0]++' | paste -sd ';' - | sed 's/;/; /g')"
      [ -n "$skips" ] && label="$label [$skips]"
    fi
    printf 'PASS  %s  %s\n' "$(fmt_secs "$dt")" "$label"
    N_PASS=$((N_PASS + 1))
  else
    printf 'FAIL  %s  %s  (çıkış %s; günlük: %s)\n' "$(fmt_secs "$dt")" "$label" "$rc" "$log"
    tail -n 40 "$log" | sed 's/^/      │ /'
    N_FAIL=$((N_FAIL + 1)); FAILED+=("$mod $desc")
  fi
done

TOTAL="$(awk -v a="$START_ALL" -v b="$(now)" 'BEGIN { print b - a }')"
echo
echo "Özet: $N_PASS PASS, $N_FAIL FAIL, $N_SKIP SKIP — toplam $(fmt_secs "$TOTAL" | tr -s ' ')"
if [ $((N_PASS + N_FAIL + N_SKIP)) -eq 0 ]; then
  echo "HATA: seçimle eşleşen adım yok (ör. --live-only --only M00); boş koşu yeşil sayılmaz"
  rm -rf "$WORK"
  exit 1
fi
if [ "$N_FAIL" -gt 0 ]; then
  echo "Başarısız adımlar:"
  for f in "${FAILED[@]}"; do echo "  - $f"; done
  echo "Günlükler korunur: $LOGS"
  exit 1
fi
rm -rf "$WORK"
exit 0
