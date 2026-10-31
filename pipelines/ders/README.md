# pipelines/ders — `ogrenmen_ders` (M08)

Birebir ders kaydının analizi (BLUEPRINT §6.3): kayıttan ses ve 20–40 slayt karesi çıkarılır, ses isimsiz ve
konuşmacı etiketli (ÖĞRENCİ/EĞİTMEN) transkripte çevrilir, öğrencinin mevcut profiliyle birlikte güçlü modele verilir
ve çıkan rapor eğitmen onayına **taslak** olarak yazılır. Gözlem (`observations`) bu paket tarafından hiçbir zaman
yazılmaz; rapor ancak panelde `approve_lesson_analysis` ile onaylanınca profile işlenir. Ham video Storage'a girmez,
kurucunun makinesinde 30 gün durur ve `purge` ile silinir.

## Kurulum ve kabul

Önce ortak paketler (`pipelines/common` README'si): `ogrenmen-contracts`, `ogrenmen-mastery`, `ogrenmen-pii`,
`ogrenmen-common` aynı ortama `pip install -e` ile kurulmuş olmalıdır. Sistemde `ffmpeg` ve `ffprobe` gerekir (yoksa
video testleri `SKIP` olur, ders analizi `OGR-DERS-004` verir). Dış Python bağımlılığı yoktur.

```
python -m pip install -e /home/user/alperen/pipelines/ders[dev] && ruff check /home/user/alperen/pipelines/ders && python -m pytest /home/user/alperen/pipelines/ders -q
python -m ogrenmen_ders analyze --lesson 00000000-0000-0000-0000-000000000001 --video /home/user/alperen/fixtures/ders/lesson-01.wav --dry-run --fixtures /home/user/alperen/fixtures/ders --out /tmp/ders-out && test -f /tmp/ders-out/lesson_analyses.jsonl && test -f /tmp/ders-out/lesson_claims.jsonl && ! test -f /tmp/ders-out/observations.jsonl && ! grep -q Elif /tmp/ders-out/api_payload.json
```

Canlı veritabanı varsa (`OGRENMEN_DATABASE_URL`, süper kullanıcı) `tests/test_live_db.py` geçici bir veritabanına
`supabase/scripts/db-test.sh --dev` ile tüm migration'ları ve seed'leri kurar, boru hattının yaptığı her çağrıyı
`batch_worker` rolüyle gerçek SQL'e karşı koşar (tek işlem, geri alınır, veritabanı silinir); yoksa `SKIP`.

## Komutlar

```
python -m ogrenmen_ders register --student-ref s_… --staff-id <uuid> --held-at 2026-10-20T18:00 --duration 90 --video <yol> [--video-dir <dizin>]
python -m ogrenmen_ders analyze --lesson <uuid> --video <yol> [--transcriber chain|whispercpp] [--force]
python -m ogrenmen_ders transcribe-only --lesson <uuid> --video <yol>
python -m ogrenmen_ders frames-only --video <yol> [--lesson <uuid>]
python -m ogrenmen_ders purge --older-than 30d --video-dir $OGRENMEN_VIDEO_DIR [--confirm-missing]
```

Ortak bayraklar (`ogrenmen_common.cli_base`): `--dry-run --fixtures --out --limit --since --student-ref --adapters`.
`--dry-run` ağa çıkmaz; sahte veritabanı `fixtures/db/dev-seed.json` + `--fixtures` dizini (ör. `fixtures/ders`:
`lessons.json`, `labels.json`), sahte model `fixtures/llm/<amaç>/` ile kurulur; çıktılar `--out`'a yazılır.
`SUPABASE_URL`/`SUPABASE_BATCH_JWT` yoksa gerçek çalışma da `--dry-run`'a düşer ve uyarı yazar (§2.9).

* **`register`** — `register_lesson` RPC'si (`public_ref → aktif kayıt`; personel `public.staff.id`). Yeni dersin
  uuid'si stdout'a **tek satır** yazılır (diğer her şey stderr), böylece `make ders` çıktıyı `analyze --lesson`'a
  zincirler. `--held-at` saat dilimi taşımıyorsa Europe/Istanbul yerel saatidir (UTC'ye çevrilir). Video **yüklenmez**:
  `lessons.video_ref` = `local:<--video-dir'e göreli yol>` ya da `drive:<kimlik>`. Yerel dosya için `--video-dir`
  (varsayılan `$OGRENMEN_VIDEO_DIR`) zorunludur ve dosya o dizinin **içinde** olmalıdır; mutlak yol hiçbir zaman
  kaydedilmez (`OGR-DERS-007`), çünkü klasör adları çoğu zaman öğrencinin adıdır ve `public.lessons`, RPC kaydı ve
  denetim satırı düz ad taşırdı (ilke 8). Kayıttan sonra yol `resolve_lesson_labels` hash'leriyle taranır; ad tokenı
  varsa stderr'e uyarı düşer. **Adlandırma kuralı:** video dizininde dosya ve klasör adı yalnız tarih ve ders numarası
  taşır (`2026-10/2026-10-20-ders-01.mp4`), öğrenci ya da eğitmen adı taşımaz. `make ders` bu yüzden
  `OGRENMEN_VIDEO_DIR`'in tanımlı olmasını bekler.
* **`analyze`** — adımlar aşağıda. stdout'a analiz uuid'si, stderr'e özet (`AnalyzeResult`). Ders `processing`,
  `approved` ya da `corrected` durumundaysa `--force` olmadan reddedilir (`OGR-DERS-007`): eşzamanlı ikinci çalışma ve
  onaylı raporun geri düşmesi engellenir. Başarılı çalışma aynı dersin açık `Ders analizi başarısız` alarmını kapatır
  (`status='done'`, `resolved_at`).
* **`transcribe-only`** — yalnız adım 1 ve 3: isimsiz transkript `transcripts/<id>.jsonl`'e ve `lessons.transcript_path`.
* **`frames-only`** — yalnız adım 2: kareler `<out>/frames/frame-NN.jpg`, özet `<out>/frames.json` (`--out` yoksa
  `./out`); `--lesson` verilirse `lessons.frames_count` güncellenir.
* **`purge`** — `held_at < şimdi − older_than ∧ video_deleted_at is null ∧ video_ref dolu` dersler: ham video
  silinir, `confirm_video_deleted` RPC'si `video_deleted_at`'i yazar ve öğrenciye + veliye `video_deleted` bildirimini
  kuyruğa alır. `--video-dir` (varsayılan `$OGRENMEN_VIDEO_DIR`) zorunludur; dizin yoksa ya da dizin değilse (disk
  bağlı değil, yazım hatası) komut hiçbir şey yapmadan reddedilir (`OGR-DERS-001`). Yalnız bu dizinin **içindeki**
  dosyalar silinir; yol oraya çözülmüyorsa (eski mutlak kayıt, `../`) dokunulmaz ve onaylanmaz; `drive:` kayıtları
  elle silinir. Dosya dizinde **yoksa** (`missing`) onaylanmaz ve bildirim gitmez: video başka bir yerde duruyor
  olabilir ve aileye "kayıt silindi" demek yanlış bir KVKK beyanı olur. Kurucu dosyayı elle sildiyse
  `--confirm-missing` ile onaylanır. Rapor `<out>/purge_report.json` (`deleted`, `would_delete`, `missing`,
  `skipped_drive`, `skipped_outside_video_dir`, `error`).

## `analyze` adımları (§6.3)

1. `ffmpeg -i video -vn -ac 1 -ar 16000 -c:a pcm_s16le` → geçici çalışma dizininde `ders.wav`.
2. Sahne kareleri: tek çözme geçişinde her karenin `lavfi.scene_score`'u okunur, eşik kuralı saf Python'dadır —
   `> 0.30` ile 20–40 kare; 40'tan çoksa `0.45`, 20'den azsa `0.20`, hâlâ azsa eşit aralıklı (en çok 30, saniyede
   en çok bir); kurala sığmayan uçlarda en yüksek puanlı 40 kare (zaman sırasıyla). Seçilen anlar `-ss` ile JPEG
   (≤ 1280 px) çıkarılır. Video akışı yoksa (ör. `.wav`) kare yoktur; **dry-run'da** bu durumda `--fixtures/frames/`
   kareleri kullanılır.
3. Transkript: `transcribe` zinciri (`models.json`; Gemini ses doğrudan ve konuşmacı etiketli, yedek Whisper
   etiketsiz → `diarize` zinciri 2 dakikalık pencerelerde etiketler) ya da `--transcriber whispercpp`
   (`WHISPER_CPP_BIN` + `WHISPER_CPP_MODEL`; yerel, maliyetsiz, ardından `diarize`). Adlar `resolve_lesson_labels(lesson)`
   RPC'sinin ad-token **hash'leriyle** temizlenir (düz ad hiç alınmaz): öğrenci adı `[ÖĞRENCİ]`, eğitmen adı
   `[EĞİTMEN]`, kalan "hocam X" `[AD]`. Whisper metni `diarize`'a temizlendikten sonra gider. Her bölüm
   `transcript#/$defs/segment`'ten geçer ve Storage `transcripts/<id>.jsonl`'e (satır başına bir bölüm) yazılır.
4. `seed_profile`: `profile_for_prompt(enrollment)` (bant; yüzde ve p yok) + açık yanılgılar (`id`, `text_instructor`)
   + bir önceki dersin analizindeki `next_step.for_instructor`; serbest metinler hash'lerle bir kez daha temizlenir.
5. `lesson_analysis` zinciri, `lesson-analysis` şeması. Girdi: transkript + ≤ 40 kare + seed profili + müfredatın
   yaprak kazanımları (model yalnız bu id'leri kullanabilir) + yanılgı etiketi kataloğu. Doğrulama: şema + her
   `skill_id` listede + etiket katalogda ya da `null` + `previous_profile_check` yalnız seed'deki açık yanılgılar +
   her alıntı (`evidence[].quote`, `questions/hesitations[].quote`) transkriptte aynen geçer (büyük/küçük harf, boşluk
   ve `…` kısaltması gözetilmez) + her zaman damgası ders süresinin içinde + modelin yazdığı serbest metinlerde
   (`text_instructor`, `text_student`, `commitments[].text`, `talk.notes`, `next_step`) yasak kelime
   (`tahmin/çıkacak/kesin/garanti`, ilke 10) ve ad tokenı yok (alıntılar öğrencinin sözüdür, yasak kelime
   taramasına girmez); olmazsa
   aynı modelde **bir** onarım, sonra zincirdeki sıradaki model; hiçbiri olmazsa ders `failed` + koordinatöre
   `instructor_alerts(kind='ops', 'Ders analizi başarısız: <neden>', ref={lesson_id})`.
6. `write_lesson_analysis` RPC → `lesson_analyses(draft)` + `lesson_claims(pending)` (tek `talk` iddiası dahil) +
   `instructor_alerts(ops, 'Ders raporu onay bekliyor')`. `observations` yazılmaz.
7. Çalışma dizini (ses ve kareler) her durumda silinir; video 30 gün sonra `purge`.

**Ad temizliği kapalı başarısızdır.** `resolve_lesson_labels` dersin öğrencisi için hiç `ÖĞRENCİ` hash'i döndürmezse
(`secure.student_pii.display_name` boş ya da `name_token_hashes='{}'`; yalnız `EĞİTMEN` satırları da bu sayılır)
temizlik doğrulanamaz: transkript dahil **hiçbir** model çağrısı yapılmaz, ders `failed` olur, alarm açılır
(`OGR-DERS-003`). Aynı kural whisper yolunda `diarize`'dan önce de uygulanır.

**Son kemer:** `CostLedger.call` süresince defterin LLM adaptörü bir vekille sarılır; sağlayıcıya giden **her** istek —
onarım turu (`REPAIR_NOTE` + hata listesi) ve zincirdeki yedek model denemeleri dahil — gönderilmeden hemen önce hash
listesine karşı taranır, ad tokenı varsa gönderilmez (`OGR-DERS-003`), ve `<out>/api_payload.json`'a gönderildiği
hâliyle yazılır (amaç, model, sistem metni, istem, ek adı/türü/boyu; ses dosyası sağlayıcıya nötr `ders.wav` adıyla
gider; gönderilmeyen istek, ör. tavan engeli, kayda girmez). Onarım istemine giren doğrulama hataları önce ad
hash'leriyle temizlenir. Son analiz `write_lesson_analysis`'ten önce bir kez daha taranır.

**Kareler temizlenmez.** Slayt kareleri görüntüdür, metin temizliği onlara uygulanamaz. Görüntülü görüşme
kayıtlarında katılımcı ad kutucukları karede görünür; model oradan okuduğu adı yazarsa doğrulama onarım ister ve son
kemer kaydı engeller, ama görüntünün kendisi sağlayıcıya gider. Kurucu kayıtta ad kutucuklarını gizler (görüşme
uygulamasında "adları gizle" / yalnız ekran paylaşımını kaydetme).

## Maliyet ve bütçe

`transcribe`, `diarize`, `lesson_analysis` çağrılarının hepsi `CostLedger.call`'dan geçer (`llm_calls`,
`ref_table='lessons'`, `ref_id=<ders>`, `student_ref=s_…`). Bu amaçlar `runtime_flags.cap_excluded_purposes`'tadır:
kapı `check_spend(<amaç>)`'ın **ders bütçesidir** (`lesson_month_usd < lesson_monthly_cap_usd`), sohbet/toplu tavanını
doldurmaz ve ondan etkilenmez (`test_lesson_cost_does_not_consume_chat_cap`; ders tavanı aşılınca yalnız analiz durur:
`test_lesson_cap_blocks_only_lesson_analysis`). `lesson_analyses.cost_usd` dersin toplam maliyetidir (transkript +
diarize + analiz); `analysis.model_notes.cost_usd` yalnız analiz çağrısınındır. Dry-run'da `cost_estimate.json`
`lesson_usd` ve `chat_batch_usd`'yi ayrı yazar.

## Çıktılar (`--out`)

`lessons.jsonl`, `lesson_analyses.jsonl`, `lesson_claims.jsonl`, `llm_calls.jsonl`, `spend_ledger.jsonl`,
`instructor_alerts.jsonl` (açıldıysa), `proactive_messages.jsonl` (purge), `rpc_calls.jsonl`, `audit.events.jsonl`
(JsonlDb; yalnız bu çalışmada yazılan satırlar), `storage/transcripts/<id>.jsonl`, `api_payload.json`,
`lesson_analysis.json` (doğrulanmış son analiz), `ders_result.json`, `transcript.json` (transcribe-only),
`frames/` + `frames.json` (frames-only), `purge_report.json`, `cost_estimate.json`.

## Hata kodları

RPC hataları veritabanından aynen gelir (`OGR-LESSON-002`, `OGR-AUTH-002`, `OGR-CURR-001` …); model kapısı
`OGR-LLM-001/002` (`ogrenmen_common`). Bu pakete özgü: `OGR-DERS-001` girdi dosyası yok, `OGR-DERS-002` ders/kayıt
yok, `OGR-DERS-003` ad temizliği doğrulanamadı (öğrenci ad hash'i yok ya da metinde ad tokenı var; istek
gönderilmedi), `OGR-DERS-004` ffmpeg/ffprobe yok, başarısız ya da zaman aşımı, `OGR-DERS-005` analiz ders bağlamına
uymuyor, `OGR-DERS-006` whisper.cpp yapılandırması/çalışması/zaman aşımı, `OGR-DERS-007` geçersiz komut girdisi
(`--video-dir` eksik ya da video dışında, korunan durumda `--force` yok). Başka her beklenmeyen hata da dersi `failed`
yapar ve `Ders analizi başarısız: beklenmeyen hata` alarmını açar; özgün hata yeniden yükselir. CLI hatayı tek satır
Türkçe yazar ve 1 ile çıkar.

## Sapma notları

1. **Kare seçimi tek geçiş.** Blueprint'teki `select='gt(scene,T)',showinfo -vsync vfr` her eşik denemesinde videoyu
   yeniden çözerdi; burada puanlar bir kez okunur, eşik kuralı aynıdır ve seçilen kareler aynıdır. Kurala sığmayan
   uç durumlar (0.45 hâlâ > 40; 0.30 > 40 ama 0.45 < 20) en yüksek puanlı 40 kareyle kapatılır.
2. **Boru hattının yazdığı alanlar.** `lesson_ref`, `student_ref`, `duration_min` ve `model_notes` (model, istem
   sürümü `lesson_analysis.v1`, maliyet, token, kare sayısı) modelden alınmaz; ders kaydından ve defterden yazılır
   (model kendi maliyetini bilemez, kimlik alanı uydurulamaz).
3. **`previous_profile_check` kapsamı zorunlu değil.** Modelden her açık yanılgı için satır istenir, ama satırı
   olmayan yanılgı hata sayılmaz; yalnız seed'de olmayan bir yanılgıya satır yazmak hatadır.
4. **`purge --dry-run`** dosyaya dokunmaz; dizinde bulunan dosyalar için sahte veritabanında `confirm_video_deleted`
   zinciri (bildirim kuyruğu) yine sınanır, rapor `would_delete` yazar. Dizinde bulunmayan dosya hiçbir kipte
   `--confirm-missing` olmadan onaylanmaz (`missing`, `confirmed=false`, bildirim yok).
5. **Sahte model dosya ipucu.** Dry-run'da sahte LLM'in dosyası video adından seçilir (`lesson-01` → transkript
   `01-lesson-01.json`, analiz `01-analysis-01.json`; diğer adlarda gövdenin kendisi, ör. `mert`); ipucu sağlayıcıya
   gitmez, gerçek sağlayıcılar yok sayar. Eşleşme yoksa §2.3 hash kuralı geçerlidir.
6. **whisper.cpp** isteğe bağlıdır (`--transcriber whispercpp`); varsayılan `models.json` `transcribe` zinciridir
   (§12 #23).
7. `register`'ın öğrenci bayrağı ortak `--student-ref` bayrağıdır (biçimi `s_…` olarak ortak katmanda denetlenir).
8. **Yerel video `--video-dir` ister.** Blueprint komutu (`register … --video <yol>`) değişmedi; yerel dosya için
   `$OGRENMEN_VIDEO_DIR` (blueprint'in ham video yeri) ya da `--video-dir` tanımlı olmalı ve yalnız göreli yol yazılır.
9. **Ek bayraklar:** `analyze --force` (korunan durumdaki dersi yeniden analiz) ve `purge --confirm-missing` (elle
   silinmiş dosyayı onayla). İkisi de varsayılan olarak kapalıdır; blueprint komutları onlarsız çalışır.
10. **`previous_next_step` yalnız onaylı analizden.** Blueprint "önceki analizin `next_step.for_instructor`" der;
    burada yalnız `approved`/`corrected` analiz kullanılır (taslak, eğitmenin görmediği model metnidir; güven kuralı:
    onaysız ders raporu kullanılmaz).

## Kabul komutu notu

İki kabul komutu yazıldığı gibi, herhangi bir çalışma dizininden 0 ile çıkar; uyarlama gerekmedi.
