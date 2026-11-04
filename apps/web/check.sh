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

if ogr_is_live; then
  ogr_step "web: vitest (yönlendirme, doğrulama, tema, push, tip uyumu, DS giriş noktası, koç sohbeti, Bugün/Test/Gelişim + Postgres entegrasyonu: koç sohbeti, öğrenci akışı)"
else
  ogr_step "web: vitest (yönlendirme, doğrulama, tema, push, tip uyumu, DS giriş noktası, koç sohbeti, Bugün/Test/Gelişim; Postgres testleri OGRENMEN_LIVE=1 ister)"
fi
# Koç sohbeti her zaman sahte LLM ile sınanır (anahtar gerekmez); test/*.db.test.ts (koç sohbeti, öğrenci akışı:
# onboarding_enroll → öneriler → start/answer/finish_practice; TYT anahtar seed'i) OGRENMEN_LIVE=1'de geçici
# veritabanı kurar (packages/llm testing; yerel Postgres).
OGRENMEN_LLM=fake bun run --cwd "$HERE" test

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
  ogr_step "web: Playwright E2E (sahte Supabase + sahte LLM; giriş, rol yönlendirmesi, 3 kabuk x 390/1440 px, koç sohbeti, onboarding → Bugün → test → sonuç → Gelişim 390 px)"
  # Sabit portlar: eşzamanlı koşular birbirini bozmasın diye kilitle serileştirilir.
  flock /tmp/ogrenmen-web-e2e.lock bun run --cwd "$HERE" test:e2e
  ogr_step "web: P1+P2 yolculuğu E2E (gerçek Postgres + köprü + worker + next dev; sahte LLM): giriş → onboarding → Bugün → test → sonuç → koç → yükle → teşhis; yeni ders → curriculum.draft; P2: Okul denemesi → rapor PDF, uygulama içi deneme"
  # Yığın (e2e/journey/stack.ts) geçici veritabanı kurar ve sonunda siler; sabit portlar (54398/3102/3103) kilitle serileştirilir.
  flock /tmp/ogrenmen-web-journey.lock bun run --cwd "$HERE" test:journey
else
  ogr_skip "web: Playwright E2E (OGRENMEN_LIVE=1 gerekir; tarayıcı: Chromium, PLAYWRIGHT_BROWSERS_PATH)"
  ogr_skip "web: P1+P2 yolculuğu E2E (OGRENMEN_LIVE=1 ve yerel Postgres gerekir)"
fi
