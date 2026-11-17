#!/usr/bin/env bash
# apps/worker/check.sh — işçi: typecheck + eslint + vitest (registry, pdf, işler) + pg-boss entegrasyonu (canlı).
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
# shellcheck source=../../scripts/lib.sh
source "$ROOT/scripts/lib.sh"

ogr_step "worker: bağımlılıklar"
ogr_bun_install

ogr_step "worker: typecheck"
bun run --cwd "$HERE" typecheck

ogr_step "worker: eslint"
bun run --cwd "$HERE" lint

ogr_step "worker: vitest (kayıt defteri, işler, Playwright PDF)"
OGRENMEN_LLM=fake bun run --cwd "$HERE" test

if ogr_is_live; then
  ogr_live_env
  ogr_step "worker: canlı testler (pg-boss geçici şema; müfredat, öneri motoru ve gece işleri geçici veritabanında)"
  DATABASE_URL="${DATABASE_URL:-$OGRENMEN_DATABASE_URL}" bun run --cwd "$HERE" test:live
else
  ogr_skip "worker: pg-boss entegrasyon testi (OGRENMEN_LIVE=1 ve canlı Postgres gerekir)"
fi
