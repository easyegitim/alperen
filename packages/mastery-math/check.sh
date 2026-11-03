#!/usr/bin/env bash
# packages/mastery-math/check.sh — BKT ustalık matematiği: TS ve Python uygulamaları + SQL kopya sapması.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
# shellcheck source=../../scripts/lib.sh
source "$ROOT/scripts/lib.sh"

ogr_step "mastery-math (TS): typecheck + test"
ogr_bun_install
bun run --cwd "$HERE" typecheck
bun test --cwd "$HERE"

ogr_step "mastery-math (Python): ruff + pytest"
ogr_pip -e "$HERE/python[dev]"
ruff check "$HERE/python"
python -m pytest "$HERE/python" -q
