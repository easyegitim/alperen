#!/usr/bin/env bash
# pipelines/ders/check.sh — ders medya servisi (P5): ruff + pytest (kare kuralı, /prepare, /stt sahte + Groq taklidi +
# 25 MB parçalama, Storage kipi, yol/yetki denetimleri, `python3 -I` tek dosya açılışı) + komut satırı kabulü.
# Uçtan uca hat (register_lesson → lesson.* işleri → done) apps/worker canlı testindedir (lessons.live.test.ts).
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
# shellcheck source=../../scripts/lib.sh
source "$ROOT/scripts/lib.sh"
ogr_tmpdir

ogr_step "ders: pip -e + ruff + pytest"
ogr_pip -e "$HERE[dev]"
ruff check "$HERE"
python -m pytest "$HERE" -q

if command -v ffmpeg >/dev/null && command -v ffprobe >/dev/null; then
  ogr_step "ders: frames-only + stt (sahte) komut satırı kabulü (10 sn sessiz video)"
  ffmpeg -nostdin -v error -y -f lavfi -i "testsrc2=s=640x360:r=10:d=10" -f lavfi -i "anullsrc=r=16000:cl=mono" \
    -t 10 -c:v libx264 -preset veryfast -c:a aac -shortest "$WORK/ders.mp4"
  OGRENMEN_DERS_WORK_DIR="$WORK/kok" python3 -I -m ogrenmen_ders frames-only --video "$WORK/ders.mp4" --out "$WORK/out"
  test -f "$WORK/out/audio.wav"
  test -f "$WORK/out/prepare.json"
  ls "$WORK"/out/frames/frame-01.jpg >/dev/null
  OGRENMEN_DERS_WORK_DIR="$WORK/kok" OGRENMEN_STT=fake python3 -I -m ogrenmen_ders stt --wav "$WORK/out/audio.wav" \
    > "$WORK/stt.json"
  grep -q '"provider": "fake"' "$WORK/stt.json"
  ogr_absent '"speaker"' "$WORK/stt.json"
else
  ogr_skip "ders: komut satırı kabulü (ffmpeg/ffprobe yok)"
fi
