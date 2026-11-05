@echo off
chcp 65001 >nul
rem Aurayi bu bilgisayarda acar (Windows). Cift tikla; ilk seferde birkac dakika surer.
rem Ayar dosyasi: bu klasore "aura-ayarlar.env" adiyla koy (ekipten gelen dosya).
cd /d "%~dp0"
echo == Aura baslatiliyor ==
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js kurulu degil. Acilan sayfadan LTS surumunu indirip kur, sonra bu dosyaya yeniden cift tikla.
  start "" "https://nodejs.org/tr/download"
  pause
  exit /b 1
)
node -e "process.exit(+process.versions.node.split('.')[0] < 22 ? 1 : 0)"
if errorlevel 1 (
  echo Node.js surumun eski. Acilan sayfadan LTS surumunu kur, sonra yeniden cift tikla.
  start "" "https://nodejs.org/tr/download"
  pause
  exit /b 1
)
if exist aura-ayarlar.env copy /Y aura-ayarlar.env .env.local >nul
if not exist .env.local (
  echo Ayar dosyasi bulunamadi. "aura-ayarlar.env" dosyasini bu klasore koy ve yeniden cift tikla.
  pause
  exit /b 1
)
echo == 1/3 Paketler kuruluyor (ilk seferde birkac dakika) ==
call npx --yes pnpm@10.28.0 install
if errorlevel 1 goto :hata
echo == 2/3 Uygulama derleniyor ==
call npx --yes pnpm@10.28.0 build
if errorlevel 1 goto :hata
echo == 3/3 Uygulama aciliyor: http://localhost:3000/baslangic/yas ==
echo Bu pencereyi test boyunca acik birak. Kapatmak icin pencereyi kapat.
start "" cmd /c "timeout /t 8 >nul & start http://localhost:3000/baslangic/yas"
call npx --yes pnpm@10.28.0 start
exit /b 0
:hata
echo Bir hata oldu. Bu pencerenin ekran goruntusunu gonder.
pause
exit /b 1
