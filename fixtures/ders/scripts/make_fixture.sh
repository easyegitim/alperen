#!/usr/bin/env bash
# Ders fixture'larını ffmpeg ile deterministik üretir (hesap ve ağ gerekmez).
#
#   bash fixtures/ders/scripts/make_fixture.sh [--video-dir <dizin>]
#
# Üretilenler:
#   fixtures/ders/lesson-01.wav        20 sn sentetik ders sesi (mono, 7 kHz, 16 bit; ≤ 300 KB) — COMMIT EDİLİR
#                                      2 saniyede bir değişen iki ton: EĞİTMEN 220 Hz, ÖĞRENCİ 330 Hz
#                                      (lesson-01.transcript.json bölümleriyle aynı sıra)
#   fixtures/ders/frames/frame-0N.png  8 kare (testsrc2, 320x180)            — COMMIT EDİLİR
#   <video-dir>/lesson-01.mp4          20 sn, 30 sahneli test videosu (testsrc2 + düz renk sahneleri + ses)
#                                      — COMMIT EDİLMEZ; varsayılan ${TMPDIR:-/tmp}/ogrenmen-ders
#
# Çıktılar bit düzeyinde tekrarlanabilir olsun diye -fflags +bitexact / -flags +bitexact kullanılır.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DERS="$(cd "$HERE/.." && pwd)"
VIDEO_DIR="${TMPDIR:-/tmp}/ogrenmen-ders"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --video-dir) VIDEO_DIR="$2"; shift 2 ;;
    -h|--help) sed -n '2,16p' "$0"; exit 0 ;;
    *) echo "Bilinmeyen seçenek: $1" >&2; exit 2 ;;
  esac
done

command -v ffmpeg >/dev/null || { echo "ffmpeg bulunamadı" >&2; exit 1; }

# 2 sn'lik bölümler: çift bölümler EĞİTMEN (220 Hz), tek bölümler ÖĞRENCİ (330 Hz); bölüm sınırında kısa sessizlik.
TONE="0.25*sin(2*PI*(220+110*mod(floor(t/2),2))*t)*gt(mod(t,2),0.08)"

ffmpeg -nostdin -v error -y -f lavfi -i "aevalsrc='${TONE}':s=7000:d=20" \
  -ac 1 -c:a pcm_s16le -fflags +bitexact -flags +bitexact -map_metadata -1 "$DERS/lesson-01.wav"

mkdir -p "$DERS/frames"
rm -f "$DERS"/frames/frame-*.png
ffmpeg -nostdin -v error -y -f lavfi -i "testsrc2=s=320x180:r=1:d=8" \
  -frames:v 8 -fflags +bitexact -flags +bitexact -map_metadata -1 "$DERS/frames/frame-%02d.png"

# 30 sahne × 2/3 sn: testsrc2 ile birbirinden çok farklı düz renkler sırayla (sahne eşiği 0.30'u aşar).
mkdir -p "$VIDEO_DIR"
COLORS=(red blue yellow green white black magenta cyan orange purple)
inputs=()
filters=""
for i in $(seq 0 29); do
  if (( i % 2 == 0 )); then
    inputs+=(-f lavfi -t 0.6667 -i "testsrc2=s=640x360:r=15")
  else
    c="${COLORS[$(( (i / 2) % ${#COLORS[@]} ))]}"
    inputs+=(-f lavfi -t 0.6667 -i "color=c=${c}:s=640x360:r=15")
  fi
  filters+="[${i}:v]setsar=1[v${i}];"
done
concat=""
for i in $(seq 0 29); do concat+="[v${i}]"; done
filters+="${concat}concat=n=30:v=1:a=0,format=yuv420p[v]"
ffmpeg -nostdin -v error -y "${inputs[@]}" -f lavfi -i "aevalsrc='${TONE}':s=16000:d=20" \
  -filter_complex "$filters" -map "[v]" -map 30:a -c:v libx264 -preset veryfast -crf 30 -c:a aac -shortest \
  "$VIDEO_DIR/lesson-01.mp4"

wav_bytes=$(wc -c < "$DERS/lesson-01.wav")
if (( wav_bytes > 300 * 1024 )); then
  echo "lesson-01.wav ${wav_bytes} bayt; 300 KB sınırı aşıldı" >&2
  exit 1
fi
echo "lesson-01.wav: ${wav_bytes} bayt · kareler: $(ls "$DERS"/frames/frame-*.png | wc -l) · video: $VIDEO_DIR/lesson-01.mp4"
