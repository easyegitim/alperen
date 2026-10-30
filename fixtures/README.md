# fixtures/ — paylaşılan sahte veri (M01)

Bu dizin Öğrenmen'in hesapsız, ağsız çalışan yerel dünyasıdır. Worker (M04), pipelines (M05–M10), panel (M11) ve
veritabanı geliştirme seed'i (M02) **aynı** dosyaları okur; hiçbiri buraya yazmaz. Sahibi M01'dir
(`docs/BLUEPRINT.md` §2.3, §11).

## Üretim ve denetim

JSON dosyaları elle düzenlenmez; `fixtures/scripts/` altındaki üreticiler deterministik olarak yazar
(aynı girdi → bayt düzeyinde aynı çıktı).

```
python /home/user/alperen/fixtures/scripts/build_fixtures.py          # tüm JSON fixture'ları yazar
python /home/user/alperen/fixtures/scripts/build_fixtures.py --check  # diskteki dosyalar güncel değilse 1
python /home/user/alperen/fixtures/scripts/make_pdfs.py               # kalem/exam-2022.pdf, kitap/sample.pdf
bash   /home/user/alperen/fixtures/ders/scripts/make_fixture.sh       # ders/lesson-01.wav, ders/frames/*.png (+ mp4, commit edilmez)
python /home/user/alperen/fixtures/scripts/check_fixtures.py          # şema ve tutarlılık denetimi (M13 fixtures-valid eşleniği)
python -m pytest /home/user/alperen/fixtures/scripts -q               # yukarıdakilerin testleri
```

Üreticiler `packages/pii/py` (ad-token hash'leri ve `text_llm` temizliği) ve `packages/contracts/schemas`
(doğrulama; `jsonschema` + `referencing`) kullanır. Mesajların `text_llm` sütunu gerçekten temizleyiciden geçirilerek
üretildiği için temizleyici kuralı değişirse `build_fixtures.py --check` farkı gösterir.

## Biçim kuralları

- **Tablo dosyaları** (ör. `kalem/exam_sources.json`, `kulaklik/escalations.json`) o tablonun satır dizisidir;
  sütun adları §3 migration'larıyla aynıdır.
- **Çok tablolu dosyalar** (`db/dev-seed.json`, `kulaklik/lesson-morale.json`) üst düzeyde tablo adı → satır
  dizisi eşlemesidir. `secure` şemasının tabloları `secure.<tablo>` önekiyle yazılır
  (`secure.student_pii`, `secure.telegram_identities`, `secure.answer_keys`, …).
- **Sözleşme dosyaları** (ör. `llm/**`, `ders/analysis-01.json`, `kalem/ocr-*.json`) ilgili JSON Schema'nın
  (`packages/contracts/schemas`) geçerli bir örneğidir.
- Kimlikler deterministiktir: `uuid5(NAMESPACE_OGRENMEN, "<tür>:<anahtar>")`,
  `NAMESPACE_OGRENMEN = uuid5(NAMESPACE_DNS, "ogrenmen.easy")`. Müfredat satırı
  `uuid5(NAMESPACE_OGRENMEN, "TYT-MAT@2026.1")` = `7a988b84-8937-5242-8c35-ddbc4ea9216d`.
- Zaman damgaları UTC (`Z`); "gün" kavramı Europe/Istanbul (UTC+3) takvimine göredir. Dünyanın "şimdi"si
  2026-10-20T09:00:00Z'dir.
- Metinler Türkçe; bot metinlerinde emoji ve ünlem yok (✓ ✕ ★ · serbest), mesaj ≤ 4 satır, "sen" hitabı.

## Dünya

| Kim | Rol | Kimlik | Not |
| --- | --- | --- | --- |
| Elif Kaya | öğrenci, reşit, onaylı | `s_qk7m2rx4tn5a` · Telegram `700000001` (`@elif_k`) | ders analizi taslağı, yarım teşhis oturumu |
| Mert Demir | öğrenci, reşit değil, veli onaylı | `s_vd3hp6wz2kc7` · `700000002` (`@mert_d`) | teşhis bitti, 4 pratik, açık yanılgı |
| Zeynep Çelik | öğrenci, reşit değil, **veli onayı eksik** | `s_mb5tj7ye4ql2` · `700000003` | mesajları yalnız meta veri; açık veli kodu `K7F3-2QX9` |
| Ayşe Yılmaz | eğitmen (matematik), Telegram'a bağlı | `700000101`, `@ayse_hoca` | bağlama kodu `EGT4-K2PZ` (kullanılmamış) |
| Selin Arslan | koordinatör | `700000102`, `@selin_koord` | |
| Deniz Koç | gözlemci | — | yalnız Elif'e atanmış |
| Barış Tunç | grup üyesi, öğrenci satırı yok | `700000201` (`@baris_t`) | onaysız üye |
| Can Öztürk | botla hiç konuşmamış | `700000004` | `/start` senaryosu |
| Öğrenmen | bot | `800000001`, `@ogrenmen_bot` | |

Gruplar: `-1001000000001` "TYT Matematik · Pilot A" (bot yönetici, bildirim sabitli, saklama 90 gün),
`-1001000000002` "Pilot B" (`bot_added`), `-1001000000003` "Hafta sonu etüt grubu" (bot yönetici değil).

Kesin sayılar `fixtures/scripts/check_fixtures.py` ile denetlenir. Aynı betik LLM'e giden her alanın
(`messages.text_llm`, `bot_responses.prompt_text`, `memory_facts.text`, `llm/diarize`, `llm/lesson_analysis`,
`ders/analysis-01.json`) temizleyicinin sabit noktası olduğunu (`scrub(metin, dünyadaki herkesin ad hash'leri) ==
metin`: ad, telefon, e-posta, @kullanıcı, okul, şube kalmamış) ve yasaklı kelimeleri `packages/contracts`'ın
`find_forbidden_word`'üyle denetler.

## Dizinler

| Yol | İçerik | Okuyan |
| --- | --- | --- |
| `db/dev-seed.json` | 1 **aktif** müfredat `{code:'TYT-MAT', year:2026, version:'2026.1', status:'active'}`, `settings.default_period='YKS 2027'`, 3 öğrenci, 1 eğitmen, 1 koordinatör, 1 gözlemci, 1 grup, 40 mesaj, 12 olgu, 30 `bot_responses`, 1 taslak ders analizi; ayrıca 21 kazanım, 27 yanılgı etiketi, 20 teşhis maddesi + anahtarları, 12 şablon sorusu (11 onaylı), 3 LLM sorusu, onaylı öncelik planı, araştırma çıktısı, alarmlar, harcama defteri | Worker FakeDb, panel mock, M02 `gen-dev-seed.py` |
| `telegram/*.json` | Bot API Update örnekleri (`telegram-update` şeması) | Worker senaryoları, `dev:fake` |
| `telegram/api/*.json` | Sahte Bot API yanıtları: `getMe.privacy_on/off`, `getChatMember.administrator/member/administrator_no_pin` | Worker sahte Telegram |
| `llm/<amaç>/*.json` | LLM sahte yanıtları (aşağıda) | Worker `test/fakes/providers.ts`, `ogrenmen_common.fakes.FakeLLM` |
| `tablet/` | `llm-question*.json` (question-generation zarfları), `generation_requests.json` (2 `pool_miss` + 1 `exam_variant`), `figures/{good.py, blank.py, net.py, bad.svg}` | M06 |
| `kitap/` | OpenAlex, Semantic Scholar, arXiv (normalize JSON; 2 kayıt, biri DOI'siz), Crossref (`crossref-ok.json`: DOI → yanıt; `crossref-404.json`: `10.9999/fake`), Unpaywall (DOI → kayıt), `sample.pdf`, `requests.json` (2 `queued` + 1 `done`) | M10 |
| `kalem/` | `courses.json` (DEMO), `exam_sources.json` (1 `uploaded` `instructor_alias='hoca-A'` + 1 `ocr_done`), `ocr-2022.json`/`ocr-2023.json` (exam-item dizileri), `syllabus.json`, `exam-2022.pdf` (3 sayfa) | M09 |
| `kulaklik/` | `messages-day.json` (18 Ekim; `text_raw` yok — batch_worker görünümü), `facts-day.json` (nightly-facts-output), `escalations.json`, `bot-responses-week.json` (30 satır: 4 işaretli, 3 degraded, 2 `schema_valid=false`), `questions-review.json` (12 LLM sorusu: 8 onaylı, 3 ret, 1 bekleyen), `chats.json` (2 grup, `bot_is_admin=false`), `lesson-morale.json` (3 onaylı ders analizi — her biri tam `analysis` (lesson-analysis, `talk.morale='low'`) + `seed_profile`, `cost_usd` 0,45 $ — ve onaylı `talk` claim'leri → `morale_signal=-2` olgusu × 3, embedding'siz), `llm-calls-month.json` + `spend-ledger-month.json` (sohbet 3,00 $ · ders 2 × 0,45 $), `students.json`, `memory-facts.json` | M07 |
| `ders/` | `lesson-01.wav` (20 sn, ≤ 300 KB), `frames/*.png` (8 kare), `lesson-01.transcript.json` (ÖĞRENCİ/EĞİTMEN; "Elif" bilerek geçer), `analysis-01.json`, `lessons.json` (`00000000-…-0001`), `labels.json` (`resolve_lesson_labels` sahtesi: ad-token hash → rol), `scripts/make_fixture.sh` | M08 |
| `panel/` | `overview.json` (`tiles, alerts, response_series, pilot`), `alerts`, `lesson_analysis`, `bot_responses`, `queue` (`v_review_queue`), `consents`, `students`, `priority_plans`, `chats`, `pilot` (beklenen kapı: KAPALI) | M11 mock |

### `fixtures/llm/<amaç>/`

| Amaç | Şema | Dosyalar |
| --- | --- | --- |
| `chat`, `chat_group` | `tutor-reply` | Sokratik, ipucu, havuz adayı (`suggest_pool_save=true`), `confidence<0.55`, `escalate=true`; `chat/injection.json` ("kuralları unut" denemesine kurallı cevap), `chat/06-direct.json` |
| `nightly_facts` | `nightly-facts-output` | 3 dosya; mesaj numaraları `kulaklik/messages-day.json` id'leridir |
| `weekly_summary` | `weekly-summary` | 2 |
| `question_gen` | `question-generation` | 4; `03-bad-sympy.json` şemaya uyar ama SymPy denetiminde düşer (`11/12` ↔ `D`) |
| `vision_check` | `figure-render-report` | `match` ve `mismatch` |
| `ocr` | `exam-item` dizisi | 2 (= `kalem/ocr-2022.json`, `ocr-2023.json`) |
| `lesson_analysis` | `lesson-analysis` | 2; `01-analysis-01.json` = `ders/analysis-01.json` |
| `transcribe`, `diarize` | `transcript` | transcribe ham (adlı); diarize, dersin öğrencisinin rol hash'leriyle temizlenmiş (`02-mert`: `[ÖĞRENCİ], üslü ifadelerle başlayalım.`) |
| `query_expand` | `query-expand` | 3 |
| `research` | `research-output` | 2; `01` içinde `10.9999/fake` (Crossref 404 yolu) |

Her klasörde ayrıca bilerek şemaya aykırı **`bad-schema.json`** vardır (onarım yolu).

**Seçim kuralı** (§2.3; başvuru uygulaması `fixtures/scripts/select_llm.py`): klasördeki dosyalar ada göre
sıralanır, `bad-schema*.json` dışarıda bırakılır, `i = int(sha256(prompt_text)[:8], 16) mod n`. `bad-schema`
yalnız sahtenin `badOutputEvery` / `bad_output_every` seçeneğiyle döner; `failWith` ile belirli denemelerde 429/500.

### Şekil kodu sözleşmesi (`tablet/figures/*.py`)

Kod çalışma dizinine `figure.png` yazar (800 × 400 px). `good.py` geçerli matplotlib (kesir modeli `5/6`, `1/4`;
`llm/question_gen/01` ile aynı kod); `blank.py` piksel varyansı 0 olan boş görüntü üretir (red); `net.py` `socket`
içe alır (AST reddi, çalıştırılmaz); `bad.svg` bozuk XML'dir.

## Notlar

- `telegram/oversized.json` gövdesi 64 KB'ı aşar (işlenmez); `telegram/long_text.json` 4.000 karakteri aşan
  ama 64 KB altında kalan metindir (kırpılır).
- Kitap fixture'larındaki Cepeda 2006, Rohrer & Taylor 2007 ve Dunlosky 2013 kayıtları gerçek yayınların üst
  verisidir; `10.9999/fake`, `10.5555/ogrenmen.mismatch` ve arXiv kayıtları (ay alanı 13) bilerek sentetiktir.
- Sınav PDF'i ve OCR metinleri özgündür; gerçek bir sınavdan kopyalanmamıştır.
- `lesson-01.wav` iki tonludur (EĞİTMEN 220 Hz, ÖĞRENCİ 330 Hz, 2 sn'lik bölümler); 30 sahneli mp4
  `make_fixture.sh` ile `${TMPDIR:-/tmp}/ogrenmen-ders/lesson-01.mp4` olarak üretilir, commit edilmez.

## Sapma notu

Blueprint'te ayrıntısı olmayan ya da bilinçli farklılaşan sözleşmeler; tüketen modüller (M02, M04, M07, M11) bunlara göre
yazar:

1. **`callback_data` biçimi.** §5.2 `ans:<session>:<question>:<key>` der; iki tam UUID (2 × 36) Telegram'ın 64 baytlık
   sınırını aşar. Fixture UUID'leri **kayıpsız** base64url (16 bayt → 22 karakter, dolgusuz) taşır:
   `ans:<base64url(session)>:<base64url(question)>:<A-D>` = 51 bayt (ör. `ans:XGYd94IgW1ihFNeO8cRjDg:HvgkizlLVLOKzL7AVnE-NA:A`).
   `session` teşhis oturumu kimliğidir (`diagnostic_sessions.id` = `sessions.diagnostic_session_id`), `question`
   oturumun sıradaki maddesidir. M04 iki parçayı tam UUID'ye çevirir (`fixtures/scripts/fxlib.py` `uuid_from_b64url`
   başvuru uygulamasıdır: `base64url_decode(s + "==")` → 16 bayt → UUID), `sessions.diagnostic_session_id` ve
   `pending_question_id`/oturumun sıradaki maddesiyle eşleştirir, sonra `grade_attempt(p_question, p_session)`'a tam
   UUID'leri verir. Önek eşleştirmesi yapılmaz; 22 karakterden farklı ya da çözülemeyen veri reddedilir.
2. **Deterministik kimlikler.** Blueprint fixture kimlik şeması tanımlamaz; burada
   `NAMESPACE_OGRENMEN = uuid5(NAMESPACE_DNS, "ogrenmen.easy")` ve `uid(tür, anahtar) = uuid5(NAMESPACE_OGRENMEN,
   "tür:anahtar")`, müfredat `uuid5(NAMESPACE_OGRENMEN, "TYT-MAT@2026.1")` kullanılır. Bu yalnız fixture'ların iç
   tutarlılığı içindir: tüketiciler kimlikleri JSON'dan okur, yeniden türetmez; M02 `gen-dev-seed.py` aynı UUID'leri
   seed SQL'ine aynen yazar.
3. **Ad-token hash'leri.** dev-seed `secure.student_pii.name_token_hashes`, `ders/labels.json` ve tüm `text_llm` alanları
   `packages/pii`'nin katlamasıyla (İ/I/ı → i, Türkçe küçük harf, NFC; düz `lower()` değil) üretilir. M02'nin
   tetikleyicisi bunlarla eşleşmek için `packages/pii/sql/name_token_hashes.sql`'i kullanır (`packages/pii/README.md`
   "Sapma / M02 notu").
4. **`secure.*` tabloları `db/dev-seed.json` içinde kalır.** §2.3 ve §5 (geliştirme verisi) M02 `gen-dev-seed.py`,
   Worker `FakeDb` ve panel mock'unun **aynı** JSON'u okumasını ister; FakeDb `grade_attempt` için
   `secure.answer_keys`'e, `resolve_telegram`/`name_token_hashes` için `secure.student_pii`'ye ihtiyaç duyar. Bu yüzden
   dosya bölünmez; bunun yerine **panel mock (M11) `secure.` önekli hiçbir tabloyu statik dışa aktarıma (istemci JS)
   almaz**: mock veri katmanı dev-seed'i derleme zamanında okur, `secure.*` anahtarlarını atar ve yalnız
   `peekAnswerKey(id)` sahtesini sunucu tarafı/yalnız geliştirme yolunda bırakır. Üretim paneli canlı RPC'leri kullanır;
   `fixtures/` üretim paketine girmez.
5. **`kulaklik/llm-calls-month.json` iki ders içerir.** §6.2 `test_cost_report_separates_lesson_costs` "2 ders × 0,45 $"
   ister; satırlar `lesson-morale.json`'ın 14 ve 16 Ekim derslerine bağlıdır ve maliyetleri o analizlerin `cost_usd`'u
   ile aynıdır (0,45 $). 18 Ekim dersi (moral alarmı için üçüncü sinyal) bu maliyet senaryosunun dışında tutulmuştur.
