#!/usr/bin/env bash
# packages/pii/check.sh — PII temizleyici: TS ve Python aynı cases.json vakalarını aynı çıktıyla geçmeli.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
# shellcheck source=../../scripts/lib.sh
source "$ROOT/scripts/lib.sh"
ogr_tmpdir

ogr_step "pii (TS): typecheck + test"
# packages/pii/ts kök çalışma alanının üyesi değildir (packages/* yalnız doğrudan alt dizinleri kapsar); kendi kurulumu var.
flock /tmp/ogrenmen-bun.lock bun install --cwd "$HERE/ts" >/dev/null
bun run --cwd "$HERE/ts" typecheck
bun run --cwd "$HERE/ts" test

ogr_step "pii (Python): ruff + pytest"
ogr_pip -e "$HERE/py[dev]"
ruff check "$HERE/py"
python -m pytest "$HERE/py" -q

ogr_step "pii TS ↔ Python dump farkı yok"
bun run --cwd "$HERE/ts" dump > "$WORK/pii-ts.json"
python -m ogrenmen_pii.dump > "$WORK/pii-py.json"
diff "$WORK/pii-ts.json" "$WORK/pii-py.json"
