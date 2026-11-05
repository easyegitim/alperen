# @ogrenmen/doc-render

Belge oluşturucu (PLAN-v2 §7, detail §4): **belge AST** (`@ogrenmen/contracts` `document-ast`) -> **React** (sunucu) ->
**HTML** (KaTeX sunucu tarafında, fontlar gömülü) -> **PDF** (Playwright Chromium, A4). Worker (PDF işleri) ve uygulama
içi görüntüleyici aynı HTML'i kullanır. Basılı belge: koyu tema yoktur, zemin `--og-paper`, çizgi `--og-navy`.

## API

```ts
import { renderHtml, renderPdf, renderDocumentPdf, closeBrowser } from '@ogrenmen/doc-render';

const html = renderHtml(ast, { theme: 'print', fonts: 'embed', chartData, answerKeys, resolveUploadUrl });
const pdf  = await renderPdf(html, { headerTitle: ast.title });          // Uint8Array
const { html, pdf } = await renderDocumentPdf(ast, { chartData });       // kısayol
await closeBrowser();                                                    // süreç çıkışında
```

| İmza | Anlam |
|---|---|
| `renderHtml(doc: RenderableDocument, opts: RenderHtmlOptions): string` | Tam HTML (doctype dahil), kendi kendine yeter. Aynı girdi -> aynı çıktı. `doc` = `{kind,title,meta,sections,blocks}`; saklanan belge (keys boş) ve model çıktısı uyar. |
| `renderPdf(html: string, opts?: RenderPdfOptions): Promise<Uint8Array>` | A4, `@page` kenar boşlukları, üst bilgi (başlık), alt bilgi ("Öğrenmen", "Sayfa X / Y"), arka plan basılır. Paylaşılan tarayıcı yeniden kullanılır; her belge kendi bağlamında, ağ kapalı (yalnız `data:`/`about:` ve `allowOrigins`). |
| `renderDocumentPdf(doc, opts)` | `renderHtml` + `renderPdf`; `{ html, pdf }` döner. |
| `renderPreviewPng(html)` | Tam sayfa PNG önizleme (görsel karşılaştırma, küçük resim). |
| `getBrowser()` / `closeBrowser()` | Paylaşılan Chromium. Kapanmışsa kendiliğinden yeniden başlar. |
| `templateFor(kind)` | `notes -> 'not'`, `mock_exam`/`question_set -> 'deneme'`, `report -> 'rapor'`. |
| `sanitizeSvg(svg)` | Model SVG'si: betik, `on*`, `foreignObject`, dış `href`/`url()` atılır; kök `<svg` değilse boş. |

`RenderHtmlOptions`:

- `theme: 'print'` (zorunlu; başka değer hata).
- `fonts?: 'embed' | 'none'` (varsayılan `embed`: Lexend 400/500/600/700, JetBrains Mono 400 ve KaTeX woff2 base64 gömülür; dış istek yok). `none` yalnız hızlı önizleme/test içindir.
- `chartData?: Record<string, ChartData>`: `chart` bloklarının `data_ref` adına bağlı veri. Tür uyuşmazsa ya da veri yoksa grafik yerine "Bu grafik için veri yok." yazılır.
- `answerKeys?: KeyRow[]`: **cevap anahtarı yalnız burada verilirse ve belgede `answer_key_page` bloğu varsa çizilir.** `ast.keys` hiçbir zaman okunmaz; öğrenci HTML/PDF'ine anahtar sızamaz (test: canary değer).
- `resolveUploadUrl?: (uploadId) => string | undefined`: `figure.source='upload'` için imzalı adres; yoksa yedek kutu ("Şekil yüklenemedi: alt").
- `skillLabels?: Record<string,string>`: kazanım kodu -> görünen ad (anahtar sayfasındaki "Kazanım haritası"); verilmeyen kod için son parçadan ad türetilir (`tyt.mat.temel.ucgen` -> "Ucgen"), bu yüzden üreten taraf müfredat adlarını geçmelidir.
- `mathOutput?: 'htmlAndMathml' | 'html'` (varsayılan MathML'li, erişilebilir; MathML görünmez, PDF'e basılmaz).

`RenderPdfOptions`: `headerTitle`, `footerLabel` (varsayılan "Öğrenmen"), `footerBadge` (alt bilgi ortasında rozet; `renderDocumentPdf` notlarda "Öğrenmen sana göre hazırladı · tarih" verir), `pageNumbers` (varsayılan açık), `allowOrigins` (varsayılan boş).

PDF çizilirken sayfadan geniş ayrı satır formülleri kapsayıcıya sığacak kadar küçültülür (`fitWideMath`, alt sınır 0,4).

## Bloklar

heading, paragraph (satır içi `$...$`, `$$...$$`), math_display, definition_box, summary_box, worked_example,
common_mistake_callout (kişisel; `meta.generated_on` tarihiyle, `data-pattern-id`), check_yourself (soru gövdede;
**cevaplar belgenin son sayfasında** toplanır), figure (satır içi SVG | `image_url` | upload + alt; `figure_code` çizilmez, worker üretip SVG'yi yazar), table (caption, thead tekrarlı,
satır bölünmez), question (ÖSYM benzeri iki sütun, şıklar A-E, **anahtar gösterilmez**), answer_sheet (optik form),
answer_key_page (yalnız izinli), page_break, chart. Sayfa sonu: soru, kutu, çözümlü örnek, şekil ve grafik bölünmez (`break-inside: avoid`); tablo satırı bölünmez, başlık her sayfada tekrarlanır. Dul/yetim: paragraf `orphans/widows: 3`, başlıklar sonrakiyle kalır,
kutular/sorular/grafikler bölünmez.

### Şekil kaynakları

Öncelik: `svg` (temizlenir) -> `image_url` -> `upload_id` (`resolveUploadUrl`). `image_url` sözleşmede yoktur (sonradan eklenen
alan olarak okunur): yalnız `data:image/(png|jpeg|webp);base64,...` geçer; dış adres yok. Hiçbiri çözülemezse "Şekil yüklenemedi: alt" kutusu çıkar.

## Şablonlar

| Ad | `kind` | Yapı |
|---|---|---|
| `not` | notes | Kapak (rozet "Öğrenmen sana göre hazırladı", ders, tarih, **hedef listesi**: `Hedef...` başlıklı ilk `summary_box` ve hemen öncesindeki başlık kapağa taşınır), gövde (tanım kutusu etiketli, çözümlü örnekte numaralı adımlar, kâğıt zeminli şekil çerçevesi), "Senin sık yaptığın hata" kutusu (uyarı simgesi, `pattern_ref.date` tarihi, "Kaynak: örüntüler.md · tarih" satırı), kendini sına (çalışma alanlı), "Kendi notun" çizgileri, ayrı son sayfada cevaplar; alt bilgide rozet |
| `deneme` | mock_exam, question_set | Kapak (ders, soru sayısı, süre, ad/numara, ÖSYM benzeri yönergeler: soru sayısı/süre, bölümler, optik form, "ÖSYM sınavı değildir"), bölüm bantları, iki sütun sorular (numara lacivert kutuda, şekil kâğıt zeminli çerçevede), optik form, **yalnız `answerKeys` verilirse** anahtar + "Kazanım haritası" (kazanım -> sorular, soru sayısı) sayfası |
| `rapor` | report | Başlık, ilk paragraf **tek cümle özet** (`.lead`), bölüm net çubukları, kazanım ısı haritası, yanlış/boş tablosu (`table` bloğu), "Sonraki adım" kutusu (başlığı `Sonraki adım` ile başlayan `summary_box`) |

## Grafikler (`chart` bloğu, deterministik, yüzdesiz)

`chart_kind` -> `ChartData.kind`: `score_by_section` (`rows:[{label,net,max}]`), `skill_heatmap`
(`rows:[{label,value 0..1,correct?,total?}]`), `mastery_trend` (`points:[{label,value}]`), `time_per_question`
(`rows:[{label,seconds}]`), `error_cause_histogram` (`rows:[{label,count}]`), `style_coverage` (`rows:[{label,value}]`).
Dataviz kuralları: tek renk `--og-primary` dolgu, `--og-line` iz, doğrudan etiket, **kelime bandı** (düşük < 0,4 <= orta
< 0,7 <= yüksek) ve sayı birlikte; ısı haritası `--og-primary-soft` -> `--og-primary` sıralı rampa, hücre yazı rengi
kontrasta göre seçilir; tablo/SVG her zaman erişilebilir (`role="img"`, `<title>`).

## Fixture'lar

`fixtures/documents/` (üreteç: `bun run fixtures`; `fixtures:check` sapmayı yakalar; sözleşme doğrulaması üreteçte):
`not.json` (notes), `deneme.json` (mock_exam, 10 soru + keys[]), `rapor.json` (report, `examReport` geçerli),
`rapor.chartdata.json` (rapor grafik verisi, `data_ref` -> `ChartData`).

## Doğrulama

`bash packages/doc-render/check.sh` (`OGRENMEN_QUICK=1`: PDF testlerinde yalnız deneme). Testler: HTML (KaTeX
HTML+MathML, SVG, tablo, anahtar sızıntısı, rapor bantları, font gömme), Playwright PDF (sayfa sayısı, pdfjs metin
çıkarımı, gömülü font adları, sayfa rasterlerinin `test/baselines/*.png` ile farklı-piksel oranı <= %0,4 toleransı).
Ek testler: not şablonu (kapak hedefleri, kaynak satırı, alt bilgi rozeti), `image_url`/`figure_code` kuralları, anahtar sızıntısı (PDF metni ve baytları), geniş formül sığdırma, 60 satırlık tablo kırılması, kutu bölünmemesi ve **12 sayfalık not < 6 sn** (ısınmış tarayıcı; yerelde ~2,6 sn). Baseline yenilemek: `UPDATE_BASELINES=1 bunx vitest run test/pdf.test.ts` (tasarım/ CSS bilerek değiştiyse; değişen
PNG'ler gözle incelenmeli). Chromium yoksa (`PLAYWRIGHT_BROWSERS_PATH`) PDF testleri SKIP edilir.

## Bilinen sınırlar

- KaTeX glifleri PDF'te gömülü ama metin çıkarımında (pdfjs) formül karakterleri güvenilir çıkmaz; formül doğruluğu HTML
  testleri ve görsel baseline ile korunur.
- `allowOrigins` tam köken eşleşmesidir (`https://host:port`); önek karşılaştırması yoktur. Chromium `--no-sandbox` ile açılır: bu yalnız izole bir worker konteynerinde güvenlidir (model/belge içeriği çizilir). `renderPdf` en çok 2 eşzamanlı çizim yapar ve belge başına 60 sn sınırı vardır.
- SVG temizleyici `<style>` öğesini ve `class` özniteliğini atar; `style` özniteliğinde yalnız boya/çizgi/yazı özellikleri kalır (position, display, visibility, z-index atılır).
- Sayfa numarası/başlık Chromium üst/alt bilgi şablonuyla basılır (sistem sans-serif; Lexend gömülemez).
- Baseline PNG'ler bu ortamın Chromium/yazı tipi çıktısıdır; farklı Chromium sürümünde küçük sapma için tolerans vardır, büyük sapmada yenilenir.
