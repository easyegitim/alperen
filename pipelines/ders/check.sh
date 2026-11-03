#!/usr/bin/env bash
# pipelines/ders/check.sh — Ders analizi (kayıt -> transkript -> rapor): ruff + pytest + dry-run kabul komutu.
# OGRENMEN_LIVE=1: ek olarak gerçek Postgres'e karşı canlı test (tests/test_live_db.py; ffmpeg ister).
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
# shellcheck source=../../scripts/lib.sh
source "$ROOT/scripts/lib.sh"
ogr_tmpdir

ogr_step "ders: pip -e + ruff + pytest"
ogr_pip_base -e "$HERE[dev]"
ruff check "$HERE"
env -u OGRENMEN_DATABASE_URL python -m pytest "$HERE" -q

ogr_step "ders analyze --dry-run (taslak rapor + iddialar; observations yok, api_payload'da ad yok)"
python -m ogrenmen_ders analyze --lesson 00000000-0000-0000-0000-000000000001 \
  --video "$ROOT/fixtures/ders/lesson-01.wav" --dry-run --fixtures "$ROOT/fixtures/ders" --out "$WORK/ders-out"
test -f "$WORK/ders-out/lesson_analyses.jsonl"
test -f "$WORK/ders-out/lesson_claims.jsonl"
ogr_no_file "$WORK/ders-out/observations.jsonl"
test -f "$WORK/ders-out/api_payload.json"
ogr_absent Elif "$WORK/ders-out/api_payload.json"

if ogr_is_live; then
  ogr_step "ders: canlı veritabanı testi"
  ogr_live_env
  ogr_live_pytest "$HERE" -q -k live
else
  ogr_skip "ders canlı testi (OGRENMEN_LIVE=1 değil)"
fi
