# @ogrenmen/prompts — sürümlü prompt paketi

Geçidin (`packages/llm`) her rotasına giden sistem metni buradan gelir (docs/PLAN-v2.md §6). Bir prompt üç katmanın
birleşimidir: **ürün** (Öğrenmen nedir, dürüstlük ve kanıt, gizlilik, Türkçe biçim, sadelik) + **rol** (koç, veli
asistanı, analist, içerik yazarı, müfredat yazarı) + **rota** (görevin kendisi). Birleşik metin geçitte `system[0]`
olur ve 1 saat önbelleklenir; ders bloğu `system[1]`, dossier `system[2]`, tarih/mod/sınav ise sondaki
`role:"system"` mesajıdır (packages/llm `prompt.ts`). Bu yüzden prompt metninde tarih ya da kullanıcıya özgü bilgi yoktur.

## Kullanım

```ts
import { loadPrompt } from '@ogrenmen/prompts';

const p = loadPrompt('solution_diagnosis');            // { meta, text, hash, estimatedTokens, parts, selection }
const res = await gateway.call('solution_diagnosis', {
  system: { product: p.text, course, dossier },
  user, turn: { date, mode },
  promptVersion: p.meta.version,                        // llm_calls.prompt_version
});
```

Worker (service_role) sürüm kaynaklarını veritabanından okur:

```ts
import { createPromptResolver, syncPromptVersions } from '@ogrenmen/prompts/db';

const prompts = createPromptResolver(pool, { ttlMs: 60_000 });  // runtime_flags + prompt_versions, kısa önbellek
const p = await prompts.load('coach_chat');
await syncPromptVersions(pool);   // açılışta: paketteki her rota × sürüm → prompt_versions (active=false)
```

| işlev | ne yapar |
|---|---|
| `loadPrompt(route, { version?, sources? })` | sürümü seçer, katmanları birleştirir; `selection` hangi kaynağın seçtiğini söyler |
| `listPromptRoutes()`, `listPromptVersions(route)`, `allPrompts()` | rota ve sürüm listeleri |
| `parseFrontMatter(src)` | front-matter ayrıştırıcı (küçük, deterministik YAML alt kümesi) |
| `selectVersion(route, available, opts)` | saf sürüm seçimi |
| `lintPromptText(text, { toolNames })` | yazım kuralları (aşağıda) |
| `db`: `readVersionSources`, `syncPromptVersions`, `createPromptResolver` | `pg.Pool` uyumlu arayüzle veritabanı köprüsü |
| `eval`: `loadEvalCases`, `runEval`, `scoreDiagnosis`, `scoreCoach` | eval seti ve puanlayıcılar |

**Sürüm seçimi** (öncelik sırasıyla): açık `version` → `runtime_flags['prompt_versions']` (`{"coach_chat":"v1"}`;
admin sabitler ya da geri alır) → `prompt_versions.active` satırı (eval kapısını geçen) → kilitteki rota varsayılanı
(`prompts.lock.json` defaults) → paketteki en yüksek sürüm.
Veritabanının istediği sürüm bu derlemede yoksa çağrı düşmez, sıradaki kaynağa geçilir ve `selection.ignored`'a
yazılır. `runtime_flags` ve `prompt_versions` yalnız admin/service_role okur; apps/web pg kipinde `createPromptResolver`
ile (sunucu havuzu) çözer, bellek kipinde kaynak vermeden çağırır (kilit varsayılanı).

## Rotalar

| rota | sürüm | rol | model · effort | şema | araçlar |
|---|---|---|---|---|---|
| `coach_chat` | v1 | coach | Sonnet · medium | — | get_mastery, get_recent_exams, memory, record_turn_meta, search_evidence |
| `coach_deep` | v1 (`extends: coach_chat/v1`) | coach | Opus · high | — | aynı |
| `solution_diagnosis` | v1 | analyst | Opus · high | solution-diagnosis | — |
| `curriculum_research` | v1 | curriculum_author | Opus · high | — | web_fetch, web_search |
| `curriculum_draft` | v1 | curriculum_author | Opus · high | curriculum-draft | — |
| `memory_delta` | v1 | analyst | Haiku · low | memory-delta | — |
| `conversation_summary` | v1 | analyst | Haiku · low | conversation-summary | — |
| `suggestions_copy` | v1 | generator | Haiku · low | notification-copy | — |
| `parent_chat` | v1 (iskelet) | parent_agent | Sonnet · low | — | get_child_summary, get_exam_sessions, get_mastery_overview, get_recent_activity, get_reports, request_report |

Model, effort, şema ve araçlar geçidin rota tablosuyla (`packages/llm/src/routes.ts`) birebir aynı olmalıdır;
`test/routes.test.ts` denetler.
Müfredat iki adımdır, çünkü yapılandırılmış çıktı Citations ile birlikte verilemez: `curriculum_research` web'de
araştırıp atıflı not yazar, `curriculum_draft` bu notu araçsız `curriculum-draft` biçimine çevirir.

## Dosya yapısı

```
<rota>/<sürüm>.md            front-matter + Türkçe gövde (ör. coach_chat/v1.md)
src/layers/product.v1.md     ürün katmanı
src/layers/roles/<rol>.v1.md rol katmanları
src/bundle.gen.ts            ÜRETİLMİŞ: tüm .md kaynakları (çalışma anında dosya sistemi okunmaz; Next.js/worker paketlemesi)
prompts.lock.json            ÜRETİLMİŞ: rota@sürüm → sha256 + model/effort/şema/araçlar
eval/<rota>/*.json           eval vakaları; eval/_context/<ders>.course.md ders bloğu kesiti
scripts/build-bundle.ts      gömme + kilit + doğrulama (--check, --relock)
scripts/eval.ts              eval komutu
```

Front-matter alanları: `route` (dizin adı), `version` (dosya adı, `vN`), `model` (tam kimlik), `effort`, `schema`
(packages/contracts kayıt adı ya da `null`), `tools` (ada göre sıralı), `role`, `layers` (`[product.vN,
roles/<rol>.vN]`, sırası önemlidir), isteğe bağlı `extends` (`<rota>/vN`, tek düzey, aynı rol) ve `description`.
Katman sürümleri açıkça yazılır: `product.v2` eklemek eski rota sürümlerinin metnini değiştirmez.

**Yeni sürüm açma:** `coach_chat/v2.md` yaz (katmanı değiştiriyorsan `product.v2.md` gibi yeni katman dosyası) →
`bun run --cwd packages/prompts bundle` → eval → etkinleştirme. Yayımlanmış bir sürümün birleşik metni (katmanları
dahil) değişirse derleme kilit nedeniyle düşer: geçmiş `llm_calls.prompt_version` ve eval puanları o metne bağlıdır.
Henüz yayımlanmamış bir taslağı bilerek değiştiriyorsan `bun scripts/build-bundle.ts --relock`.

## Yazım kuralları

claude-api `shared/prompt-audit.md` ile uyumlu; `src/lint.ts` derlemede ve testte denetler:

- Kural düz cümleyle ve **nedeniyle** yazılır; BÜYÜK HARF baskı dili (MUST, ASLA, MUTLAKA…) yok. Güncel modeller
  sistem metnine çok duyarlıdır; bağırılan kural aşırı uygulanır.
- "Adım adım düşün" gibi iskeleler yok: derinlik rotanın `effort`'udur. Gerekçe çıktıya istenmez (teşhiste
  `reference_solution_steps` bir çözüm alanıdır, düşünce dökümü değil).
- Sıralı adım yalnız sıranın gerçekten önemli olduğu yerde (teşhiste önce bağımsız çözüm, sonra hizalama).
- Örnekler çeşitli ve "örnektir" diye etiketlidir (`Örnek…` ile başlayan satır `örnektir` demek zorunda).
- Sistem metni araçları **adıyla anmaz**; hangi bilgiye ne zaman bakılacağını anlatır. Araç sözleşmesi
  `packages/llm/src/tools.ts` açıklamalarındadır; böylece bir araç kapatılınca metinde boşta gönderme kalmaz.
- Ünlem ve emoji yok (matematik `$…$` dışında); her birleşik metin ≥ 512 token (önbellek eşiği; tahmin karakter/4,
  Türkçede alt sınır gibi davranır, canlı testte `count_tokens` ile ölçülür).

## Eval

`eval/solution_diagnosis/` 5 sentetik vaka (Türkçe el yazısı transkripsiyonu metin olarak: kavram, dikkatsizlik,
okuma, doğru çözüm, süre), `eval/coach_chat/` 3 vaka (ipucu modunda cevap vermeme, mod önerisi, hocana sor).
Her vaka girdi, beklenen alanlar ve `fake_reply` (sahte kip betiği) taşır. Puanlayıcı deterministiktir: teşhiste
verdict, ilk bozulan adım, neden, kazanım, yanılgı etiketi, alt kazanım önerisi, `why_tr` tek cümle ve ünlemsiz;
koçta yasak/gerekli ifadeler, soru sorma, cümle sayısı, yüzde ve ünlem yokluğu, tur kaydı (mod önerisi, eğitmene iletme).

```
OGRENMEN_LLM=fake bun run --cwd packages/prompts eval      # boru hattı + puanlayıcı (hepsi geçmeli; check.sh)
ANTHROPIC_API_KEY=… bun run --cwd packages/prompts eval    # aynı komut gerçek modelle (ücretli)
  --route solution_diagnosis   --version coach_chat=v2   --out rapor.json   --min-score 0.8
```

## Denetim

`bash packages/prompts/check.sh`: bundle:check (gömülü kaynak + kilit + lint + eşik), typecheck, eslint, vitest
(OGRENMEN_LLM=fake), eval (sahte). Canlı kipte (`OGRENMEN_LIVE=1`) geçici bir veritabanında migration DDL'iyle
`prompt_versions` eşitlemesi; anahtar varsa `count_tokens`.

## Açık işler

- `eval_judge` hakemi (Opus, Batch) için prompt ve `eval_runs` yazımı; aktivasyon kapısı (hakem puanı belirgin
  düşerse `prompt_versions.active` açılmaz). `scripts/eval.ts` şimdilik yalnız deterministik puan verir.
- Diğer rotaların promptları (deneme OCR, rapor, not/deneme üretimi, ders analizi, veli bildirimi…) sonraki fazlarda.
- Gerçek çözüm fotoğraflarıyla eval seti (kurucunun ~60 fotoğrafı) geldiğinde `eval/solution_diagnosis` görselli
  vakalarla genişler; şu an girdi yalnız metin transkripsiyonudur.
