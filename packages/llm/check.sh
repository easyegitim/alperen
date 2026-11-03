#!/usr/bin/env bash
# packages/llm/check.sh — Anthropic geçidi: typecheck + eslint + vitest (sahte taşıma) + canlı Postgres (hafıza, dossier)
# + canlı Haiku önbellek testi.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
# shellcheck source=../../scripts/lib.sh
source "$ROOT/scripts/lib.sh"

ogr_step "llm: bağımlılıklar"
ogr_bun_install

ogr_step "llm: typecheck"
bun run --cwd "$HERE" typecheck

ogr_step "llm: eslint (temperature/top_p/top_k, tool_choice, budget_tokens yasak)"
bun run --cwd "$HERE" lint

ogr_step "llm: vitest (OGRENMEN_LLM=fake: rota gövdeleri, onarım, ret, fiyat, hafıza, delta, dossier, defter, Batch)"
OGRENMEN_LLM=fake bun run --cwd "$HERE" test

if ogr_is_live; then
  ogr_live_env
  ogr_step "llm: veritabanı entegrasyonu (PgStore ↔ memory_files, applyMemoryDelta, renderDossier ↔ render_dossier; geçici veritabanı)"
  OGRENMEN_DATABASE_URL="$OGRENMEN_DATABASE_URL" bun run --cwd "$HERE" test:db
else
  ogr_skip "llm: veritabanı entegrasyon testi (OGRENMEN_LIVE=1 ve canlı Postgres gerekir)"
fi

if ogr_is_live && [ -n "${ANTHROPIC_API_KEY:-}" ]; then
  ogr_step "llm: canlı Haiku 5.5 parse + cache_read_input_tokens > 0"
  bun run --cwd "$HERE" test:live
else
  ogr_skip "llm: canlı Anthropic testi (OGRENMEN_LIVE=1 ve ANTHROPIC_API_KEY gerekir)"
fi
