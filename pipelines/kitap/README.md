# pipelines/kitap — `ogrenmen_kitap` (M10)

Kitap, Öğrenmen'in araştırma ajanıdır (BLUEPRINT §6.5): bir soruyu 3–5 akademik sorguya genişletir, OpenAlex,
Semantic Scholar ve arXiv'de arar, **her DOI'yi Crossref'te doğrular**, açık erişim PDF'lerini okur ve yalnız
doğrulanmış kaynaklara dayanan bir sentez yazar. Crossref'in çözemediği her atıf çıkarılır; ona dayanan paragraf da
çıkar. Çıktı eğitmen incelemesine düşer (`research_outputs.status='pending_review'`); öğrenci yalnız yayımlanan
(`released`) çıktının tutulan atıflarını görür. Pilotta `runtime_flags.research_enabled=false`'tur: modül inşa edilir
ve sınanır, öğrenci kuyruğu açılmaz (§12 #44).

Hiçbir hesap ya da anahtar olmadan çalışır ve sınanır; testler ağa çıkmaz.

## Kurulum ve kabul

```
python -m pip install -e /home/user/alperen/pipelines/kitap[dev] && ruff check /home/user/alperen/pipelines/kitap && python -m pytest /home/user/alperen/pipelines/kitap -q
python -m ogrenmen_kitap run --query "spaced repetition matematik" --dry-run --fixtures /home/user/alperen/fixtures/kitap --out /tmp/kitap-out && python3 -c "import json;o=json.load(open('/tmp/kitap-out/output.json'));assert all(c['crossref_status'] in ('verified','no_doi') for c in o['citations']);assert o['removed'];ords={c['ordinal'] for c in o['citations']};assert all(set(p['cites'])<=ords for p in o['synthesis'])" && ! grep -q "10.9999/fake" /tmp/kitap-out/output.json
```

Önce `pipelines/common` README'sindeki yerel paketler (`ogrenmen-contracts`, `ogrenmen-mastery`, `ogrenmen-pii`,
`ogrenmen-common`) `-e` ile kurulmuş olmalıdır. Bağımlılıklar sabit sürümlüdür: `rapidfuzz` (başlık benzerliği),
`pypdf` (PDF metni), `bibtexparser` (BibTeX denetimi), `httpx`.

Canlı veritabanı testi: `OGRENMEN_DATABASE_URL` tanımlıysa `tests/test_live_db.py` geçici bir veritabanı
(`ogrenmen_kitap_live_<pid>`, sonunda silinir) açar, `00_local_stub.sql` + migration'lar + seed'leri uygular ve
`run --queued` + `verify` akışının her yazımını `set role batch_worker` altında gerçek şemada yeniden oynatır
(sütun yetkileri, RLS, check/FK kısıtları). Tanımlı değilse atlanır.

## Komutlar

```
python -m ogrenmen_kitap run --request <uuid>        tek istek (queued | failed | blocked_quota) → done | failed | blocked_quota
python -m ogrenmen_kitap run --query "..." --dry-run  elle çalıştırma; istek satırı yok, DB'ye çıktı yazılmaz
python -m ogrenmen_kitap run --queued [--limit 5]     gece kuyruğu (nightly.yml)
python -m ogrenmen_kitap verify --output <uuid>       yalnız Crossref yeniden denetimi (LLM yok)
```

Ortak bayraklar `ogrenmen_common.cli_base`'dendir: `--dry-run --fixtures --out --limit --since --student-ref
--adapters`. `--out` verilmezse `./out`. `--name-hashes <json>`: ad-token sha256 hex listesi; modele ve akademik
kaynaklara giden soru ile PDF metni bu hash'lerle de temizlenir (düz ad kabul edilmez, `OGR-KITAP-009`).

| Durum | Çıktı |
| --- | --- |
| `--queued`, `research_enabled=false` | `SKIP: research disabled`, çıkış 0 |
| `--queued`, kuyrukta satır yok | `SKIP: no queued requests`, çıkış 0 |
| `--request`, `research_enabled=false` | `SKIP: research disabled`, çıkış 0 |
| `--query`, `research_enabled=false` | bilgi satırı yazılır, çalıştırma sürer (elle çalıştırmadır) |
| aylık araştırma tavanı dolu (`research_monthly_cap`) | satır `blocked_quota`; ağ ve model çağrısı yok |
| `check_spend` ücretli çağrıya izin vermiyor ya da degraded kip | satır `queued` kalır, ertesi gece yeniden denenir; ağ ve model çağrısı yok |
| aynı engel araştırmanın ortasında (`OGR-LLM-002`, kapının `spend`/`degraded` engeli) | satır `queued`'a döner, harcanan maliyet `cost_usd`'ye eklenir, döngü durur |
| sentez boş, doğrulanmış kaynak yok, Crossref kesintisi | satır `failed` (`OGR-KITAP-005/004/010`) |
| beklenmeyen hata (DB/RPC 5xx, kusur) | satır `failed`, hata metni rapora; kuyruğun kalanı sürer — hiçbir satır `running` kalmaz |
| `--queued`, işlenen satırlardan biri `failed` | `HATA: N istek başarısız: …` (stderr), çıkış **1** (gece adımı kırmızı görünür) |

Çıktı dosyaları (`--out`): `output.json` (`research-output`), `report.json` (aday, doğrulama, PDF, maliyet özeti),
`--queued` için `outputs/<istek>.json` ve `queued_report.json`, `verify` için `verify_report.json`; `JsonlDb` yazılan
tabloları `<tablo>.jsonl` olarak, `CostLedger` `cost_estimate.json`'u yazar.

## Akış (`run`)

1. **Kapı** (`gate.py`; ağdan ve modelden önce): `research_enabled` (`--query` hariç), `check_spend` (`query_expand`
   ve `research` zincirleri; ikisi de yalnız ücretli model içerir), `research_monthly_cap` (Europe/Istanbul ayında
   `finished_at`'i olan `done` istekler). Öğrenci kotası Worker'da `enqueue_research` ile zaten düşmüştür.
2. **Genişletme**: zincir `query_expand` → `query-expand` sözleşmesi (3–5 sorgu; şemaya uymayan yanıt bir kez onarılır).
3. **Arama** (`search.py`): OpenAlex + Semantic Scholar (gerçek kipte yalnız `S2_API_KEY` varsa) + arXiv
   (`ogrenmen_common.adapters.arxiv.ArxivScholar`, `Scholar` Protocol'ü; sahtesi `FakeArxiv`). Bir kaynağın hatası
   işi düşürmez. DOI'ye göre tekilleştirme (üst veri birleşir), skor `0.5·alaka + 0.3·log(atıf+1)/log(max) +
   0.2·yıl yakınlığı` (§6.5; `max ≤ 1` iken payda `log 2`), ilk 30 aday.
4. **Crossref** (`verify.py`): 200 ve başlık benzerliği ≥ 0.6 (`rapidfuzz.fuzz.token_set_ratio/100`, iki ondalığa
   aşağı yuvarlanır) → `verified` (başlık, yazar, yayın, yıl Crossref'ten); 404/zaman aşımı →
   `removed(crossref_unresolved)`; başlık uyuşmazlığı → `removed(title_mismatch)`; DOI yoksa kurumsal/ön baskı
   bağlantısı (arXiv, DergiPark, YÖK Tez, `.edu.tr`) **ve** 1800–2100 arası yıl varsa `no_doi` + `oa_pdf_url`,
   yoksa `removed(no_doi_no_link)`.
5. **Açık erişim** (`pdfs.py`): Unpaywall `url_for_pdf` → en çok 6 PDF, her birinden en çok 40 sayfa, toplam
   ≤ 150k belirteç; metin `scrub_for_llm`'den geçer. Sahte kipte her bağlantı `fixtures/kitap/sample.pdf`'tir.
6. **Sentez** (`synthesize.py`): zincir `research` → `research-output`. Modele yalnız doğrulanmış liste gider ve
   `citations: []` istenir; modelin `citations` dizisi kullanılmaz. `CostLedger.call`'a tam şema yerine
   `response_errors` doğrulayıcısı verilir (yalnız `synthesis` ve `matrix` yapısı): modelin bilemeyeceği
   `request_id`/DOI/`verified_at` alanları onarım çağrısı tetiklemez. Her paragrafın `cites`'ı doğrulanmış listede
   olmalı ve metin yasaklı kelime içermemeli; uymayan paragraf bir kez yeniden üretilir, yine uymazsa atılır.
   Kaynağın `tldr`'ı yasaklı kelime içeriyorsa atıfta `tldr` boş bırakılır.
7. **Kaynakça** (`bib.py`): BibTeX ve APA şablonla, Crossref (ya da `no_doi` için kaynağın) üst verisinden; BibTeX
   `bibtexparser` ile ayrıştırılır, anahtarlar benzersizdir (`sahin2019a`, `sahin2019b`). İsteğe bağlı Zotero
   aktarımı (`zotero.py`): yalnız gerçek kipte, `ZOTERO_API_KEY` + `ZOTERO_LIBRARY_ID` varken.
8. **Kayıt** (`pipeline.py`): `research_outputs(pending_review)` + her aday için bir `citations` satırı (tutulan ve
   çıkarılan); istek `done`, `expanded_queries`, `cost_usd`, `finished_at`. Eğitmen panelde her tutulan atıfa ilgi
   puanı verir ve yayımlar; `app.research_released()` öğrenciye `research_ready` mesajını kuyruğa alır.

`verify --output <uuid>`: kayıtlı `verified` atıfları Crossref'te yeniden denetler; düşen atıf `removed` olur, ona
dayanan paragraf çıkar, BibTeX/APA'dan yalnız düşen kayıtlar silinir (kalan kayıtların türü ve anahtarı aynen
kalır). Doğrulanmış paragraf kalmazsa çıktı değiştirilmez ve `instructor_alerts(kind='ops')` açılır
(`batch_worker` çıktı durumunu değiştiremez). Alarm satırı `instructor-alert` sözleşmesinden geçer, `ref = {}`'dir
ve `detail` `"Araştırma <çıktı kimliğinin ilk 8 karakteri>: …"` ile başlar: `alerts_dedup`
(`left(detail, 24)`) farklı çıktıların alarmlarını ayırır; aynı çıktı için açık alarm varsa yenisi yazılmaz.

## Gizlilik ve maliyet

* Modele ve akademik kaynaklara giden her metin `scrub_for_llm`'den geçer (e-posta, telefon, kimlik no, URL,
  `--name-hashes` ile ad-token hash'leri). Model istemleri tek çıkış noktasında **bütünüyle** temizlenir (soru,
  sorgular, başlık/yazar/özet listesi, PDF alıntıları, yeniden üretim istemi). `output.query` temizlenmiş sorudur;
  ham soru yalnız `research_requests.query`'de kalır. Öğrenci kimliği hiçbir yere taşınmaz: `llm_calls.student_ref` boştur,
  `ref_table='research_requests'`, `ref_id` = istek kimliği.
* Her model çağrısı `CostLedger.call` üzerinden geçer (`check_spend`, zincir, şema, onarım, `llm_calls`).
* Çözülemeyen DOI `research-output` JSON'unda hiçbir yerde geçmez: `removed[].doi_or_title` bu satırlar için
  başlıktır; DOI yalnız `citations` satırında kalır (inceleme ve 7 günlük `citations.unresolved` saklama kuralı
  için `verified_at` = denetim anı).

## Yazımlar ve yetkiler (`batch_worker`, `supabase/tests/grants_matrix.json`)

| Tablo | İşlem | Sütunlar |
| --- | --- | --- |
| `research_requests` | select, update (`return=minimal`) | `status, expanded_queries, cost_usd, finished_at` |
| `research_outputs` | insert (`RETURNING *`; tablo düzeyi select var), update (`verify`) | `request_id, output, bibtex, apa, model`; update `output, bibtex, apa` |
| `citations` | insert (`return=minimal`), update (`verify`) | insert yetkisindeki 14 sütun; update `crossref_status, status, removed_reason, title_similarity, verified_at` |
| `instructor_alerts` | insert (`verify`, yalnız `ops`) | `kind, severity, detail, ref, since` |
| `llm_calls` | `CostLedger` | ledger'ın yetkili sütunları |

Yeni RPC ya da yetki gerekmedi; tek RPC `check_spend`'tir (`CostLedger` üzerinden).

## Hata kodları

`OGR-KITAP-001` istek yok · `002` istek durumu uygun değil · `003` aday yok / sorgu genişletme yetersiz · `004`
doğrulanmış kaynak yok · `005` sentez boş · `006` çıktı sözleşmeye aykırı · `007` BibTeX geçersiz · `008` çıktı yok ·
`009` `--name-hashes` biçimi · `010` Crossref kesintisi · `011` kapı engeli (`GateBlocked.kind`: `disabled`,
`degraded`, `spend`, `monthly_cap`).

## Sapma ve yorum notları

1. **`bibtexparser` 2.1.0.** 1.4.x yalnız kaynak paketidir ve bu ortamda derlenemiyor; 2.x tekerleklidir.
   Doğrulama `parse_string` + `failed_blocks` (kopya anahtar dahil) ile yapılır.
2. **Zotero `pyzotero` olmadan.** Zotero Web API v3 doğrudan `httpx` ile çağrılır (bağımlılık az, `MockTransport`
   ile sınanır); aktarım hatası araştırmayı düşürmez.
3. **`--query` ve `research_enabled`.** Kabul komutu bayrak kapalıyken `--query` ister; `--query` elle (kurucu/
   koordinatör) çalıştırmadır, istek satırı açmaz ve DB'ye çıktı yazmaz. Bayrak öğrenci kuyruğunu (`--queued`,
   `--request`) kapatır; harcama tavanı ve aylık araştırma tavanı `--query`'de de denetlenir.
4. **Geçici harcama engeli.** `check_spend` ücretli çağrıya izin vermiyorsa (ya da degraded kip) satır `queued`
   kalır ve döngü durur (ertesi gece yeniden denenir); engel araştırmanın ortasında gelirse (`OGR-LLM-002`) satır
   `queued`'a döner ve o ana kadarki maliyet `cost_usd`'ye eklenir. `blocked_quota` yalnız aylık araştırma
   tavanı içindir.
5. **`off_topic`.** Sözcük örtüşmesiyle alaka, Türkçe/İngilizce karışık sorgularda güvenilir değil (ör. "matematik" ↔
   "mathematics"); alaka yalnız sıralamada kullanılır, `off_topic` ile atılmaz. `duplicate`, başlığı DOI'li bir
   adayla aynı olan DOI'siz kayıt içindir (DOI'si aynı kayıtlar sessizce birleşir).
6. **Yasaklı kelimeler (ilke 10).** Sentez paragrafı ve matris satırı `tahmin/çıkacak/kesin/garanti` içeremez (liste
   sözleşmelerin `x-forbidden-words` alanından); içeren paragraf yeniden üretilir ya da atılır.
7. **Yıl yok.** Sözleşme yıl ister (1800–2100). DOI'li kayıtta yıl ne Crossref'te ne kaynakta varsa atıf
   `removed(crossref_unresolved)`; DOI'siz kurumsal bağlantılı kayıtta yıl yoksa `removed(no_doi_no_link)` (şemanın
   `removed_reason` listesinde ayrı neden yok).
8. **40 sayfa.** Uzun PDF'in ilk 40 sayfası okunur (atlanmaz); `report.json` okunan/toplam sayfayı yazar.
9. **Sahte Unpaywall gerçek kipte.** `UNPAYWALL_EMAIL` yokken `Runtime` sahte Unpaywall verir; gerçek kipte bu
   durumda açık erişim sorgusu atlanır (`report.oa_skipped`), fixture bağlantıları gerçek atıflara yazılmaz.
10. **Skor formülü.** §6.5'teki `log(atıf+1)/log(max)` aynen uygulanır; en çok atıflı kaydın terimi 1'i biraz
    aşar (`log(max+1)/log(max)`), `max ≤ 1` iken `log(max)` sıfır/tanımsız olduğundan payda `log 2`'dir.
11. **Yeniden üretim tavanı.** §6.5: uymayan **her** paragraf bir kez yeniden üretilir. Maliyet koruması olarak bir
    sentezde en çok `MAX_REGENERATIONS = 6` yeniden üretim çağrısı yapılır (istenen paragraf sayısının üst sınırı;
    kurala uyan bir yanıtta her paragraf bu sınırın içindedir). Tavanı aşan uymayan paragraf atılır.
12. **Hata sonrası satır durumu.** `running`'e geçen satır hiçbir `Exception`'da `running` kalmaz (`failed`; geçici
    harcama engelinde `queued`). `store()` iki yazımdır: `research_outputs` eklendikten sonra `citations` yazımı
    düşerse `batch_worker` çıktıyı silemez ve durumunu değiştiremez; yarım çıktının kimliği hata metnine ve
    `queued_report.json`'a yazılır, eğitmen panelde reddeder. Bayat `running` satırlar (süreç öldürülürse) için
    `research_requests`'te başlama zamanı sütunu olmadığından otomatik geri alma yapılmaz.
13. **`run --queued` çıkış kodu.** Herhangi bir satır `failed` ise 1 (diğer satırlar işlenmiş, rapor yazılmıştır);
    `queued` ve `blocked_quota` 0'dır.
14. **Alarm `ref`'i.** `instructor-alert.ref` sözleşmesinde ve `alerts_dedup` `coalesce`'inde `output_id` anahtarı
    yok; Kitap alarmı `ref = {}` yazar ve çıktıyı `detail`'in başında kısa kimlikle ayırır (sözleşme/SQL boşluğu,
    notlarda).

## Kabul komutu notu

İki kabul komutu yazıldığı gibi, herhangi bir çalışma dizininden 0 ile çıkar; uyarlama gerekmedi. İlk komut
`rapidfuzz`, `pypdf` ve `bibtexparser`'ı PyPI'dan sabit sürümle kurar.
