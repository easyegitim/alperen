#!/usr/bin/env bash
# packages/doc-render/check.sh — belge oluşturucu: örnek belgeler güncel mi, typecheck, eslint, vitest
# (HTML/KaTeX/anahtar sızıntısı testleri + Playwright PDF testleri). OGRENMEN_QUICK=1: PDF testlerinde yalnız deneme.
# Chromium yoksa PDF testleri SKIP edilir (HTML testleri yine koşar).
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
# shellcheck source=../../scripts/lib.sh
source "$ROOT/scripts/lib.sh"

ogr_step "doc-render: bağımlılıklar"
ogr_bun_install

ogr_step "doc-render: fixtures/documents güncel (gen-fixtures --check; sözleşme doğrulaması dahil)"
bun run --cwd "$HERE" fixtures:check

ogr_step "doc-render: typecheck"
bun run --cwd "$HERE" typecheck

ogr_step "doc-render: eslint"
bun run --cwd "$HERE" lint

if (cd "$HERE" && bun -e "import { chromium } from 'playwright-core'; import { existsSync } from 'node:fs'; process.exit(existsSync(chromium.executablePath()) ? 0 : 1)") 2>/dev/null; then
  ogr_step "doc-render: vitest (HTML, KaTeX, şekil, tablo, anahtar sızıntısı, PDF sayfa/metin/görsel baseline)"
  bun run --cwd "$HERE" test
else
  ogr_step "doc-render: vitest (yalnız HTML testleri)"
  ogr_skip "doc-render: PDF testleri (Playwright Chromium bulunamadı; PLAYWRIGHT_BROWSERS_PATH ya da 'playwright install chromium')"
  bun run --cwd "$HERE" test test/render.test.ts
fi
