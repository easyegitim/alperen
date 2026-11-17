# pipelines/kalem — `ogrenmen_kalem` (M09)

Kalem, eğitmen arşivindeki eski sınavları **sıklık analizine göre öncelik planına** çevirir: PDF → sayfa
görüntüsü → OCR (`ocr` zinciri) → madde (`exam_items`) → gömme ve kümeleme (`exam_clusters`) → izlence
hizalaması (`syllabus_topics`) → plan (`exam_priority_plans`, eğitmen onayına düşer). Onaylı plandan Tablet'e
yalnız **meta** taşıyan varyant istekleri yazar (`generation_requests`). Ayrıca çeldirici motorunun iki analiz
raporunu üretir (`distractor-report`, `prerequisite-audit`). BLUEPRINT §6.4.

Plan bir tahmin değildir: başlık sabittir ("Sıklık analizine göre öncelikler"), "tahmin / çıkacak / kesin /
garanti" kelimeleri sözleşme (`x-forbidden-words`) ve testle reddedilir, plan ham soru metni taşımaz.

## Kurulum ve kabul

```
python -m pip install -e /home/user/alperen/pipelines/kalem[dev] && ruff check /home/user/alperen/pipelines/kalem && python -m pytest /home/user/alperen/pipelines/kalem -q
python -m ogrenmen_kalem plan --course DEMO --period 2026 --dry-run --fixtures /home/user/alperen/fixtures/kalem --out /tmp/kalem-out && python3 -c "import json;p=json.loads(open('/tmp/kalem-out/exam_priority_plans.jsonl').readline())['plan'];assert p['title']=='Sıklık analizine göre öncelikler' and p['rows'];s=json.dumps(p,ensure_ascii=False).lower();assert 'ocr_text' not in s and 'tahmin' not in s and 'çıkacak' not in s"
```

Önce yerel paketler kurulu olmalıdır (`packages/contracts/python`, `packages/mastery-math/python`,
`packages/pii/py`, `pipelines/common`; bkz. `pipelines/common/README.md`). Dış bağımlılıklar sabit sürümlüdür:
`pypdfium2` (PDF → sayfa), `pillow` (PNG kodlama), `numpy`. `scikit-learn` isteğe bağlıdır
(`pip install -e …/pipelines/kalem[sklearn]`); yoksa kümeleme saf numpy ile yapılır.

Canlı veritabanı testi: `OGRENMEN_DATABASE_URL` tanımlıysa `tests/test_live_db.py` geçici bir veritabanı
(`ogrenmen_kalem_live_<pid>`, sonunda silinir) açar, migration + seed + `seed/dev` uygular ve Kalem'in yazdığı her
satırı `set role batch_worker` altında gerçek şemaya yeniden oynatır (sütun, tür, check/FK, tetikleyici, RLS ve
sütun yetkisi birlikte). Yoksa atlanır.

## Komutlar

Hepsi `python -m ogrenmen_kalem <komut>`; ortak bayraklar `--dry-run --fixtures --out --limit --since
--student-ref --adapters` (`ogrenmen_common.cli_base`), alt komuttan önce ya da sonra yazılabilir. `--out`
verilmezse `./out`. Gerçek çalışmada `SUPABASE_URL`/`SUPABASE_BATCH_JWT` yoksa iş `--dry-run`'a düşer.

| Komut | Ne yapar | Yazdığı / ürettiği |
| --- | --- | --- |
| `ingest --pdf <yol> --course MAT101 --year 2023 --term final --legal-basis "öğrenci kendi kopyası" [--instructor-alias hoca-A]` | Yerel PDF'i `exams/<id>.pdf`'e yükler, `exam_sources` satırını açar (kimlik: ders + yıl + dönem + PDF sha256 → aynı PDF yeni satır açmaz), OCR | `exam_sources`, `exam_items`, `ingest_report.json` |
| `ingest --source <uuid>` | Panelin açtığı kaynağı işler (PDF `Storage`'dan) | aynı |
| `ingest --queue [--limit 10]` | Gece: `status='uploaded'` kaynaklar `created_at` sırasıyla; yoksa `SKIP: no uploaded sources` | aynı |
| `embed --course <kod> [--all]` | `ocr_text` → `embedding` (`halfvec(768)` metni) | `exam_items.embedding`, `embed_report.json` |
| `cluster --course <kod>` / `cluster --changed` | Kümeleme; `ocr_done` → `clustered`; izlence varsa `align` otomatik. `--changed` kursu yoksa `SKIP: no changed courses` | `exam_clusters`, `exam_items.cluster_id`, `cluster_report.json`, `alignment.json` |
| `align --course <kod> [--syllabus <json>]` | İzlenceyi yazar (`curriculum_id = courses.curriculum_id`) ve hizalar | `syllabus_topics`, `alignment.json` |
| `plan --course <kod> --period <dönem>` | Yalnız elle: plan → `pending_review` | `exam_priority_plans`, `priority_plan.json` |
| `variants --plan <uuid> [--top 5]` | Yalnız `approved` plan: ilk N satır için `exam_variant` isteği | `generation_requests`, `variants_report.json` |
| `distractor-report [--curriculum TYT-MAT]` | Etiket başına seçilme oranı, hiç seçilmeyen çeldiriciler | `distractor_report.json`, `.md` |
| `prerequisite-audit [--curriculum TYT-MAT] [--window-days 14]` | Ön koşul çıkarımı ↔ sonraki ilk doğrudan ölçüm örtüşmesi | `prerequisite_audit.json`, `.md` |

Her çalışma `cost_estimate.json` yazar; JsonlDb çıktıları `out/<tablo>.jsonl` (yalnız bu çalışmada yazılan satırlar).
Gece zinciri (§6.6): `kalem ingest --queue && kalem cluster --changed`; haftalık: `kalem distractor-report`.

## Akış ayrıntıları

**Ingest.** PDF `pypdfium2` ile 150 dpi PNG'lere çevrilir (en çok 40 sayfa; bozuk/boş PDF `OGR-KALEM-003`).
Render'dan önce her sayfanın ölçüsü okunur: bir kenarı 5000 pikseli ya da toplamı 40 sayfa A3 bütçesini aşan PDF
`OGR-KALEM-003` ile reddedilir (553 baytlık 14400 × 14400 puntoluk tek sayfa ~2,7 GB bitmap isterdi). `ingest --pdf`
satır açmadan önce yalnız açar/sayar/ölçer (render bir kez, ortak gövdede).
OCR isteği (`ogrenmen_common.adapters.media.ocr_request`) yalnız sayfa sayısı ve kaynak meta verisini taşır; metin
`scrub_for_llm`'den geçer, çağrı `CostLedger.call('ocr')` ile (tavan kapısı, sağlayıcı düşüşü, şema onarımı,
`llm_calls` satırı). Dönen her madde `exam-item` sözleşmesinden geçer; `source_id`, `year`, `term`,
`instructor_alias` **kaynaktan** yazılır (modelin değeri ezilir; kaynakta takma ad yoksa maddede de yoktur).
Madde kimliği `uuid5(source_id, item_no)`'dur; yeniden işlemede metni değişen maddenin gömmesi ve küme bağı
sıfırlanır; yeni OCR'da artık gelmeyen madde emekliye ayrılır (`ocr_text`, `embedding`, `cluster_id` boşaltılır —
silme yetkisi yok) ve kümeleme/plan onu saymaz. `ocr_text` saklanmadan önce `scrub_for_llm`'den geçer ("öğrenci
kendi kopyası" sayfalarındaki el yazısı adlar `--name-hashes` ile temizlenir). Müfredatta olmayan `skill_id`
yazılmaz (FK) ve uyarılır. Hata → `status='failed'`, `error`, `instructor_alerts(kind='ops', severity='warning',
'Sınav arşivi OCR tamamlanamadı: <yıl>/<dönem>', ref={source_id}, staff_id=yükleyen)` (açık aynı alarm varsa
ikincisi açılmaz) ve kurucuya bildirim. Beklenmeyen her hata (bellek, pdfium, görüntü) de bu yola düşer
(`OGR-KALEM-011 beklenmeyen hata: <tür>`): tek bozuk kaynak `--queue`'yu durduramaz, sıradaki kaynaklar işlenir.

**Harcama tavanı.** `CostLedger` `OGR-LLM-002` yükseltirse (tavan ya da ücretli çağrı kapalı) bu bir OCR hatası
sayılmaz: kaynak `uploaded` kalır (`error='cap_blocked: …'`), alarm/bildirim açılmaz, sonuç `deferred` olur ve CLI
`ERTELENDİ: …` yazar (çıkış 0). `--queue` aynı gece kalan kaynakları model çağırmadan erteler; ertesi gece hepsi
yeniden denenir.

**Embed.** Madde metni `scrub_for_llm`'den geçer; `rt.embedding` (`LedgeredEmbedding`) `check_spend('embedding')`
ve `llm_calls` defterinden geçer. Vektör pgvector `halfvec` metni olarak yazılır.

**Cluster.** Kosinüs mesafesi + **konu bağı**: aynı normalize `topic` ya da aynı `skill_id` taşıyan iki maddenin
mesafesi 0'dır (OCR'ın çıkardığı konu/kazanım güçlü bir kanıttır; sahte gömme rastgele olduğundan dry-run'da da
kümeler anlamlı kalır; tavan embedding'i engellerse kümeleme yalnız bu bağla sürer ve uyarı yazar).
scikit-learn varsa `AgglomerativeClustering(distance_threshold=0.25, linkage='average', metric='precomputed')`,
yoksa saf numpy tek bağ (mesafe < 0,25). Küme etiketi en sık `topic`; `kind` en sık tür; `years_hit` maddelerin
yılları, `years_total` dersin maddesi olan yıl sayısı; `avg_points`. Var olan kümeler en çok ortak maddeye göre
yeniden kullanılır (batch_worker'ın silme yetkisi yok); boşalan küme `item_count=0` olur. Hiç maddesi olmayan
dersin `ocr_done` kaynakları da `clustered` olur; böylece `cluster --changed` aynı dersi her gece yeniden seçmez.

**Align.** `[{"week":1,"topics":[...],"skill_ids":[...]}]`; `topics` ve `skill_ids` aynı uzunluktaysa her konu
ayrı satır (konu ↔ kazanım), değilse hafta tek satır. Kazanımlar `(curriculum_id, skill_id)` ile önceden denetlenir
(`OGR-KALEM-007`; DB'de `app.questions_check_skills`). Kazanımı izlencede olan ya da etiketi izlence konusuyla aynı
olan küme `covered_and_asked`, diğerleri `asked_not_in_syllabus`; hiç sorulmamış izlence konuları
`uncovered_topics`.

**Plan.** En çok 10 satır; sıra: kaç yılda soruldu → madde sayısı → ortalama puan → etiket. `points_text =
"≈{ort. puan, yarım yukarı yuvarlanmış} puan"`. 10'dan sonraki kümeler `others`. Yasaklı kelime taşıyan etiket
(istatistikteki "Nokta tahmini" gibi olağan bir konu da olsa) planı düşürmez: satırda ve `others`'ta kazanım adına,
o da uygun değilse "Konu kümesi N"e çevrilir; `uncovered_topics`'ten atılır; her değişiklik stderr'e etiketin
kendisi yazılmadan `UYARI` olarak düşer. `exam-priority-plan` doğrulaması son kapıdır. Plan `exam-priority-plan`
sözleşmesinden geçmezse yazılmaz (`OGR-KALEM-010`). En az iki yıl gerekir (`OGR-KALEM-004`). Daha önce bu satır
için üretilmiş onaylı özgün varyantlar (`questions.source='llm'`) `variant_question_ids`'e eklenir.

**Telif kemeri.** `ocr_text` yalnız `exam_items`'tadır. Küme etiketi, plan satırı, `others` ve `uncovered_topics`
dersin OCR metinleriyle **12+ karakterlik** ortak parça taşıyorsa (§6.4 ölçüsü; `COPY_WINDOW = 12`) kazanım adına ya
da "Konu kümesi N"e çevrilir ya da atılır. Muafiyet: normalize hâli dersin müfredatındaki bir `skills.name` ya da
izlencedeki bir `syllabus_topics.title` ile birebir aynı olan etiket (derlenmiş sözlük; müfredat/izlence adı soru
metni değildir — "Birinci dereceden denklemler ve sistemler" soru metninde geçse de konu adı olarak kalır).
`generation_requests` şemasında metin alanı yoktur. Testler fixture OCR metinlerinin her 12 karakterlik alt
dizisini plan ve istek JSON'unda arar; 12–19 karakterlik birebir kopya konu ("Etiket fiyatı 250") için ayrı test
vardır.

**Dry-run.** Sahte kipte (`--dry-run`) PDF `LocalDirStorage` ile `<fixtures>/exam-<yıl>.pdf`'e eşlenir; OCR
`FakeLLM` ile `fixtures/llm/ocr/*exam-<yıl>*.json`'u döner. `plan` hazırlığında maddesi olmayan kaynaklar için
`<fixtures>/ocr-*.json` (OCR zincirinin çıktısıyla aynı `exam-item` sözleşmesi) yeniden oynatılır ve izlence
satırı yoksa `<fixtures>/syllabus.json` yazılır; böylece `plan --dry-run --fixtures fixtures/kalem` ağsız ve
modelsiz uçtan uca koşar (DEMO: 2 yıl, 10 madde, 8 satır, 3 sorulmamış izlence konusu).

## Tür eşleme tablosu (`kinds.py` tek kaynak)

| `exam_items.kind` | plan satırı `kind` | `question_kind` | not |
| --- | --- | --- | --- |
| `mc` | `çoktan seçmeli` | `mcq` | — |
| `calc` | `hesap` | `numeric` | sayısal cevap; SymPy kapısı |
| `other` | `diğer` | `mcq` | varsayılan |
| `proof` | `ispat` | — | varyant üretilmez; `variants_report.json` `skipped.proof` |

`variants` ayrıca `skill_id` boş satırları (`skipped.no_skill`) ve aynı plan + kazanım + konu için açık isteği
(`skipped.exists`) atlar. Tablet çağrılmaz ve içe alınmaz (test alt süreçte `sys.modules`'ü denetler).

## Raporlar

* `distractor-report` — onaylı ve denenmiş sorulardaki her etiketli çeldiricinin sunulma/seçilme sayısı ve oranı;
  hiç seçilmeyenler yeniden yazım adayıdır (`value` = hiç seçilmeyen payı; M07 `distractor_unused_share` ile aynı
  tanım). Sayım kuralı M07 ile ortaktır: sorunun **her** denemesi sunulma (`offered`) toplamına girer ve soruyu
  denenmiş yapar — şık seçmeden (`chosen` boş) yapılan deneme de çeldiriciyi göstermiştir; hiçbir şıkkın seçilme
  sayısına girmez. Test aynı fixture'da iki uygulamanın `n`, `unused`, `value`, `by_tag` değerlerini karşılaştırır.
* `prerequisite-audit` — `observations.kind='inferred'` satırları; `mastery_history(method='inferred')` ile düşüş;
  aynı kayıt × kazanımda pencere içindeki **ilk** doğrudan ölçüm (teşhis/pratik/test) yanlışsa çıkarım örtüşür.
  Çıktı yalnız sayı ve kazanım taşır; öğrenci/kayıt/personel kimliği yoktur.

## Hata kodları

`OGR-KALEM-001` ders yok · `002` kaynak yok · `003` PDF okunamadı/boş/çok uzun/sayfası çok büyük · `004` en az iki yıl / kümelenmiş
madde yok · `005` plan yok ya da onaylı değil · `006` dersin müfredat eşlemesi yok · `007` izlence geçersiz ·
`008` OCR çıktısı geçersiz ya da madde yok · `009` bilinmeyen müfredat kodu · `010` plan sözleşmeden geçmedi ·
`011` girdi/depolama hatası ya da beklenmeyen hata (kaynak `failed` olur). CLI hata durumunda tek satır `HATA: …` yazar ve 1 ile çıkar.

## Sapma notları

1. **Alarm metni.** §6.4 metni "Sınav arşivi OCR başarısız: <yıl/dönem>" der; `instructor-alert` şemasının
   `x-forbidden-words` listesi "başarısız"ı reddettiği için alarm şemadan geçemezdi. Aynı anlam
   "Sınav arşivi OCR tamamlanamadı: <yıl>/<dönem>" ile yazılır (ref, tür ve tekilleştirme aynı).
2. **`test_ingest_from_source_marks_ocr_done`.** §6.4 testi `out/exam_items.jsonl` satırlarında
   `instructor_alias='hoca-A'` arar; `exam_items` tablosunda (0009) bu sütun yoktur — takma ad kaynak başınadır
   (`exam_sources.instructor_alias`). Test iki şeyi doğrular: (a) modelin çıktısı `hoca-Z`/1999/`vize` yazacak
   biçimde değiştirilir ve `exam_items`'a giden her `exam-item` nesnesinin `instructor_alias='hoca-A'`, `year=2022`,
   `term='final'` taşıdığı (kaynaktan ezildiği) yakalanır; (b) `out/exam_items.jsonl` satırlarının kaynağı
   `out/exam_sources.jsonl`'de `hoca-A`'dır.
3. **Konu bağı.** Kümeleme mesafesine aynı konu/kazanım için 0 eklenir (yukarıda); §6.4 yalnız gömme mesafesini
   anar. Gerekçe: sahte gömmeler rastgele, tavan durumunda gömme hiç yok. Gerçek gömmeyle de sonuç değişebilir:
   aynı etiketli maddeler her zaman birleşir ve tek bağ bu bağı zincirleyerek gömmenin tek başına ayrı tutacağı
   kümeleri de birleştirebilir. Bu bilinçli bir tercihtir — OCR'ın çıkardığı konu/kazanım etiketi gömmeden güçlü bir
   kanıttır.
4. **`ingest --pdf` gerçek kipte.** `exams` kovasında `batch_worker`'ın yalnız okuma politikası vardır (0017);
   yükleme reddedilirse komut satır açmadan durur ve paneldeki "Arşiv yükle" + `ingest --source` yolunu söyler.
   Elle `--pdf` yolunun üretimde de çalışması istenirse 0017'ye
   `create policy exams_batch_insert on storage.objects for insert to batch_worker with check (bucket_id = 'exams');`
   eklenmelidir (karar M02/M13'ündür).

5. **Telif muafiyeti.** §6.4 12+ karakterlik alt diziyi ölçer; Kalem bu ölçüyü uygular, ancak müfredat kazanım adı
   ve izlence başlığıyla birebir aynı etiketi muaf tutar (yukarıda). Bu adlar soru metni değil, derlenmiş
   sözlüktür; muafiyet olmadan "Birinci dereceden denklemler ve sistemler" gibi adlar soru metninde geçtiği her
   derste "Konu kümesi N"e düşerdi.
6. **Çeldirici sayım kuralı.** §6.2 M07 ile "paylaşılan SQL" der; iki Python uygulaması aynı kuralla sayar (şıksız
   deneme sunulma toplamına girer) ve test bunu M07 uygulamasıyla karşılaştırır.

## Kabul komutu notu

İki kabul komutu yazıldığı gibi, herhangi bir çalışma dizininden 0 ile çıkar; uyarlama gerekmedi.
