# pipelines/kulaklik_batch — `ogrenmen_kulaklik` (M07)

Kulaklık'ın gece ve hafta işleri (BLUEPRINT §6.2): gece olgu çıkarımı, haftalık özet, eğitmen alarmları ve pilot
ölçütleri (pilot kapısı dahil), işaretli cevap örneklemi, saklama, maliyet raporu, harcama denetimi ve eksik
embedding doldurma. Hiçbir hesap ya da anahtar olmadan çalışır ve sınanır: `--dry-run` (ya da veritabanı bilgisi
yokken) `ogrenmen_common`'ın sahteleri (`JsonlDb`, `FakeLLM`, `FakeEmbedding`) kullanılır, ağa çıkılmaz.

## Kurulum ve kabul

Önce ortak taban (`pipelines/common` README'si): `ogrenmen-contracts`, `ogrenmen-mastery`, `ogrenmen-pii`,
`ogrenmen-common` aynı ortamda `pip install -e` ile kurulu olmalıdır. Sonra:

```
python -m pip install -e /home/user/alperen/pipelines/kulaklik_batch[dev] && ruff check /home/user/alperen/pipelines/kulaklik_batch && python -m pytest /home/user/alperen/pipelines/kulaklik_batch -q
python -m ogrenmen_kulaklik facts --day 2026-10-18 --dry-run --fixtures /home/user/alperen/fixtures/kulaklik --out /tmp/kk-out
python -m ogrenmen_kulaklik metrics --dry-run --fixtures /home/user/alperen/fixtures/kulaklik --out /tmp/kk-out
python -m ogrenmen_kulaklik metrics --gate --dry-run --fixtures /home/user/alperen/fixtures/kulaklik --out /tmp/kk-gate
python -m ogrenmen_kulaklik cost-report --month 2026-10 --dry-run --fixtures /home/user/alperen/fixtures/kulaklik --out /tmp/kk-out
```

Dış bağımlılık yoktur (metrikler satırlar üzerinde saf Python ile hesaplanır); geliştirme için `pytest==9.2.0`,
`ruff==0.17.3`.

## Komutlar

Ortak bayraklar `ogrenmen_common.cli_base`'dendir: `--dry-run --fixtures <dizin> --out <dizin> --limit N --since
--student-ref s_… --adapters fake|real`. `--out` verilmezse `./out`. Her komut `out/cost_estimate.json` yazar;
dry-run'da `JsonlDb`'nin bu çalışmada yazdığı satırlar `out/<tablo>.jsonl` olur.

| Komut | Ne yapar | Çıktı |
| --- | --- | --- |
| `facts [--day G] [--batch] [--name-hashes J]` | Önce `reembed --missing` (ayrı adım), sonra günün mesajlarından olgu çıkarımı | `memory_facts.jsonl`, `facts_report.json`, `reembed/` |
| `summaries [--week G] [--batch]` | Öğrenci başına haftalık özet (`weekly-summary`) | `weekly_summaries.jsonl`, `summaries_report.json` |
| `metrics [--week G] [--gate] [--ci-status J]` | Eğitmen alarmları + sekiz pilot ölçütü (LLM yok); `--gate` ile pilot kapısı | `instructor_alerts.jsonl`, `alerts.json`, `pilot_metrics.jsonl`, `distractor_report.json`, `pilot_gate.md`, `pilot_gate.json` |
| `review-sample [--week G]` | Haftanın işaretli cevapları + deterministik rastgele 20 → `review_week` | `review-<hafta>.md`, `bot_responses.jsonl` |
| `retention [--report] [--export-md Y]` | `run_retention()`, `cap_memory_facts()`, `compute_table_sizes()`; rapor; saklama süreleri belgesi | `retention-report.md`, `retention_report.json`, `Y` |
| `cost-report --month AY [--check]` | İki bütçeli maliyet raporu; `--check` defter denetimi ve kill-switch | `cost-report.md`, `cost-report.json` |
| `check-spend [--purpose A]` | `check_spend` durumu (gece işinin ilk adımı) | `check_spend.json` |
| `reembed [--missing]` | `memory_facts` embedding'leri (bayraksız: tüm aktif olgular — model değişince) | `memory_facts.jsonl`, `reembed_report.json` |

Zaman kuralları veritabanıyla aynıdır: gün Europe/Istanbul takvim günüdür; hafta penceresi `[G, G + 7)`'dir
(`--week` verilmezse bugünden 7 gün önce başlar); `pilot_metrics.period` pencere başlangıcının haftasının
pazartesisidir. Sahte dünyanın "şimdi"si `2026-10-20T09:00:00Z`'dir (`OGRENMEN_NOW` değiştirir).

### Gece olguları (`facts`)

- Mesajlar `text_raw` olmadan okunur (sütun listesinde yoktur). Yalnız `text_llm`'i dolu mesajlar modele gider;
  onaysız öğrencinin ve onaysız grup üyesinin mesajında `text_llm` null'dır ve bu öğrenciler için **hiç çağrı
  yapılmaz** (`facts_report.json` `skipped_unconsented`).
- Her metin `scrub_for_llm` ile bir kez daha temizlenir. `--name-hashes` ad-token sha256 hex listesidir (düz ad
  değil); `batch_worker` `secure` şemasını göremediği için liste kurucunun makinesinde üretilip verilir. Liste
  olmadan da e-posta, telefon, T.C. kimlik, IBAN, @kullanıcı, URL, "adım X", okul ve sınıf kalıpları silinir.
- İstem numaralı mesaj listesidir (`[#<messages.id>] öğrenci: …`), en çok 3.000 token (fazlaysa en eski mesajlar
  atılır). Zincir `nightly_facts`, sözleşme `nightly-facts-output`. `--batch` ile Gemini Batch: iş gecikir ya da
  tavan engellerse `runtime_flags.facts_lag_days + 1` yazılır, eş zamanlı çağrıya düşülmez.
- Doğrulama: çıktının `student_ref`/`day`'i istenenle aynı olmalı; her olgunun `source_message_ids`'i boş olamaz ve
  yalnız istemde gönderilen o günün mesajlarından olabilir — aksi olgu atılır. Olgu metni temizleyiciden geçer;
  yargı/tanı etiketi (`tembel`, `depresif`, `başarısız` …) ya da ilke 10 kelimesi (`tahmin`, `çıkacak`, `kesin`,
  `garanti`) taşıyan olgu atılır (`dropped[].reason = "yargi_kelimesi"`; `kind='morale'` dahil). Sonra
  `memory-fact` sözleşmesiyle yeniden doğrulanır; `requires_approval` olgu `approved=false` yazılır.
- Aynı öğrencide kosinüsü > 0,92 olan eski aktif olgu `merged` olur (§6.2; tür koşulu yoktur). Tek istisna:
  onay bekleyen yeni olgu (`requires_approval`) kullanılabilir durumdaki (onaylı ya da onay gerektirmeyen) eski
  olguyu birleştirmez — eğitmenin onayladığı olgu, yenisi onaylanana kadar erişimden düşmez.
- `messages.is_question` yalnız düzeltilir; `answered_at` istemdeki sonraki bot/eğitmen cevabının zamanıyla
  doldurulur — cevap satırı istemde yoksa yazılmaz (`answered_unresolved`; zaman uydurulmaz).
  `preferences.modality/explanation_notes` güncellenir; yasaklı kelime taşıyan `explanation_notes` yazılmaz.
  `messages` güncellemesi `RETURNING` olmadan gider (aşağıda "Dönüşsüz yazımlar").
- Token bütçesi bir öğrencinin bütün satırlarını atarsa öğrenci `skipped_trimmed_out`'a yazılır
  (`skipped_unconsented` yalnız onaysız öğrencilerdir). `facts` içindeki `reembed --missing` adımı `--limit`'e
  uyar; embedding çağrıları `out/cost_estimate.json`'a da eklenir (`facts_report.json` `reembed.cost_usd`).

### Haftalık özet (`summaries`)

Ölçüler LLM'den gelmez: canlı veritabanında `panel_metrics_weekly` doğrudan okunur (pazartesi başlayan pencere),
aksi hâlde aynı tanımlar Python'da hesaplanır. `morale_trend` `morale_signal` ortalamasındandır (ders kaynaklı moral
olguları dahil). Modelden yalnız `body` ve `next_week_focus` alınır; `facts_used` istemdeki olgularla sınırlanır.
Yargı/tanı etiketi ya da ilke 10 kelimesi taşıyan gövde yazılmaz (`rejected[].reason = "yargi_kelimesi"`).

### Eğitmen alarmları (`metrics`)

**Canlıda** alarmlar `db.rpc('cron_open_alerts', {})` ile SQL'de açılır, yükseltilir ve kapatılır
(`batch_worker`'ın EXECUTE yetkisi var); SQL ile tam aynıdır (`staff.active`, `created_at` sırası,
`messages.expires_at` SECURITY DEFINER gövdede okunur). Sonra açık alarmlar okunup `alerts.json` yazılır
(`metrics_report.json` `alerts.mode = "rpc"`).

**Dry-run'da** JsonlDb'de bu RPC'nin eşleniği olmadığından aynı kuralların Python eşleniği çalışır
(`mode = "python"`): cevapsız (yükseltme ve soru işaretli mesaj, 6/24 saat), sessiz (3/7 gün), teslim (≤ 2 gün),
moral (son 7 gün ortalama ≤ −1 ve ≥ 3 sinyal; ders kaynaklı `kind='morale'` olguları dahil), eğitmen yanıt medyanı
(> 2 saat; personel başına `ref.staff_id`), ops (grupta yönetici değil / gizlilik modu açık; `ref.chat_id`).
Metinler ve tekilleştirme SQL ile aynıdır (`alerts_dedup`: tür + öğrenci + `coalesce(ref->>message_id, fact_id,
escalation_id, chat_id, lesson_id, source_id, staff_id)` + `detail`'in ilk 24 karakteri); medyan `round(numeric, 1)`
gibi yarım yukarı yuvarlanır, hedef `v_target::text` gibi yazılır (`2` → "2", `2.0` → "2,0"). Eşleniğin yalnız
`batch_worker` yetkili sütunlarını kullanması yüzünden SQL'den ayrıldığı iki nokta vardır (birebir değildir):
`staff`'tan yalnız `(id, role)` okunur — `staff.active` süzgeci yok, eğitmen/koordinatör `created_at` yerine
`staff.id` sırasıyla seçilir; `messages.expires_at` okunmaz — süresi geçmiş mesaj için de (b) alarmı açılabilir.

Şablon metinlerinde tanı etiketi yoktur ("göstergesi düştü"). `detail`'e alıntılanan kullanıcı ya da LLM metni
(öğrencinin sorusu, yükseltme sorusu, teslim olgusu) yazılmadan önce maskelenir: yasaklı kelime içinde geçtiği
sözcükle birlikte `…` olur ("Neden hep … oluyorum?"). Her aday yine `instructor-alert` sözleşmesinden
(`x-forbidden-words`) ve yerel yargı kelimesi listesinden geçer; geçemeyen aday atlanır ve `alerts.rejected`'a
yazılır — tek bir mesaj ne alarmları ne pilot ölçütlerini durdurur. `alerts.json` önem (Acil → Dikkat → Bilgi) ve
zamana göre sıralıdır.

### Pilot ölçütleri ve pilot kapısı

`metrics` sekiz ölçütü `pilot_metrics`'e yazar (`diagnostic_agreement`, `citation_relevance`, `priority_uplift`,
`cost_per_student`, `distractor_unused_share`, `flagged_response_share`, `degraded_share`, `question_accuracy`).
`detail` yalnız sayılar taşır; öğrenci, kayıt ya da personel kimliği ve ad yoktur (`priority_uplift.plan_ids`
blueprint'in istediği plan kimlikleridir). Az veride `value=null` (`question_accuracy`, `diagnostic_agreement`,
`citation_relevance` için n < 10). `cost_per_student` ders amaçlarını (`cap_excluded_purposes`) içermez;
`detail.lesson_usd` ayrı anahtardır.

**Pilot kapısı** (`metrics --gate`, ADR-0013): eşikler yalnız `settings.pilot_gate` satırından okunur — kodda
varsayılan eşik yoktur, satır yoksa iş `OGR-KLK-020` ile durur; eşik değişikliği `settings.pilot_gate` + ADR ile
yapılır. Kapı, `metrics`'in aynı çalışmada hesapladığı dönemin satırlarına uygulanır (tanım gereği son dönem;
`batch_worker` `pilot_metrics`'i okuyamaz); ölçüt başına `PASS` / `FAIL` / `NO_DATA` (satır yok, `value=null`
ya da `n < n_min`). Eşikler kapı kapalı kalacak biçimde doğrulanır: her giriş ya `"pass"` dizesi ya da anahtarları
yalnız `min, max, max_usd, n_min, required` olan, sınırları sayı (bool değil), `required`'ı bool olan ve en az bir
`min`/`max`/`max_usd` taşıyan nesnedir; yazım hatası (`{"mn": 0.9}`), tırnaklı sayı (`{"max": "0.05"}`) ya da boş
nesne `OGR-KLK-020` ile durur, sessizce PASS olmaz. Hiç zorunlu ölçüt yoksa kapı KAPALI'dır. `isolation_tests` ve `key_leak_tests` CI'dan `--ci-status '{"isolation_tests":"pass",
"key_leak_tests":"pass"}'` (ya da JSON dosyası) ile gelir; verilmezse `NO_DATA`. `required:false` ölçütler bilgi
satırıdır. Zorunlu ölçütlerin hepsi `PASS` değilse `out/pilot_gate.md` "Kapı: KAPALI" ile biter — `NO_DATA` kapıyı
açmaz. Panel `/maliyet` "Pilot kapısı" bloğu aynı kuralı uygular; iki uygulamanın ortak vaka dosyası
`tests/gate-cases.json`'dır (eşik + ölçüt + CI → karar; geçersiz eşik vakaları dahil).

### Maliyet raporu

Defter tektir, bütçe ikidir. "Sohbet ve toplu işler" sütunu `cap_excluded_purposes` dışındaki amaçlardır (ay toplamı,
tavana oran, öğrenci başına maliyet, sağlayıcı payı, ücretsiz düşüş oranı, en pahalı 10 tur, havuz isabeti);
"Ders analizi" sütunu `lesson_analysis + transcribe + diarize`'dır (ay toplamı, ders sayısı, ders başına ortalama,
`lesson_monthly_cap_usd`'ye oran) ve öğrenci başına maliyete dahil edilmez. `--check`: sohbet/toplu için
`llm_calls` toplamı `spend_ledger`'la karşılaştırılır, fark %5'i aşarsa çıkış kodu 2 ("ledger drift"); ay toplamı
aylık tavanın %100'üne ulaşmışsa `set_runtime_flag('paid_llm_enabled', false)` çağrılır (tek yönlü kill-switch;
RPC reddederse hata yükselir, sessiz geçilmez). "Pilot ölçütleri" bölümü `pilot_metrics`'in son döneminden okunur;
`batch_worker` bu tabloyu okuyamadığı için okuma reddedilirse ölçütler aynı veriden yeniden hesaplanır (bölümde
"yeniden hesaplandı" yazar) — rapor ve `cost-guard.yml`'nin kill-switch adımı bu yüzden durmaz. Konsol satırı da
raporla aynı Türkçe biçimi kullanır (`3,00 $`).

### Saklama

`retention` `run_retention()`, `cap_memory_facts()` ve `compute_table_sizes()`'ı çağırır (pg_cron yedeği).
`--export-md <yol>` `retention_policies`'ten `saklama-sureleri.md` üretir; kullanıcıya gösterilen metin aynı
satırdan gelir (`messages.hard_delete` için gün `tg_chats.retention_days`). Yalnız `--export-md` verilirse saklama
işleri çalışmaz.

### Dönüşsüz yazımlar

`PostgrestDb.insert/update` her zaman `Prefer: return=representation` gönderir; bu `RETURNING *` demektir ve
`batch_worker`'ın SELECT yetkisi olmayan sütunda/tabloda yazımı düşürür (`messages`: `text_raw`, `expires_at`;
`pilot_metrics`: SELECT hiç yok). Bu modül o iki tabloya `common.insert_minimal` / `update_minimal` ile yazar:
canlıda istek `return=minimal` ile gider, JsonlDb'ye doğrudan yazılır. `pilot_metrics` için önce upsert denenir;
`ON CONFLICT DO UPDATE` çakışma sütunlarında SELECT istediğinden yetki hatasında satır başına düz eklemeye
düşülür ve aynı `(metric, period)` varsa satır "zaten yazılmış" sayılır (`metrics_report.json`
`pilot_metrics_write`). Yerel PG16'da doğrulandı: `batch_worker` ile düz INSERT geçer, ikinci kez 23505 verir,
upsert ve `RETURNING` "permission denied" verir.

## Sahte LLM seçimi (dry-run)

`FakeLLM`'in §2.3 kuralı (`sha256(prompt) mod n`) bir öğrencinin istemine başka öğrencinin fixture'ını
döndürebilir; gece işi bu yanıtı doğru olarak reddeder ve dry-run'da hiç olgu oluşmazdı. Bu yüzden sahte kipte
`fixture_llm.ContractFixtureLLM` istemdeki `Öğrenci: s_…` ve `Gün:`/`Hafta:` satırlarına göre aynı öğrenci ve
gün için yazılmış sözleşme örneğini seçer: `<--fixtures>/facts-day.json` (§6.2 "fake LLM
fixtures/kulaklik/facts-day.json") ve `fixtures/llm/{nightly_facts,weekly_summary}/*.json`. Eşleşme yoksa
`FakeLLM`'e devreder. Gerçek kipte kullanılmaz; çağrılar yine `CostLedger`'dan geçer (tavan, `llm_calls`).

## Testler

`tests/`: `test_facts.py` (kaynak mesaj kimliği zorunluluğu, onaysız öğrencinin mesajının LLM'e hiç gitmemesi, PII
temizliği, başka öğrencinin çıktısının reddi, birleştirme — tür koşulsuz, onaylı olgu korunur —, yargı/ilke 10
kelimesi taşıyan olgu ve tercih notunun atılması, `is_question` düzeltmesi, uydurulmayan `answered_at`, Batch
erteleme ve fiyatı, token bütçesi ve `skipped_trimmed_out`), `test_reembed.py` (`test_missing_embeddings_filled`),
`test_alerts.py` (`test_lesson_morale_feeds_alert`, `test_two_groups_two_ops_alerts`, iki yavaş eğitmen → iki
`response` alarmı, SQL sayı biçimi, alıntıdaki yargı kelimesinin maskelenmesi ve işin durmaması, canlı kipte
`cron_open_alerts` RPC'si, sıralama, tekilleştirme/çözme), `test_pilot.py` (fixture: 4/30, 5/30, 8/11; az veride
null; ayrıntıda kimlik yok; sentetik teşhis/atıf/öncelik vakaları), `test_gate.py`
(`test_gate_requires_all_required_metrics`, NO_DATA kapıyı açmaz, eşikler `settings.pilot_gate`'ten, bozuk eşik
`OGR-KLK-020`, `gate-cases.json` ortak vakaları, kapı az önce hesaplanan satırlarla), `test_cost.py`
(`test_cost_report_separates_lesson_costs`, CLI `--check` ledger drift → 2 ve stderr, okunamayan `pilot_metrics`,
kill-switch), `test_grants.py` (`GrantedDb`: `supabase/tests/grants_matrix.json`'daki `batch_worker` sütun
yetkileri ve `RETURNING *` davranışıyla bütün komutlar uçtan uca; `pilot_metrics` düz ekleme yedeği),
`test_retention_review.py`, `test_summaries.py` (yasaklı kelimeli gövde reddi), `test_static.py` (`text_raw`
istenmez, model adı ve kapı eşiği koda yazılmaz).

## Hata kodları

`OGR-KLK-001` tarih/ay biçimi · `OGR-KLK-002` `cap_excluded_purposes` yok · `OGR-KLK-003` ad hash dosyası ·
`OGR-KLK-010` alarm metninde yargı kelimesi (aday atlanır, `alerts.rejected`; iş durmaz) · `OGR-KLK-020` `settings.pilot_gate` yok/bozuk · `OGR-KLK-021`
`--ci-status` bozuk. Ortak kodlar (`OGR-LLM-*`, `OGR-DB-*`, `OGR-RPC-*`) `pipelines/common` README'sindedir.

## Sapma notları

1. **`facts` içindeki `reembed --missing` çıktısı `out/reembed/`'dedir.** Ders kaynaklı olgular
   (`source_lesson_claim_id` dolu, `source_message_ids` boş) embedding alınca yazılmış satır sayılır; aynı dizine
   düşselerdi `out/memory_facts.jsonl` gece çıkarımının olgularıyla karışırdı. Adım ayrı bir çalışmadır; dry-run'da
   iki adım aynı bellek içi veritabanını paylaşır (birleştirme eski olguların embedding'ini görür), canlıda zaten
   aynı veritabanıdır.
2. **`pilot_metrics` sekiz satır yazar.** §6.2 test cümlesi "altı satır" der ama aynı bölüm `cost_per_student` ve
   `distractor_unused_share`'i de `metrics`'e verir ve kapı `cost_per_student`'ı zorunlu sayar; test altı ölçütün
   varlığını ve toplam sekiz satırı denetler.
3. **`response` alarmının `ref.staff_id`'si.** SQL (`cron_open_alerts`) bu anahtarı yazar ama `instructor-alert`
   sözleşmesinin `ref`'inde yoktur; DB satırı SQL ile aynıdır, sözleşme görünümünde personel `staff_ref`'tedir.
4. **CI satırları `pilot_metrics`'e yazılmaz.** Panel README'si `isolation_tests`/`key_leak_tests` için
   `pilot_metrics` satırı önerir, ama tablonun `metric` check kısıtı bu adları kabul etmez; kapı CLI'da yalnız
   `--ci-status` ile beslenir.
5. **`flagged_response_share.by_reason`** `flag_reason`'ın ilk kelimesiyle gruplanır (`question_accuracy`'deki
   `review_note` kuralıyla aynı; serbest metin ayrıntıya girmez).
6. **`pilot_metrics` yeniden yazılamaz (yetki açığı, M02'ye bildirildi).** §3.8 `batch_worker` için `w u` verir,
   SELECT vermez; bu yüzden ne upsert (`ON CONFLICT DO UPDATE` çakışma sütunlarında SELECT ister) ne de `where`'li
   UPDATE çalışır. Gece işi her gece `metrics` çalıştırdığından dönemin değeri o haftanın **ilk** hesabında kalır.
   Çözüm M02'dedir: `grant select on public.pilot_metrics to batch_worker` (ya da bir `upsert_pilot_metrics` RPC'si).
   Yetki verilince `pilot.write` ilk denemedeki upsert'le kendiliğinden güncellemeye başlar; kod değişmez.
7. **Alarm eşleniği dry-run içindir.** Canlıda `cron_open_alerts()` çağrılır. Python eşleniği `staff.active`'i ve
   `messages.expires_at`'i okuyamaz (yukarıda); mesaj okumaları zaman sınırı almaz, çünkü sessiz öğrenci kuralı
   öğrencinin **son** mesajına bakar ve sınırlı okuma uzun süredir sessiz öğrenciyi hiç görmezdi (SQL de sınırsız
   okur). Canlı veritabanında Python ↔ SQL vektör karşılaştırması yoktur; canlı yol zaten SQL'in kendisidir.
8. **Birleştirmede onay durumu.** §6.2 birleştirmeyi yalnız kosinüsle tanımlar (tür koşulu kaldırıldı, §6.2'ye
   uyuldu). Ek kural: onay bekleyen yeni olgu kullanılabilir eski olguyu birleştirmez (eğitmenin onayladığı olgu
   yenisi onaylanana kadar erişimden düşmesin diye).

## Entegrasyon notları (başka modüllere)

- **M13 (`scripts/check-all.sh`):** M07'nin beş kabul komutu henüz çalıştırılmıyor; eklenmeli.
- **M02:** `pilot_metrics` için `batch_worker`'a SELECT (Sapma notu 6).
- **M05:** `PostgrestDb.insert/update` için `return=minimal` (ya da açık `select=` sütun listesi) seçeneği; bu
  modül şimdilik `common.insert_minimal/update_minimal` ile `PostgrestDb._send`'i kullanır. Ayrıca
  `CostLedger.record` `llm_calls`'a `created_at` gönderir, oysa `batch_worker`'ın INSERT yetkisinde bu sütun
  yoktur — canlıda her LLM/embedding çağrısının defter satırı "permission denied" ile düşer (`tests/grants.py`
  `UPSTREAM_TOLERATED`'da tek istisna olarak işaretli).
- **M11 (`apps/panel/lib/pilot-gate.ts`):** aynı eşik doğrulaması (bilinmeyen anahtar, tırnaklı sayı, boş nesne →
  kapı kapalı + hata), zorunlu ölçüt yoksa KAPALI (`&& rows.some(r => r.required)`), ve
  `pipelines/kulaklik_batch/tests/gate-cases.json`'ı test vakası olarak tüketmesi. Panel CI satırlarını
  `pilot_metrics`'ten okur, CLI `--ci-status`'tan (Sapma notu 4); bozuk `settings.pilot_gate` iki yüzeyde aynı
  kararı ancak bu doğrulamayla verir.

## Kabul komutu notu

Beş kabul komutu yazıldığı gibi, herhangi bir çalışma dizininden 0 ile çıkar; uyarlama gerekmedi.
