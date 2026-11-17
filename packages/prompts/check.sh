#!/usr/bin/env bash
# packages/prompts/check.sh — prompt paketi: gömülü kaynak + kilit güncel mi, typecheck, eslint, vitest (sahte geçit),
# eval (sahte kip, betik yanıtlar), canlı: geçici veritabanında prompt_versions eşitlemesi ve count_tokens.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
# shellcheck source=../../scripts/lib.sh
source "$ROOT/scripts/lib.sh"

ogr_step "prompts: bağımlılıklar"
ogr_bun_install

ogr_step "prompts: gömülü kaynak ve kilit güncel (lint kuralları, 512 token eşiği, yayımlanmış sürüm değişmezliği)"
bun run --cwd "$HERE" bundle:check

ogr_step "prompts: typecheck"
bun run --cwd "$HERE" typecheck

ogr_step "prompts: eslint"
bun run --cwd "$HERE" lint

ogr_step "prompts: vitest (front-matter, sürüm seçimi, katman birleştirme, rota tablosu, eval puanlayıcı, geçit)"
OGRENMEN_LLM=fake bun run --cwd "$HERE" test

ogr_step "prompts: eval (OGRENMEN_LLM=fake; betik yanıtlarla tüm vakalar geçmeli)"
OGRENMEN_LLM=fake bun run --cwd "$HERE" eval

if ogr_is_live; then
  ogr_live_env
  ogr_step "prompts: canlı Postgres (geçici veritabanında prompt_versions + runtime_flags)"
  bun run --cwd "$HERE" test:live test/db.live.test.ts
else
  ogr_skip "prompts: canlı Postgres testi (OGRENMEN_LIVE=1 gerekir)"
fi

if ogr_is_live && [ -n "${ANTHROPIC_API_KEY:-}" ]; then
  ogr_step "prompts: canlı count_tokens (her prompt ≥ 512 token)"
  bun run --cwd "$HERE" test:live test/count-tokens.live.test.ts
else
  ogr_skip "prompts: canlı count_tokens (OGRENMEN_LIVE=1 ve ANTHROPIC_API_KEY gerekir)"
fi
