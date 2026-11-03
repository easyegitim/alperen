#!/usr/bin/env bash
# scripts/secret-scan.sh — depodaki izlenen ve izlenmeye aday (yok sayılmayan) dosyalarda gerçek görünümlü anahtar
# taraması (gitleaks işinin hesapsız, ikilisiz eşdeğeri; docs/PLAN-v2.md §12; README "Kabul komutu notu").
#
#   bash scripts/secret-scan.sh [--root <depo>]
#
# Çıkış: 0 = bulgu yok; 1 = bulgu var (dosya:satır ve desen adı yazılır, değerin kendisi maskelenir); 2 = kullanım ya da
# git/grep hatası. Desenler değerin biçimine bakar (önek + yeterli uzunluk); "AIza|gsk_" gibi düzenli ifade metinleri
# belgelerdeki ad geçişleri eşleşmez. .gitignore'daki dosyalar (.dev.vars, node_modules, derleme çıktıları) taranmaz.
# v2 sırları (Resend, Voyage, Fly, VAPID özel anahtarı; docs/PLAN-v2.md §12) da aynı biçim kuralıyla taranır.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
while [ $# -gt 0 ]; do
  case "$1" in
    --root) ROOT="$(cd "${2:?--root dizin ister}" && pwd)"; shift 2 ;;
    -h|--help) sed -n '2,10p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "HATA: bilinmeyen seçenek $1" >&2; exit 2 ;;
  esac
done

# ad|ERE deseni
PATTERNS=(
  "google-api-key|AIza[0-9A-Za-z_-]{35}"
  "groq-key|gsk_[0-9A-Za-z]{20,}"
  "openrouter-key|sk-or-v1-[0-9a-f]{32,}"
  "openai-anthropic-key|sk-(proj-|ant-)[0-9A-Za-z_-]{20,}"
  "jwt|eyJhbGciOi[A-Za-z0-9_-]*\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{10,}"
  "supabase-secret-key|sb_secret_[0-9A-Za-z_-]{10,}"
  "telegram-bot-token|[0-9]{8,10}:AA[0-9A-Za-z_-]{33}"
  "private-key|-----BEGIN ([A-Z]+ )?PRIVATE KEY-----"
  "resend-key|(^|[^0-9A-Za-z_])re_[0-9A-Za-z]{8}_[0-9A-Za-z]{16,}"
  "voyage-key|(^|[^0-9A-Za-z_-])pa-[0-9A-Za-z_-]{40,}"
  "fly-token|FlyV1 fm[12][a-z]?_[0-9A-Za-z_+/=-]{20,}"
  "vapid-private-key|VAPID_PRIVATE_KEY[[:space:]]*[=:][[:space:]]*[\"']?[0-9A-Za-z_-]{40,}"
)

git -C "$ROOT" rev-parse --is-inside-work-tree >/dev/null 2>&1 || { echo "HATA: $ROOT bir git çalışma ağacı değil" >&2; exit 2; }

found=0
for p in "${PATTERNS[@]}"; do
  name="${p%%|*}"
  re="${p#*|}"
  # git grep --untracked: izlenen + yok sayılmayan izlenmemiş dosyalar; -I ikili dosyaları atlar.
  # Çıkış 0 = eşleşme, 1 = yok, diğerleri = hata.
  hits="$(git -C "$ROOT" grep -nIE --untracked -e "$re" -- . 2>&1)"
  rc=$?
  [ "$rc" -eq 1 ] && continue
  if [ "$rc" -ne 0 ]; then echo "HATA: tarama başarısız ($name, çıkış $rc): $hits" >&2; exit 2; fi
  while IFS= read -r line; do
    echo "BULGU  $name  $(cut -d: -f1-2 <<<"$line")"   # değer yazılmaz
    found=$((found + 1))
  done <<<"$hits"
done

if [ "$found" -gt 0 ]; then
  echo "Sır taraması: $found bulgu. Değeri depodan çıkar, anahtarı döndür (docs/runbook/kurucu.md §4)."
  exit 1
fi
echo "Sır taraması: bulgu yok (${#PATTERNS[@]} desen; izlenen ve yok sayılmayan dosyalar)."
exit 0
