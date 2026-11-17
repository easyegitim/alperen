#!/usr/bin/env bash
# pipelines/common/check.sh — ogrenmen_common: ruff + pytest + selftest (sahte adaptörler, ağ yok).
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
# shellcheck source=../../scripts/lib.sh
source "$ROOT/scripts/lib.sh"

ogr_step "common: pip -e + ruff + pytest"
ogr_pip_base
ruff check "$HERE"
# Canlı (gerçek ağ) testleri işaretli ve varsayılan olarak atlanır; kabuktaki veritabanı adresi bu adıma sızmaz.
env -u OGRENMEN_DATABASE_URL python -m pytest "$HERE" -q

ogr_step "common: selftest (OGRENMEN_FAKES=1)"
OGRENMEN_FAKES=1 python -m ogrenmen_common.selftest

ogr_step "common: Runtime.from_env(dry_run) -> FakeLLM"
python -c "from ogrenmen_common.runtime import Runtime;r=Runtime.from_env(dry_run=True);assert r.llm.__class__.__name__=='FakeLLM'"
