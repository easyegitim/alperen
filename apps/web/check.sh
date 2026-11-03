#!/usr/bin/env bash
# apps/web/check.sh — Next.js web uygulaması: typecheck + eslint + vitest + next build (+ Playwright E2E, OGRENMEN_LIVE=1).
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
# shellcheck source=../../scripts/lib.sh
source "$ROOT/scripts/lib.sh"

ogr_step "web: bağımlılıklar"
ogr_bun_install

ogr_step "web: typecheck (next typegen + tsc + servis çalışanı tsconfig'i)"
bun run --cwd "$HERE" typecheck

ogr_step "web: eslint (eslint-config-next, 0 uyarı)"
bun run --cwd "$HERE" lint

ogr_step "web: vitest (yönlendirme, doğrulama, tema, push, tip uyumu, DS giriş noktası)"
bun run --cwd "$HERE" test

if ogr_is_quick; then
  ogr_skip "web: next build (OGRENMEN_QUICK=1)"
else
  ogr_step "web: next build --webpack (Serwist servis çalışanı dahil)"
  # Derleme için gerçek Supabase gerekmez; adresler yalnız tanımlı olsun diye verilir (çalışma zamanında okunur).
  NEXT_PUBLIC_SUPABASE_URL="${NEXT_PUBLIC_SUPABASE_URL:-http://127.0.0.1:54321}" \
    NEXT_PUBLIC_SUPABASE_ANON_KEY="${NEXT_PUBLIC_SUPABASE_ANON_KEY:-build-placeholder-anon-key}" \
    bun run --cwd "$HERE" build >/dev/null
  test -s "$HERE/public/sw.js" || { echo "HATA: public/sw.js üretilmedi (Serwist)" >&2; exit 1; }
fi

if ogr_is_live; then
  ogr_step "web: Playwright E2E (sahte Supabase; giriş, rol yönlendirmesi, 3 kabuk x 390/1440 px ekran görüntüsü)"
  bun run --cwd "$HERE" test:e2e
else
  ogr_skip "web: Playwright E2E (OGRENMEN_LIVE=1 gerekir; tarayıcı: Chromium, PLAYWRIGHT_BROWSERS_PATH)"
fi
