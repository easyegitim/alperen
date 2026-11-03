#!/usr/bin/env bash
# packages/design-system/check.sh — tasarım sistemi: tokens sapması + typecheck + eslint + vitest (+ önizleme derlemesi).
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
# shellcheck source=../../scripts/lib.sh
source "$ROOT/scripts/lib.sh"

ogr_step "design-system: bağımlılıklar"
ogr_bun_install

ogr_step "design-system: tokens.json -> CSS/Tailwind sapma denetimi (yeniden üretim diff temiz)"
node "$HERE/scripts/tokens-to-css.mjs" --check

ogr_step "design-system: typecheck"
bun run --cwd "$HERE" typecheck

ogr_step "design-system: eslint"
bun run --cwd "$HERE" lint

ogr_step "design-system: vitest (render, erişilebilirlik, kanıt eşiği, mod seçici, adım merdiveni, ...)"
bun run --cwd "$HERE" test

if ogr_is_quick; then
  ogr_skip "design-system: önizleme derlemesi (OGRENMEN_QUICK=1)"
else
  ogr_step "design-system: önizleme derlemesi (vite build -> preview/dist)"
  bun run --cwd "$HERE" preview:build >/dev/null
fi
