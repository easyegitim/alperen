#!/usr/bin/env bash
# scripts/lib.sh — modül check.sh dosyalarının ortak yardımcıları (source edilir, doğrudan çalıştırılmaz).
#
# Kullanım (modül kökündeki check.sh'te; derinliğe göre ../.. ya da ../../..):
#   ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
#   source "$ROOT/scripts/lib.sh"
#
# Sözleşme (bkz. scripts/check-all.sh):
#   * check.sh: bash, set -euo pipefail, lint + typecheck + birim testleri; herhangi bir adım düşerse çıkış != 0.
#   * Canlı servis gerektiren adımlar (canlı Postgres, gerçek API anahtarı) yalnız OGRENMEN_LIVE=1 iken koşar;
#     değilse "SKIP: ..." yazılır (ogr_skip) ve diğer adımlar koşmaya devam eder. Modülün tamamı atlanıyorsa
#     ogr_skip_all (çıkış 77) kullanılır; check-all bunu modül SKIP'i sayar.
#   * OGRENMEN_QUICK=1: ağır derleme adımları (ör. next build) atlanır ve "SKIP" yazılır.
#   * Çalışma dosyaları check.sh'e özel geçici dizine yazılır (ogr_tmpdir); /tmp altında sabit yol yok.

[ -n "${OGR_LIB_LOADED:-}" ] && return 0
OGR_LIB_LOADED=1

OGR_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export OGR_ROOT
: "${OGRENMEN_LIVE:=0}"
: "${OGRENMEN_QUICK:=0}"
export OGRENMEN_LIVE OGRENMEN_QUICK

# Canlı kipte veritabanı adresi verilmediyse yerel geliştirme veritabanı varsayılır (README "Çalıştırma").
OGR_DEFAULT_DB_URL="postgresql://ogrenmen:ogrenmen@127.0.0.1:5432/ogrenmen"

ogr_step() { printf '\n== %s\n' "$*"; }
ogr_skip() { printf 'SKIP: %s\n' "$*"; }
# Modülün tamamı atlanıyorsa: "SKIP: ..." yazar ve 77 ile çıkar (check-all bunu modül SKIP'i sayar).
ogr_skip_all() { ogr_skip "$*"; exit 77; }

ogr_is_live() { [ "$OGRENMEN_LIVE" = "1" ]; }
ogr_is_quick() { [ "$OGRENMEN_QUICK" = "1" ]; }

# Canlı kipte OGRENMEN_DATABASE_URL'i dışa aktarır (yoksa yerel varsayılan). Canlı değilse dokunmaz.
ogr_live_env() {
  if ogr_is_live; then
    export OGRENMEN_DATABASE_URL="${OGRENMEN_DATABASE_URL:-$OGR_DEFAULT_DB_URL}"
  fi
}

# Bu check.sh'e özel geçici dizin ($WORK); çıkışta silinir.
ogr_tmpdir() {
  WORK="$(mktemp -d "${TMPDIR:-/tmp}/ogrenmen-check.XXXXXX")"
  export WORK
  # shellcheck disable=SC2064
  trap "rm -rf '$WORK'" EXIT
}

# Kök bun çalışma alanını kurar. Paralel koşular aynı anda kurmasın diye kilitlidir.
# CI'da (CI tanımlı) --frozen-lockfile: bun.lock sessizce yeniden yazılmaz, sapma burada hata verir.
# Yerelde kilit dosyası gerekirse güncellenir (geliştirici `git diff bun.lock` ile görür).
ogr_bun_install() {
  command -v bun >/dev/null || { echo "HATA: bun yok (bun 1.4 gerekir)" >&2; return 1; }
  # shellcheck disable=SC2086
  flock /tmp/ogrenmen-bun.lock bun install --cwd "$OGR_ROOT" ${CI:+--frozen-lockfile} >/dev/null
}

# pip install -e <yol>... (kilitli, sessiz). Yerel paket yolları mutlak olmalı.
ogr_pip() {
  PIP_ROOT_USER_ACTION=ignore flock /tmp/ogrenmen-pip.lock python -m pip install -q --disable-pip-version-check "$@"
}

# Python boru hatlarının ortak tabanı (pipelines/common README'si); ek pip argümanları sona eklenir.
ogr_pip_base() {
  ogr_pip -e "$OGR_ROOT/packages/contracts/python" -e "$OGR_ROOT/packages/mastery-math/python" \
    -e "$OGR_ROOT/packages/pii/py" -e "$OGR_ROOT/pipelines/common[dev]" "$@"
}

# Canlı testleri ayrı koşar: atlanan test PASS sayılmaz; en az bir test geçmeli, hiçbiri atlanmamalı.
#   ogr_live_pytest <pytest argümanları…>
ogr_live_pytest() {
  command -v psql >/dev/null || { echo "HATA: psql yok (postgresql-client kur); canlı testler koşamaz" >&2; return 1; }
  local out rc=0
  out="$(python -m pytest "$@" -rs 2>&1)" || rc=$?
  printf '%s\n' "$out"
  [ "$rc" -eq 0 ] || return "$rc"
  if grep -qE '[0-9]+ skipped|^SKIPPED' <<<"$out"; then
    echo "HATA: canlı testler atlandı (yukarıdaki SKIPPED satırları)" >&2
    return 1
  fi
  grep -qE '[0-9]+ passed' <<<"$out" || { echo "HATA: hiç canlı test geçmedi" >&2; return 1; }
}

# Olumsuz denetimler. `! komut` set -e altında HİÇBİR ZAMAN çıkışı tetiklemez (bash kuralı); bu yüzden açık işlevler.
#   ogr_absent <desen> <dosya>   dosyada desen varsa (ya da dosya yoksa) hata verir
#   ogr_no_file <yol>            dosya varsa hata verir
ogr_absent() {
  test -f "$2" || { echo "HATA: $2 yok" >&2; return 1; }
  if grep -q -- "$1" "$2"; then echo "HATA: $2 içinde yasak desen bulundu: $1" >&2; return 1; fi
}
ogr_no_file() {
  if test -e "$1"; then echo "HATA: olmaması gereken dosya var: $1" >&2; return 1; fi
}
