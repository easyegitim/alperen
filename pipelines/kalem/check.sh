#!/usr/bin/env bash
# pipelines/kalem/check.sh — Kalem (çıkmış soru OCR ve sıklık analizi): ruff + pytest + dry-run kabul komutu.
# Canlı Postgres testleri v2 tabanında devre dışıdır (bkz. dosya sonu).
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
# shellcheck source=../../scripts/lib.sh
source "$ROOT/scripts/lib.sh"
ogr_tmpdir

ogr_step "kalem: pip -e + ruff + pytest"
ogr_pip_base -e "$HERE[dev]"
ruff check "$HERE"
env -u OGRENMEN_DATABASE_URL python -m pytest "$HERE" -q

ogr_step "kalem plan --dry-run (öncelik planı: OCR metni ve tahmin dili yok)"
python -m ogrenmen_kalem plan --course DEMO --period 2026 --dry-run --fixtures "$ROOT/fixtures/kalem" --out "$WORK/kalem-out"
python3 -c "import json,sys;p=json.loads(open(sys.argv[1]).readline())['plan'];assert p['title']=='Sıklık analizine göre öncelikler' and p['rows'];s=json.dumps(p,ensure_ascii=False).lower();assert 'ocr_text' not in s and 'tahmin' not in s and 'çıkacak' not in s" \
  "$WORK/kalem-out/exam_priority_plans.jsonl"

# Canlı veritabanı testleri (tests/test_live_db.py) v1 şemasına (batch_worker rolü, v1 RPC'ler) yazıldı; v2 tabanında
# (rol yok, RPC'ler değişti) çalışamaz. kalem v2 servisine (P3 doğrulama / P5 ders) taşınınca yenisi yazılır.
ogr_skip "kalem canlı testi (v1 şemasına yazılmış; v2 tabanında devre dışı, P3/P5)"
