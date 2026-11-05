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
rem Ayar dosyasini bulur (bu klasorde ya da Indirilenler'de, "(1)" ya da ".txt" eki olsa da) ve test girisini acar.
node scripts\aura-launcher.mjs env
if errorlevel 1 (
  pause
  exit /b 1
)
echo == 1/3 Paketler kuruluyor (ilk seferde birkac dakika) ==
call npx --yes pnpm@10.28.0 install
if errorlevel 1 goto :hata
echo == 2/3 Uygulama derleniyor ==
call npx --yes pnpm@10.28.0 build
if errorlevel 1 goto :hata
rem Eski bir Aura penceresi 3000'i tutuyorsa siradaki bos portu kullanir.
set "PORT="
for /f "delims=" %%P in ('node scripts\aura-launcher.mjs port') do set "PORT=%%P"
if not defined PORT (
  pause
  exit /b 1
)
echo == 3/3 Uygulama aciliyor: http://localhost:%PORT%/baslangic/yas ==
echo Bu pencereyi test boyunca acik birak. Kapatmak icin pencereyi kapat.
start "" cmd /c "timeout /t 8 >nul & start http://localhost:%PORT%/baslangic/yas"
call npx --yes pnpm@10.28.0 start -p %PORT%
exit /b 0
:hata
echo Bir hata oldu. Bu pencerenin ekran goruntusunu gonder.
pause
exit /b 1
