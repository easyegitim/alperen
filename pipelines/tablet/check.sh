#!/usr/bin/env bash
# pipelines/tablet/check.sh — Tablet (soru üretimi, şablonlar, ders notu): ruff + pytest + dry-run kabul komutları.
# Canlı Postgres testleri v2 tabanında devre dışıdır (bkz. dosya sonu).
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
# shellcheck source=../../scripts/lib.sh
source "$ROOT/scripts/lib.sh"
ogr_tmpdir

ogr_step "tablet: pip -e + ruff + pytest"
ogr_pip_base -e "$HERE[dev]"
ruff check "$HERE"
env -u OGRENMEN_DATABASE_URL python -m pytest "$HERE" -q

ogr_step "tablet generate --dry-run (correct_option yok)"
python -m ogrenmen_tablet generate --skill tyt.mat.temel.rasyonel-sayilar --count 2 --dry-run \
  --fixtures "$ROOT/fixtures/tablet" --out "$WORK/tablet-out"
test -f "$WORK/tablet-out/cost_estimate.json"
test -f "$WORK/tablet-out/questions.jsonl"
ogr_absent correct_option "$WORK/tablet-out/questions.jsonl"

ogr_step "tablet template (PNG şekiller)"
python -m ogrenmen_tablet template --id kesir-modeli-toplama --count 5 --seed 7 --out "$WORK/tablet-out2"
ls "$WORK"/tablet-out2/figures/*.png >/dev/null
test -f "$WORK/tablet-out2/questions.jsonl"
ogr_absent correct_option "$WORK/tablet-out2/questions.jsonl"

ogr_step "tablet template --fill --dry-run (LLM kaynağı yok)"
python -m ogrenmen_tablet template --fill --min-stock 30 --dry-run --fixtures "$ROOT/fixtures/tablet" --out "$WORK/tablet-fill"
grep -q register_template_question "$WORK/tablet-fill/rpc_calls.jsonl"
test -f "$WORK/tablet-fill/questions.jsonl"
ogr_absent '"source": "llm"' "$WORK/tablet-fill/questions.jsonl"
test -f "$WORK/tablet-fill/template_fill.json"

# Canlı veritabanı testleri (tests/test_live_db.py) v1 şemasına (batch_worker rolü, v1 RPC'ler) yazıldı; v2 tabanında
# (rol yok, RPC'ler değişti) çalışamaz. tablet v2 servisine (P3 doğrulama / P5 ders) taşınınca yenisi yazılır.
ogr_skip "tablet canlı testleri (v1 şemasına yazılmış; v2 tabanında devre dışı, P3/P5)"
