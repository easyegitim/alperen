#!/usr/bin/env bash
# supabase/scripts/backup-public.sh — şifreli mantıksal yedek (BLUEPRINT §8.3, §12 #54). Kurucunun makinesinde,
# service_role/postgres bağlantısıyla (OGRENMEN_DATABASE_URL) çalışır; GitHub'da service_role YOKTUR.
#
#   varsayılan  public + audit şemaları, public.messages HARİÇ (ham sohbet yedeğe girmez), secure HARİÇ
#   --secure    yalnız secure şeması (kişisel veri ve cevap anahtarları; elle, kurucu makinesinde)
#
# Çıktı age ile şifrelenir: alıcı anahtarı BACKUP_AGE_PUBKEY (age1…) ya da --recipient. Şifresiz yedek yazılmaz.
# Kullanım: backup-public.sh [--secure] [--out dosya] [--recipient age1…]
# Geri yükleme: age -d -i anahtar.txt yedek.sql.age | psql "$HEDEF_URL" -v ON_ERROR_STOP=1
set -euo pipefail

MODE=public
OUT=""
RECIPIENT="${BACKUP_AGE_PUBKEY:-}"
while [ $# -gt 0 ]; do
  case "$1" in
    --secure) MODE=secure; shift ;;
    --out) OUT="${2:?--out dosya ister}"; shift 2 ;;
    --recipient) RECIPIENT="${2:?--recipient age1… ister}"; shift 2 ;;
    -h|--help) sed -n '2,13p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) echo "HATA: bilinmeyen seçenek $1" >&2; exit 2 ;;
  esac
done

: "${OGRENMEN_DATABASE_URL:?OGRENMEN_DATABASE_URL gerekli (service_role/postgres bağlantısı; yalnız kurucu makinesi)}"
for tool in pg_dump age; do
  command -v "$tool" >/dev/null 2>&1 || { echo "HATA: $tool yok" >&2; exit 1; }
done
if [ -z "$RECIPIENT" ]; then
  echo "HATA: age alıcı anahtarı yok (BACKUP_AGE_PUBKEY ya da --recipient); şifresiz yedek yazılmaz" >&2
  exit 1
fi

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT="${OUT:-ogrenmen-$MODE-$STAMP.sql.age}"

if [ "$MODE" = secure ]; then
  ARGS=(--schema=secure)
else
  ARGS=(--schema=public --schema=audit --exclude-table=public.messages --exclude-table-data=public.tg_updates)
fi

umask 077
pg_dump --dbname="$OGRENMEN_DATABASE_URL" --no-owner --no-privileges --format=plain "${ARGS[@]}" \
  | age -r "$RECIPIENT" -o "$OUT"
echo "yedek yazıldı: $OUT ($MODE; $(wc -c <"$OUT") bayt, age ile şifreli)"
