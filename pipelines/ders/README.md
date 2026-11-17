# pipelines/ders — ders medya servisi (`ogrenmen_ders`, P5)

Ders videosu hattının (docs/PLAN-v2.md §9) medya yarısı: kayıttan **ses** (`ffmpeg -vn -ac 1 -ar 16000`, 16 bit PCM
WAV) ve **sahne kareleri** (≤ 30 JPEG, iki kenar da ≤ 1280 px) çıkarır, sesi **Groq Whisper large-v3-turbo** ile metne çevirir. Geri
kalanı apps/worker `lesson.*` işlerindedir (konuşmacı etiketleme, ad temizliği, Opus analizi, iddiaların uygulanması;
`apps/worker/README.md` "Ders hattı"). Claude ses almaz; servis veritabanına yazmaz.

Paket **yalnız standart kitaplığı** kullanır ve `service.py` paketin geri kalanını içe aktarmaz: worker imajında
`python3 -I pipelines/ders/src/ogrenmen_ders/service.py --port 8711` ile (yalıtılmış kip, PYTHONPATH yok) tek dosya
olarak çalışır (fly.toml `ders` süreç grubu, `--host ::` Fly 6PN için). Sistemde `ffmpeg` ve `ffprobe` gerekir.

## Uç noktalar (`service.py`)

| uç | gövde | yanıt |
|---|---|---|
| `GET /healthz` | — | `{ok, ffmpeg, stt: groq\|fake\|none, storage, work_dir}` |
| `POST /prepare` | `{lesson_id, local_path? \| storage_path?, bucket? ('lessons'), dest_prefix?, max_frames? (≤ 30)}` | `{duration_sec, has_video, has_audio, method, audio: {path, bytes, storage_path?}, frames: [{path, t_sec, t, score, bytes, storage_path?}], stored}` |
| `POST /stt` | `{lesson_id, wav_path? \| storage_path?, bucket?, language? ('tr'), fixture?}` | `{provider: groq\|fake, language, duration_sec, chunks, segments: [{t0, t1, text}]}` (saniye, konuşmacısız) |
| `POST /cleanup` | `{lesson_id}` | `{lesson_id, removed}` |

* **Çalışma kökü** `OGRENMEN_DERS_WORK_DIR` (varsayılan `$TMPDIR/ogrenmen-ders`); ders başına `<kök>/<ders>/`.
  `local_path`/`wav_path` köke göreli olmalıdır (mutlak yol, `..` ve kök dışı `OGR-DERS-007`). 24 saatten eski ders
  dizinleri açılışta silinir; worker iş sonunda `/cleanup` çağırır.
* **Storage kipi**: `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` varsa (supabase-py gerekmez; REST
  `/storage/v1/object/<kova>/<yol>`) `storage_path` kaynağı akışla indirilir ve çıktılar `dest_prefix` altına yüklenir
  (`stored: true`; 5 GB'lık video worker belleğine girmez). Yoksa servis yerel yollar döner; worker aynı makinede
  onları okuyup Storage'a yükler.
* **Kareler**: tek çözme geçişinde her karenin `lavfi.scene_score`'u okunur; eşik kuralı saf Python'dadır
  (`choose_timestamps`): `> 0.30` ile 20–30 kare; fazlaysa `0.45` (yine fazlaysa en yüksek puanlı 30, zaman sırasıyla),
  azsa `0.20`; o da azsa eşit aralıklı en çok 30 (saniyede en çok bir). Seçilen anlar `-ss` ile JPEG olarak alınır.
  Video akışı yoksa (ses kaydı) kare yoktur. Ses akışı yoksa `OGR-DERS-001` ("kayıtta ses akışı yok").
* **STT**: `GROQ_API_KEY` varsa Groq (`GROQ_BASE_URL`, `GROQ_STT_MODEL` ezer; `verbose_json`, `language`,
  `temperature 0`; ses sağlayıcıya nötr `ders.wav` adıyla gider). 25 MB sınırı için WAV `OGRENMEN_STT_CHUNK_SEC`
  (varsayılan 600 sn ≈ 19 MB; en çok ~ 786 sn) parçalara bölünür (`-f segment -c copy`), bölüm zamanları parça
  süresiyle kaydırılır. 429/5xx üç deneme (`retry-after`), diğer 4xx kalıcı. `OGRENMEN_STT=fake` ağsızdır:
  `fixtures/ders/lesson-01.transcript.json` (ya da `fixture`/`OGRENMEN_STT_FIXTURE`; `OGRENMEN_STT_FIXTURES` dizini)
  bölümleri konuşmacısız döner. İkisi de yoksa `OGR-DERS-008` (üretimde sessizce sahteye düşülmez).
* **Yetki**: `OGRENMEN_DERS_TOKEN` (ya da worker'la paylaşılan `LESSON_SERVICE_TOKEN`) tanımlıysa POST istekleri
  `Authorization: Bearer <belirteç>` taşır (`OGR-DERS-010`). Sağlık ucu açıktır (Fly denetimi). Loopback dışı bir
  adreste (`--host ::`, Fly 6PN) belirteç yoksa servis açılmaz (çıkış 78). İstekteki `bucket` yalnız `lessons`
  olabilir (servis service_role taşır; diğer kovalar `OGR-DERS-007`).
* Aynı ders için istekler sıraya girer (ders başına kilit); farklı dersler eşzamanlı işlenir.

Hata gövdesi `{error, message}`: `OGR-DERS-001` girdi yok/okunamıyor (404/422), `-004` ffmpeg/ffprobe yok ya da
başarısız, `-007` geçersiz istek (400), `-008` STT yapılandırılmamış (503) ya da sağlayıcı başarısız (502), `-009`
Storage (424), `-010` yetkisiz (401). Worker 4xx'i kalıcı sayar (ders failed + neden), 5xx ve bağlantı hatasını yeniden
dener.

## Komut satırı

```
python -m ogrenmen_ders serve [--host 127.0.0.1] [--port 8711]
python -m ogrenmen_ders frames-only --video <yol> --out <dizin>     # <dizin>/audio.wav, frames/, prepare.json
python -m ogrenmen_ders stt --wav <yol> [--fixture ad.json]          # stdout JSON (Groq ya da OGRENMEN_STT=fake)
```

## Kurulum ve kabul

```
python -m pip install -e /home/user/alperen/pipelines/ders[dev] && ruff check /home/user/alperen/pipelines/ders && python -m pytest /home/user/alperen/pipelines/ders -q
bash /home/user/alperen/pipelines/ders/check.sh
```

Testler (`tests/test_service.py`, `tests/test_static.py`): eşik kuralı, `/prepare` (10 sn sessiz video → WAV 16 kHz mono
+ eşit aralıklı kareler; sahneli video → 20–30 kare, deterministik; 1920 px → 1280 px, dikey 2160×3840 → 720×1280; ses kaydı → kare yok), yol ve
kimlik retleri, Storage kipi (sahte Supabase Storage: indirme, yükleme, `x-upsert`, servis anahtarı), belirteç,
`/stt` sahte (deterministik, konuşmacısız), Groq taklidi (çok parçalı form, 429 → yeniden deneme, 401 kalıcı),
parçalama ve zaman kaydırma, temizlik, komut satırı, `python3 -I service.py` tek dosya açılışı; statik: yalnız
standart kitaplık, veritabanı erişimi yok, model adı tek sabit. Uçtan uca hat (register_lesson → `lesson.*` → done)
`apps/worker/test/lessons.live.test.ts`'tedir (gerçek servis süreci + gerçek pg-boss + geçici veritabanı).

## v1'den v2'ye

v1 `ogrenmen_ders` (BLUEPRINT §6.3) kurucunun makinesinde çalışan bir CLI boru hattıydı (`register`, `analyze`,
`transcribe-only`, `purge`; Gemini zinciri, `batch_worker` rolü, v1 RPC'leri). v2 tabanında `register_lesson` ve
`write_lesson_analysis` farklı imzayla yeniden doğdu (supabase 0040) ve v1 çağrıları RPC paritesini düşürüyordu; v1
orkestrasyonu, analizi ve testleri kaldırıldı (git geçmişinde). Korunan ve taşınan: ffmpeg ses/kare kuralı (bu
servis), Groq Whisper isteği (`ogrenmen_common.adapters.groq` ile aynı biçim; stdlib), ad temizliği ilkesi (kapalı
başarısızlık, son kemer → worker `src/lessons/names.ts`), alıntı ve süre denetimi (→ worker `src/lessons/analysis.ts`).
Ham video artık Storage'dadır ve `lessons.retain_until` (90 gün) sonunda `lesson.retention` işi siler; çıkarılan ses
STT'den hemen sonra silinir.
