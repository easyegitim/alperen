#!/bin/bash
# Aura'yı bu bilgisayarda açar (Mac). Çift tıkla; ilk seferde birkaç dakika sürer.
# Ayar dosyası: bu klasöre "aura-ayarlar.env" adıyla koy (ekipten gelen dosya).
cd "$(dirname "$0")" || exit 1
echo "== Aura başlatılıyor =="

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js kurulu değil. Açılan sayfadan LTS sürümünü indirip kur, sonra bu dosyaya yeniden çift tıkla."
  command -v open >/dev/null 2>&1 && open "https://nodejs.org/tr/download"
  read -r -p "Kapatmak için Enter'a bas..." _; exit 1
fi
NODE_MAJOR=$(node -p "process.versions.node.split('.')[0]")
if [ "$NODE_MAJOR" -lt 22 ]; then
  echo "Node.js sürümün eski (v$NODE_MAJOR). Açılan sayfadan LTS sürümünü kur, sonra yeniden çift tıkla."
  command -v open >/dev/null 2>&1 && open "https://nodejs.org/tr/download"
  read -r -p "Kapatmak için Enter'a bas..." _; exit 1
fi

# Ayar dosyasını bulur (bu klasörde ya da İndirilenler'de, "(1)" ya da ".txt" eki olsa da) ve test girişini açar.
if ! node scripts/aura-launcher.mjs env; then
  read -r -p "Kapatmak için Enter'a bas..." _; exit 1
fi

PNPM="npx --yes pnpm@10.28.0"
echo "== 1/3 Paketler kuruluyor (ilk seferde birkaç dakika) =="
$PNPM install || { read -r -p "Kurulum hatası. Ekran görüntüsünü gönder. Enter..." _; exit 1; }
echo "== 2/3 Uygulama derleniyor =="
$PNPM build || { read -r -p "Derleme hatası. Ekran görüntüsünü gönder. Enter..." _; exit 1; }
# Eski bir Aura penceresi 3000'i tutuyorsa sıradaki boş portu kullanır.
PORT=$(node scripts/aura-launcher.mjs port) || { read -r -p "Kapatmak için Enter'a bas..." _; exit 1; }
URL="http://localhost:$PORT/baslangic/yas"
echo "== 3/3 Uygulama açılıyor: $URL =="
echo "Bu pencereyi test boyunca açık bırak. Kapatmak için pencereyi kapat."
( sleep 6; command -v open >/dev/null 2>&1 && open "$URL" ) &
$PNPM start -p "$PORT"
