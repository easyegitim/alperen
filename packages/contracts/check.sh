#!/usr/bin/env bash
# packages/contracts/check.sh — sözleşmeler: eslint + typecheck + vitest + JSON Schema dışa aktarım sapması + Python testleri.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
# shellcheck source=../../scripts/lib.sh
source "$ROOT/scripts/lib.sh"

ogr_step "contracts (TS): bağımlılıklar"
ogr_bun_install

ogr_step "contracts (TS): eslint"
bun run --cwd "$HERE" lint

ogr_step "contracts (TS): typecheck"
bun run --cwd "$HERE" typecheck

ogr_step "contracts (TS): JSON Schema dışa aktarımı güncel mi (zod -> schemas/*.schema.json)"
bun run --cwd "$HERE" export:check

ogr_step "contracts (TS): vitest (fikstürler, strict kısıtlar, dışa aktarım yeniden üretilebilirliği)"
bun run --cwd "$HERE" test

ogr_step "contracts (Python): ruff + pytest (JSON Schema okuyucu; schemas/*.schema.json fikstürleri)"
ogr_pip -e "$HERE/python[dev]"
ruff check "$HERE/python"
python -m pytest "$HERE/python" -q
