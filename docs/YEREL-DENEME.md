# Yerelde deneme kılavuzu

Bu kılavuz, Öğrenmen'i kendi bilgisayarında açıp ürünün beş ana parçasını kendin denemen içindir. Kod bilmen gerekmez;
komutları olduğu gibi kopyalayıp terminale yapıştırırsın. Her adımda "ne görmelisin" ve "olmazsa ne yap" yazar.

Terminal nedir? macOS'ta Spotlight'ı (Cmd+Boşluk) aç, "Terminal" yaz. Windows'ta aşağıdaki WSL2 bölümüne bak.

## 1. Önkoşullar

Gerekenler: bun 1.4+, Node 22+, Python 3 + paketler (sympy, matplotlib, numpy; soru doğrulama ve şekiller), psql,
Docker Desktop (veritabanı; pgvector hazır gelir), Playwright Chromium (PDF raporları), ffmpeg (yalnız ders kaydı
yüklemek için), git. Aşağıda işletim sistemine göre kopyala-yapıştır blokları var; blokları sırayla, tek tek yapıştır.

### macOS

**a) Homebrew** (programları kurar). Terminale yapıştır, parolanı sor(ar)sa Mac'in giriş parolasını yaz (yazarken
görünmez, normaldir):

```
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

Kurulum bitince `brew`'u terminale tanıt (bunu yapmazsan sonraki her komut `command not found: brew` der).
Apple Silicon (M1/M2/M3/M4) Mac'te:

```
echo 'eval "$(/opt/homebrew/bin/brew shellenv)"' >> ~/.zprofile && eval "$(/opt/homebrew/bin/brew shellenv)"
```

Intel Mac'te aynısı, yalnız yol farklı:

```
echo 'eval "$(/usr/local/bin/brew shellenv)"' >> ~/.zprofile && eval "$(/usr/local/bin/brew shellenv)"
```

Hangisi olduğunu bilmiyorsan:  menü çubuğunda  > Bu Mac Hakkında > "Çip" Apple M… ise Apple Silicon'dur.

**b) Programlar** (tek satır; 5-15 dakika sürebilir):

```
brew install git oven-sh/bun/bun node python ffmpeg libpq && brew link --force libpq
```

**c) Python paketleri:**

```
python3 -m pip install --break-system-packages sympy matplotlib numpy
```

(`--break-system-packages` burada güvenlidir: paketleri Homebrew'un Python'ına kurar. `--user` ekleme; uygulama
Python'ı yalıtılmış kipte çalıştırdığı için `--user` ile kurulan paketleri görmez.)

**d) Docker Desktop:** https://www.docker.com/products/docker-desktop adresinden "Download for Mac" (çipine uygun
olanı) indir, kur, bir kez aç.

Hepsinden sonra terminali kapatıp yeniden aç.

### Windows (WSL2 + Ubuntu)

Her şey WSL2 içindeki Ubuntu'da çalışır.

1. PowerShell'i **yönetici olarak** aç (Başlat > "PowerShell" > sağ tık > Yönetici olarak çalıştır), yapıştır:
   `wsl --install -d Ubuntu`. Bilgisayarı yeniden başlat, Başlat menüsünden **Ubuntu**'yu aç, kullanıcı adı ve parola
   belirle.
2. Docker Desktop'ı kur (https://www.docker.com/products/docker-desktop), aç; Settings > Resources > WSL integration
   altında **Ubuntu**'yu aç, Apply.
3. Aşağıdaki blokları **Ubuntu penceresine** sırayla yapıştır (parola sorarsa Ubuntu parolanı yaz):

```
sudo apt update && sudo apt install -y unzip make git curl ffmpeg postgresql-client python3 python3-sympy python3-matplotlib python3-numpy
```

```
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt install -y nodejs
```

```
curl -fsSL https://bun.sh/install | bash
```

Sonra Ubuntu penceresini kapatıp yeniden aç (`bun` komutu ancak o zaman tanınır).

Tarayıcıyı Windows'ta normal aç: `http://localhost:3000` WSL'den Windows'a açılır. Projeyi Windows klasörlerinde
(`/mnt/c/...`) değil Ubuntu'nun ev dizininde (`~`) tut; yoksa çok yavaşlar.

### Linux (Ubuntu/Debian)

Windows bölümündeki 3. adımın üç bloğu aynen geçerli; Docker için Docker Engine (https://docs.docker.com/engine/install/)
ya da Docker Desktop kur.

**Hesaplar:** Claude için bir Anthropic API hesabı gerekir (adım 3). Ders kaydı yazıya dökme (Groq) ve anlamsal arama
(Voyage) isteğe bağlıdır; yoksa o parçalar örnek çıktıyla çalışır.

## 2. Kurulum, adım adım

**Adım 1. Depoyu indir ve dalı seç**

Depo özel (private) olduğu için GitHub'a önce tarayıcıyla bir kez giriş yap. macOS'ta:

```
brew install gh && gh auth login
```

Windows (Ubuntu) / Linux'ta:

```
sudo apt install -y gh && gh auth login
```

(`gh` paketi bulunamazsa: https://github.com/cli/cli/blob/trunk/docs/install_linux.md.) Sorulara Enter ile varsayılanı
seç (GitHub.com, HTTPS, "Login with a web browser"); ekranda çıkan 8 haneli kodu açılan sayfaya gir. Sonra:

```
gh repo clone easyegitim/alperen
cd alperen
git checkout claude/festive-feynman-qjnn4i
```

(Depo zaten indiriliyse yalnız `cd alperen`, `git pull` ve `git checkout` satırı yeter.) Komut satırı yerine GitHub
Desktop da olur: File > Clone repository > `easyegitim/alperen`, sonra üstteki "Current branch" menüsünden
`claude/festive-feynman-qjnn4i` dalını seç; terminalde o klasöre `cd` ile gir. `git clone` ile parola sorulursa
GitHub parolanı kabul etmez; yukarıdaki `gh auth login` yolunu kullan.

**Adım 2. Bağımlılıkları kur**

```
bun install
bunx playwright@1.56.1 install chromium
```

Windows (Ubuntu) / Linux'ta ikinci satırın yerine şunu yaz (Chromium'un ihtiyaç duyduğu sistem kütüphanelerini de kurar;
parola sorabilir):

```
bunx playwright@1.56.1 install --with-deps chromium
```

Görmelisin: uzun bir kurulum listesi ve sonunda hata olmadan dönen imleç. Olmazsa: `bun: command not found` ise
önkoşullar tablosundaki bun satırını yap, terminali kapatıp yeniden aç.

**Adım 3. Anahtarını yaz**

```
cp .env.local.example .env.local
```

Sonra `.env.local` dosyasını bir metin düzenleyiciyle aç (macOS: `open -e .env.local`) ve `ANTHROPIC_API_KEY=` satırının
sonuna anahtarını yapıştır. Tırnak ve boşluk olmasın.

Anahtarı almak: https://console.anthropic.com > API Keys > Create Key. Anahtar `sk-ant-` ile başlar ve bir kez gösterilir.
Aynı sitede Billing bölümünden kredi yükle ve **aylık harcama limiti** koy (öneri: ilk hafta için 20 $). Kredi
yoksa istekler hata verir (aşağıda "Sık hatalar").

> **Anahtarı sohbete, e-postaya, ekran görüntüsüne ya da GitHub'a koyma.** `.env.local` git'e girmez; öyle kalsın.
> Anahtar sızarsa Console'dan silip yenisini oluştur.

**Adım 4. Veritabanını aç**

Docker Desktop'ı aç (menü çubuğunda balina simgesi çıkana kadar bekle), sonra:

```
make local-db
```

Görmelisin: `Container ... Healthy`. Olmazsa: `Cannot connect to the Docker daemon` Docker Desktop'ın açık olmadığını
söyler; aç, 30 saniye bekle, tekrar dene. `port is already allocated` ise bilgisayarında başka bir Postgres 5432'yi
tutuyordur; onu kapat ya da `.env.local` içinde `OGRENMEN_DATABASE_URL` ile onun adresini ver.

**Adım 5. Kontrol et**

```
bun run doctor
```

Görmelisin: satır satır `✓`. `✕` zorunlu eksiktir ve altında ne yapacağın yazar; düzeltip tekrar çalıştır. `!`
uyarıdır (ffmpeg, Chromium, Groq, Voyage gibi isteğe bağlı şeyler), açmana engel olmaz. Son satır "her şey hazır" ya da
"hazır" demeli. Doctor anahtarını yazdırmaz; yalnız uzunluğunu söyler ve Anthropic'e küçük bir istek atıp geçerli mi diye bakar.

**Adım 6. Uygulamayı aç**

```
bun run local
```

İlk açılış birkaç dakika sürer (veritabanı kurulur, müfredat yüklenir, web derlenir). Bittiğinde bir tablo çıkar:
adres, giriş kodu, hesaplar, gerçek/sahte Claude durumu. Bu pencereyi **açık bırak**; kapatmak için Ctrl+C.
Veritabanın ve yüklediklerin kapatınca silinmez. Açılışta anahtarın Anthropic'e sorulur: reddedilirse (yanlış ya da
silinmiş anahtar) açılış durur ve ne yapacağını yazar; kredi sorunu varsa yalnız uyarır.

**Adım 7. Tarayıcıda aç**

http://localhost:3000 adresine git. Giriş sayfasında e-posta yaz, kod olarak her hesap için **246810** gir. Sayfadaki
"Yerel deneme" düğmeleri e-postayı senin yerine doldurur.

| Hesap | E-posta | Nereye düşer |
|---|---|---|
| Öğrenci (Elif, 11. sınıf, TYT 2027) | `ogrenci@ogrenmen.local` | Bugün / Koç / Gelişim |
| Veli | `veli@ogrenmen.local` | /veli |
| Eğitmen (yönetici) | `egitmen@ogrenmen.local` | /egitmen |

## 3. Test senaryoları

Hepsini önce öğrenci hesabıyla dene (senaryo F hariç). Her adımı tamamlayınca "Görmelisin" satırıyla karşılaştır.

### A. Bugün: soru çöz ve sonucu gör

1. **Yap:** Öğrenci olarak gir. Bugün sekmesindeki kartta **Başla**'ya bas, soruları çöz (en az 3 soru).
2. **Görmelisin:** Sorular tek tek gelir; bitirince tek cümlelik bir sonuç yazısı çıkar. **Detay**'a basınca hangi
   konuda ne durumda olduğun görünür.
3. **Olmazsa:** Kart "hazırlanıyor" diye bekliyorsa 1-2 dakika bekle (arka plan işi). Hâlâ yoksa terminal penceresine
   bak, kırmızı hata satırı var mı; yoksa `.dev-local/logs/worker.log` dosyasının son satırlarını geri bildirime ekle.

### B. Koç sohbeti

1. **Yap:** Koç sekmesini aç. Örnek mesajlardan birine bas ya da yaz: "Rasyonel sayılarda neden takılıyorum?" Üstteki
   mod seçiciyi dene (hızlı cevap ve derin açıklama seçenekleri).
2. **Görmelisin:** Cevap harf harf akar, Türkçe ve kısa. Derin modda daha uzun, adım adım çözüm gelir.
3. **Olmazsa:** Cevap hiç gelmiyorsa en sık sebep anahtar ya da kredidir; "Sık hatalar"a bak.

### C. Yükle > Kendi çalışmam (el yazısı çözüm teşhisi)

1. **Yap:** Bir soruyu kâğıda kendi el yazınla çöz, fotoğrafını çek. Yükle > **Kendi çalışmam** > fotoğrafı seç.
   Bilgisayarında kamera yoksa fotoğrafı telefondan bilgisayara gönder (AirDrop, e-posta, Drive) ve dosya seçiciyle yükle.
2. **Görmelisin:** Yaklaşık 30 saniye içinde teşhis: çözümün hangi adımında hata var, hatanın türü ve ne çalışman gerektiği.
3. **Olmazsa:** Fotoğraf bulanık ya da çok karanlıksa "okunamadı" der; düz ışıkta, kâğıt tam kadrajda yeniden çek.

**Telefondan doğrudan açmak (kamera için) şu an desteklenmiyor:** uygulama yalnız bu bilgisayarın içinden (127.0.0.1)
erişilebilir olarak açılır, ağdaki telefon `http://<bilgisayar-ip>:3000` adresine ulaşamaz. Bunun için kurulum
betiğinin web'i ağa açması gerekir; bu henüz yapılmadı. O zamana kadar fotoğrafı bilgisayara aktar.

### D. Yükle > Okul denemesi ve uygulama içi deneme

Okul denemesi:

1. **Yap:** Yükle > **Okul denemesi**. Soru kitapçığının sayfalarını ve doldurduğun optik formun fotoğraflarını ekle,
   sihirbazın adımlarını izle.
2. **Görmelisin:** Sayfalar tanınır, cevaplar okunur, tek cümlelik sonuç ve konu ısı haritası çıkar; "Rapor" düğmesiyle
   PDF rapor iner.
3. **Olmazsa:** Cevap anahtarı yoksa sistem anahtarı kendisi çıkarmaya çalışır; bu daha uzun sürer (birkaç dakika).
   PDF inmiyorsa Chromium kurulu değildir (adım 2'deki `bunx playwright@1.56.1 install ...` satırı).

Uygulama içi deneme:

1. **Yap:** Koç'a yaz: "10 soruluk deneme hazırla".
2. **Görmelisin:** Birkaç dakika içinde Bugün sekmesinde bir deneme kartı belirir. **Çöz**'e bas, süreli sınav ekranı açılır.
3. **Olmazsa:** Kart gelmiyorsa 3-5 dakika bekle (üretim ve SymPy doğrulaması sürer); sonra terminal ve `worker.log`'a bak.

### E. Not üretimi

1. **Yap:** Koç'a yaz: "Rasyonel sayılar için not hazırla".
2. **Görmelisin:** Birkaç dakika sonra Bugün'de "belge hazır" kartı; açınca PDF görüntülenir, içinde şekiller (sayı doğrusu
   vb.) ve örnek sorular vardır.
3. **Olmazsa:** PDF boşsa ya da inmiyorsa Chromium'u kur; şekiller yoksa Python paketlerini kontrol et (`bun run doctor`).

### F. Veli ve eğitmen

Veli (`veli@ogrenmen.local`):

1. **Yap:** Giriş yap; **Özet**'e bak, **Sohbet**'te "Elif bu hafta nasıl gitti?" diye sor, **Rapor iste**'ye bas.
2. **Görmelisin:** Özet ekranı Elif'in durumunu sade dille anlatır; sohbet kısa cevap verir; rapor birkaç dakikada hazır olur.
3. **Olmazsa:** Elif hiç soru çözmediyse özet boş görünür; önce senaryo A'yı yap.

Eğitmen (`egitmen@ogrenmen.local`):

1. **Yap:** Giriş yap, /egitmen sayfasında müfredatlar, soru tarzları, dersler ve içerik kuyruğunu gez.
2. **Görmelisin:** TYT Matematik müfredatı dolu; tarzlar ve ders listeleri boş olabilir; içerik kuyruğunda
   senaryo D/E'de ürettiklerin inceleme bekliyor görünebilir.
3. **Olmazsa:** Sayfa yetki hatası veriyorsa e-postayı `egitmen@ogrenmen.local` yazdığından emin ol.

## 4. Tahmini maliyet

Gerçek anahtarla her işlem Anthropic hesabından küçük bir tutar harcar (PLAN-v2 §5 tahminleri; dolar):

| İşlem | Yaklaşık maliyet |
|---|---|
| Koç sohbeti, bir cevap | 0,01-0,02 |
| Koç derin açıklama / tam çözüm | 0,06-0,10 |
| Çözüm teşhisi (senaryo C) | 0,08-0,14 |
| Okul denemesi: sayfa başına okuma | ~0,01 (+ soru teşhisi ~0,08 + rapor ~0,06) |
| Not üretimi (senaryo E) | 0,35-0,60 |
| Uygulama içi deneme, 40 soru | 1,5-2,5 (10 soruluk yaklaşık dörtte biri) |
| Veli sohbeti / rapor | 0,006 / 0,05-0,10 |
| Ders analizi, 90 dk (Groq yazıya dökme ayrıca 0,06) | 0,5-0,9 |

Hepsini bir kez denemek kabaca 5-10 $ tutar. Harcamayı Console > Usage sayfasından izle. Sahte kipte (`OGRENMEN_LLM=fake bun run local`)
hiç harcanmaz ama cevaplar örnek metindir.

## 5. Sıfırla, durdur, günlükler

| Ne | Komut |
|---|---|
| Kapat | Terminal penceresinde Ctrl+C (veriler durur) |
| Tekrar aç | `bun run local` |
| Her şeyi sil, baştan kur | `bun run local:reset` (yerel veritabanını ve yüklenen dosyaları siler; anahtarına dokunmaz) |
| Veritabanını durdur | `docker compose stop` |
| Veritabanını da tamamen sil | `docker compose down -v` |

> **Güvenlik:** giriş kodu herkes için `246810`. Uygulamayı ngrok, port yönlendirme, "Tailscale Funnel" gibi araçlarla
> internete ya da ağa **açma**; yalnız bu bilgisayarda (`localhost`) kullan. Yerel köprü başka sitelerden gelen
> tarayıcı isteklerini reddeder, ama portu dışarı açarsan kodu bilen herkes girer ve anahtarınla harcama yapar.

Günlükler `.dev-local/logs/` klasöründe: `web.log`, `worker.log`, `ders.log` ve `kopru.log`. Hata olduğunda ilgili dosyanın son
30 satırını geri bildirime ekle.

## 6. Sık hatalar

| Gördüğün | Anlamı | Ne yap |
|---|---|---|
| `ANTHROPIC_API_KEY bulunamadı` | `.env.local` yok ya da boş | Adım 3 |
| Doctor, `bun run local` ya da koç `401` / "anahtar reddetti" | Anahtar yanlış kopyalanmış ya da silinmiş | Console'dan yeni anahtar oluştur, `.env.local`'a yapıştır, `bun run local`'ı yeniden başlat |
| `credit balance is too low` / `402` | Hesapta kredi yok | Console > Billing > kredi yükle |
| `429` | Çok sık istek | 1-2 dakika bekle |
| "pgvector uzantısı yok" | Docker dışı bir Postgres kullanılıyor | `make local-db` ile Docker'daki Postgres'i kullan |
| `Postgres'e bağlanılamadı` | Docker kapalı | Docker Desktop'ı aç, `make local-db` |
| `port(lar) kullanımda: 3000` | Başka program ya da eski bir `bun run local` açık | O pencerede Ctrl+C; olmazsa `lsof -i :3000` ile bul, kapat |
| PDF üretilemedi / Chromium bulunamadı | Tarayıcı motoru kurulu değil | macOS: `bunx playwright@1.56.1 install chromium`; Ubuntu/WSL: `bunx playwright@1.56.1 install --with-deps chromium` |
| Ders yüklenmiyor | ffmpeg yok | `brew install ffmpeg` (Linux: `sudo apt install ffmpeg`) |
| `python3: ModuleNotFoundError` / "Python paketleri eksik" | Python paketi eksik ya da `--user` ile kurulmuş | macOS: `python3 -m pip install --break-system-packages sympy matplotlib numpy`; Ubuntu/WSL: `sudo apt install -y python3-sympy python3-matplotlib python3-numpy` |
| `command not found: brew` | Homebrew kuruldu ama terminale tanıtılmadı | Önkoşullar > macOS > a) bölümündeki `echo 'eval ...'` satırı |
| `node bulunamadı` / `Node.js 18 kurulu` | Node eski ya da PATH'te değil | macOS: `brew install node`; Ubuntu/WSL: önkoşullardaki nodesource satırı; sonra terminali kapatıp aç |
| `unzip is required to install bun` | Ubuntu'da unzip yok | `sudo apt install -y unzip`, sonra bun satırını tekrarla |
| Sayfa açılıyor ama giriş kodu reddediliyor | Eski bir sekme | Sayfayı yenile, kodu `246810` yaz |

Takıldığında önce `bun run doctor`, sonra `bun run local:reset` dene.

## 7. Geri bildirim nasıl verilir

Her bulgu için şu üçünü yaz:

1. **Ekran görüntüsü** (varsa terminaldeki hata satırı da).
2. **Ne yaptın:** hangi senaryo, hangi adım.
3. **Ne bekliyordun, ne oldu.**

Anahtarın görünen bir ekran görüntüsü paylaşma. Küçük, tek konulu notlar (bir mesajda bir bulgu) en kolay işlenir.
