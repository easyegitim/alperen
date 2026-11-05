#!/usr/bin/env bash
# scripts/check-all.sh — depodaki tüm denetimler tek komutta (Öğrenmen 2.0; docs/PLAN-v2.md "Doğrulama").
#
# Sırayla koşar:
#   (a) kök denetimleri: sır taraması, kopya sapması, fixtures, RPC paritesi, betik testleri, workflow lint'i
#   (b) keşfedilen modül denetimleri: apps, packages, pipelines, supabase, content altında (en çok 2 düzey)
#       <modül>/check.sh dosyalarının hepsi, ada göre sıralı. check.sh'i olmayan dizinler yok sayılır.
#
#   --quick       OGRENMEN_LIVE=0 ve OGRENMEN_QUICK=1: canlı servis yok, ağır derlemeler (next build vb.) atlanır
#   --live        OGRENMEN_LIVE=1: canlı Postgres ve gerçek servis adımları da koşar (veritabanı adresi
#                 OGRENMEN_DATABASE_URL; yoksa yerel varsayılan)
#   (bayraksız)   OGRENMEN_LIVE kabuktaki değerinde kalır (varsayılan 0); ağır adımlar dahil
#   --only LISTE  yalnız adı bu desenlerden birini içeren adımlar, virgülle (ör. --only pipelines/tablet,root:)
#   --list        adımları listele, çalıştırma
#   -h, --help    bu metin
#
# check.sh sözleşmesi (scripts/lib.sh): bash, set -euo pipefail; çıkış 0 = geçti, 77 = modülün tamamı atlandı (SKIP),
# diğerleri = başarısız. Bir modül kısmen atlayabilir (ör. canlı testler): günlükteki "SKIP:" satırları PASS satırının
# yanına yazılır. Herhangi bir FAIL, ya da seçimle eşleşen hiç adım olmaması → çıkış 1 (boş koşu yeşil sayılmaz).
# Her adımın tam çıktısı geçici dizindeki logs/ altındadır; FAIL olan adımın son 40 satırı ekrana yazılır.
# Komutlar nötr (boş) bir çalışma dizininden koşar: hiçbiri çağıran dizine bağlı olmamalıdır.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
QUICK=0
LIVE_FLAG=0
ONLY=""
LIST=0
while [ $# -gt 0 ]; do
  case "$1" in
    --quick) QUICK=1; shift ;;
    --live) LIVE_FLAG=1; shift ;;
    --only) ONLY="${2:?--only desen listesi ister (ör. packages/pii,root:)}"; shift 2 ;;
    --only=*) ONLY="${1#--only=}"; shift ;;
    --list) LIST=1; shift ;;
    -h|--help) sed -n '2,23p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "HATA: bilinmeyen seçenek $1 (bkz. --help)" >&2; exit 2 ;;
  esac
done
if [ "$QUICK" -eq 1 ] && [ "$LIVE_FLAG" -eq 1 ]; then
  echo "HATA: --quick ve --live birlikte kullanılamaz" >&2
  exit 2
fi

if [ "$QUICK" -eq 1 ]; then
  export OGRENMEN_LIVE=0 OGRENMEN_QUICK=1
elif [ "$LIVE_FLAG" -eq 1 ]; then
  export OGRENMEN_LIVE=1 OGRENMEN_QUICK=0
else
  export OGRENMEN_LIVE="${OGRENMEN_LIVE:-0}" OGRENMEN_QUICK=0
fi

# ------------------------------------------------------------------------------------------- kök adımları
# Her adım bir fonksiyondur; kök yolu $ROOT'tan alınır.

root_secret_scan() {
  bash "$ROOT/scripts/secret-scan.sh"
}
root_drift() {
  python3 "$ROOT/scripts/check-drift.py"
}
root_fixtures() {
  python3 "$ROOT/scripts/check-fixtures.py" \
    && python3 "$ROOT/fixtures/scripts/build_fixtures.py" --check \
    && python3 -m pytest "$ROOT/fixtures/scripts" -q \
    && ffmpeg -v error -i "$ROOT/fixtures/ders/lesson-01.wav" -f null -
}
root_rpc_parity() {
  python3 "$ROOT/scripts/check-rpc-parity.py" --only-problems
}
root_scripts_tests() {
  ruff check "$ROOT/scripts" "$ROOT/fixtures/scripts" && python3 -m pytest "$ROOT/scripts/tests" -q \
    && (cd "$ROOT" && bun test scripts/dev-local)
}
root_workflows() {
  yamllint -d relaxed "$ROOT/.github/workflows" \
    && python3 -c "import yaml,glob;[yaml.safe_load(open(f)) for f in glob.glob('$ROOT/.github/workflows/*.yml')]" \
    && make -C "$ROOT" -n check check-quick db-test >/dev/null || return 1
  # actionlint CI'da sabit sürümle kurulur (ci.yml); yerelde kuruluysa burada da koşar.
  if command -v actionlint >/dev/null; then
    actionlint "$ROOT"/.github/workflows/*.yml
  else
    echo "SKIP: actionlint kurulu değil; CI'da koşar (python -m pip install actionlint-py)"
  fi
}

# ad|açıklama|fonksiyon
ROOT_STEPS=(
  "root:secret-scan|sır taraması (gerçek görünümlü anahtar yok)|root_secret_scan"
  "root:drift|BKT ve PII SQL kopyaları migration'larla birebir|root_drift"
  "root:fixtures|fixtures: sözleşmeler, üreticiler güncel, testler, ffmpeg|root_fixtures"
  "root:rpc-parity|RPC adı + parametre paritesi (pipelines ↔ supabase)|root_rpc_parity"
  "root:scripts-tests|scripts/ ve fixtures/scripts ruff + betik testleri|root_scripts_tests"
  "root:workflows|workflow yamllint + YAML + make -n (+ actionlint)|root_workflows"
)

# ------------------------------------------------------------------------------------------- keşif
# Modül denetimleri: <dizin>/check.sh; bulunma sırası ada göredir (LC_ALL=C).
mapfile -t DISCOVERED < <(cd "$ROOT" && find apps packages pipelines supabase content -maxdepth 2 -name check.sh \
  -not -path '*/node_modules/*' 2>/dev/null | LC_ALL=C sort)

STEPS=("${ROOT_STEPS[@]}")
for f in "${DISCOVERED[@]}"; do
  mod="$(dirname "$f")"
  STEPS+=("$mod|$mod/check.sh|@script:$f")
done

# --only: virgülle ayrılmış alt dizge desenleri.
selected() {   # selected <adım adı>
  [ -z "$ONLY" ] && return 0
  local pat
  IFS=',' read -ra pats <<< "$ONLY"
  for pat in "${pats[@]}"; do
    pat="$(echo "$pat" | tr -d '[:space:]')"
    [ -z "$pat" ] && continue
    [[ "$1" == *"$pat"* ]] && return 0
  done
  return 1
}

if [ "$LIST" -eq 1 ]; then
  for s in "${STEPS[@]}"; do
    IFS='|' read -r name desc fn <<< "$s"
    selected "$name" || continue
    printf '%-26s %s\n' "$name" "$desc"
  done
  exit 0
fi

# Bilinen uyarı: bir dizinde paket/proje dosyası var ama check.sh yok (yeni modül henüz iskelet olabilir).
for d in "$ROOT"/apps/* "$ROOT"/packages/* "$ROOT"/pipelines/*; do
  [ -d "$d" ] || continue
  [ -f "$d/check.sh" ] && continue
  if [ -f "$d/package.json" ] || [ -f "$d/pyproject.toml" ]; then
    echo "UYARI: ${d#"$ROOT"/} içinde check.sh yok (yok sayıldı)"
  fi
done

# ------------------------------------------------------------------------------------------- çalıştırma
WORK="$(mktemp -d "${TMPDIR:-/tmp}/ogrenmen-check-all.XXXXXX")"
LOGS="$WORK/logs"
NEUTRAL="$WORK/cwd"
mkdir -p "$LOGS" "$NEUTRAL"
export ROOT

# Aynı depoda tek koşu: derleme çıktıları ve pip/bun kurulumları paylaşılır. Kilit deponun dışında, kök yolunun
# sağlamasıyla adlandırılır; flock yoksa uyarıp kilitsiz devam eder.
if command -v flock >/dev/null; then
  LOCK="${TMPDIR:-/tmp}/ogrenmen-check-all-$(printf %s "$ROOT" | cksum | cut -d' ' -f1).lock"
  exec 9>"$LOCK"
  if ! flock -n 9; then
    echo "Başka bir check-all koşusu sürüyor ($LOCK); bitmesi bekleniyor (en çok 30 dk)..."
    flock -w 1800 9 || { echo "HATA: başka bir check-all koşuyor; kilit 30 dakikada bırakılmadı" >&2; rm -rf "$WORK"; exit 2; }
  fi
else
  echo "UYARI: flock yok; eş zamanlı koşular depo içi çıktıları paylaşır (aynı anda iki koşu başlatma)."
fi

fmt_secs() { awk -v s="$1" 'BEGIN { printf "%6.1f sn", s }'; }
now() { date +%s.%N; }

N_PASS=0; N_FAIL=0; N_SKIP=0; N_PARTIAL=0
FAILED=()
START_ALL="$(now)"
mode="tam"
[ "$QUICK" -eq 1 ] && mode="hızlı (--quick)"
[ "$LIVE_FLAG" -eq 1 ] && mode="canlı (--live)"
echo "Öğrenmen denetimi — kip: $mode; OGRENMEN_LIVE=$OGRENMEN_LIVE OGRENMEN_QUICK=$OGRENMEN_QUICK"
echo "Depo: $ROOT · günlükler: $LOGS"
echo

i=0
for s in "${STEPS[@]}"; do
  IFS='|' read -r name desc fn <<< "$s"
  selected "$name" || continue
  i=$((i + 1))
  label="$(printf '%-26s %s' "$name" "$desc")"
  log="$LOGS/$(printf '%02d' "$i")-$(tr '/:' '__' <<<"$name").log"
  { echo "# $label"; echo "# ---- çıktı"; } > "$log"
  t0="$(now)"
  if [[ "$fn" == @script:* ]]; then
    ( cd "$NEUTRAL" && bash "$ROOT/${fn#@script:}" ) >> "$log" 2>&1 < /dev/null
  else
    ( cd "$NEUTRAL" && "$fn" ) >> "$log" 2>&1 < /dev/null
  fi
  rc=$?
  dt="$(awk -v a="$t0" -v b="$(now)" 'BEGIN { print b - a }')"
  skips="$(grep -oE '^[[:space:]]*SKIP: [^(]*' "$log" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' \
    | awk '!seen[$0]++' | paste -sd ';' - | sed 's/;/; /g')"
  if [ "$rc" -eq 77 ]; then
    printf 'SKIP  %s  %s  [%s]\n' "$(fmt_secs "$dt")" "$label" "${skips:-atlandı}"
    N_SKIP=$((N_SKIP + 1))
  elif [ "$rc" -eq 0 ]; then
    note=""
    if [ -n "$skips" ]; then note="  [$skips]"; N_PARTIAL=$((N_PARTIAL + 1)); fi
    printf 'PASS  %s  %s%s\n' "$(fmt_secs "$dt")" "$label" "$note"
    N_PASS=$((N_PASS + 1))
  else
    printf 'FAIL  %s  %s  (çıkış %s; günlük: %s)\n' "$(fmt_secs "$dt")" "$label" "$rc" "$log"
    tail -n 40 "$log" | sed 's/^/      | /'
    N_FAIL=$((N_FAIL + 1)); FAILED+=("$name")
  fi
done

TOTAL="$(awk -v a="$START_ALL" -v b="$(now)" 'BEGIN { print b - a }')"
echo
echo "Özet: $N_PASS PASS, $N_FAIL FAIL, $N_SKIP SKIP — toplam $(fmt_secs "$TOTAL" | tr -s ' ')"
if [ "$N_PARTIAL" -gt 0 ]; then
  echo "Not: $N_PARTIAL PASS satırı kısmen atlanan adım taşıyor (köşeli parantez; canlı kip için --live)."
fi
if [ $((N_PASS + N_FAIL + N_SKIP)) -eq 0 ]; then
  echo "HATA: seçimle eşleşen adım yok; boş koşu yeşil sayılmaz"
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
