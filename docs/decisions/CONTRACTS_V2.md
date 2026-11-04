# Aura v2 — Paylaşılan sözleşmeler (T0, Sprint 1)

**4 Kasım 2026 · dal `claude/lucid-fermi-lclsev`.** Kaynak önceliği: `AURA_KARARLAR_2026-11-03.md` (KB) > `PLAN_V2_2026-11-04.md` > bu belge > `docs/SPEC.md` / `CLAUDE.md`. Bu belge üç paralel izin (W1 ödeme öncesi akış, W2 paywall/açılış, W3 motor) kod yazacağı **tipleri, sütun adlarını, env değişkenlerini, tr.json ad alanlarını, API biçimlerini ve kilit kurallarını** sabitler. Burada olmayan bir şeyi uydurma: KB'de AÇIK ise yer tutucu bırak ve raporla.

Değişmeyen sert kurallar (CLAUDE.md): fotoğraf/landmark hiçbir yere yazılmaz, görsel yalnız `POST /api/analyses` ve `POST /api/tryon`; kilitli değer sunucudan çıkmaz (`null + locked:true`); kalibrasyon herkese aynı; yüz tanıma, yaş/etnik köken/din çıkarımı yok; cerrahi/ilaç/mewing metni yok; Zod her girdide; kota yalnız `reserve_*` SQL; aşağılayıcı dil ve argo yok; 360 px, açık/koyu, erişilebilir.

## 0. Dosya sahipliği (kim neyi yazar)

| İz | Yazar | Yalnız okur |
|---|---|---|
| **W1** ödeme öncesi (F02/F03/F05/F06/F08) | `app/(app)/baslangic/*`, `components/auth/*`, `components/onboarding/*`, `components/camera/*`, `components/analysis/{ScoreView,ScoreHero,SubscoreList,ImproveFirstCard,MeasurementsCard,LockedPlanPreview,LandmarkPortrait,AnalysisProgress}.tsx`, `lib/face/{quality,faceShape,metrics,overlay,sessionStore}.ts`, `lib/api/analysisClient.ts`, `app/api/onboarding/*`, `content/legal/*`, `lib/consent.ts`, `tr.json`: `onboarding.*`, `auth.signIn.*`, `camera.*`, `analysis.locked.*`, `analysis.faceShapeV2.*` | `lib/face/views.ts`, `lib/api/analysesInput.ts`, `lib/score/present.ts` |
| **W2** paywall + açılış (F14) | `components/paywall/*`, `components/analysis/RevealSequence.tsx`, `app/api/billing/offer/*`, `app/api/referral/*`, `lib/referral/*`, `lib/billing/{entitlement,purchases}.ts`, `tr.json`: `paywall.v2.*`, `analysis.stage.*`, `analysis.reveal.*` | `lib/config/plans.ts` (PRODUCTS), `lib/config/flags.ts`, `lib/score/present.ts` (`AccessV2`), migration 0010 (offers, referrals, purchases) |
| **W3** motor (F07) | `lib/ai/prompts/{score.v2,audit.v1}.ts`, `lib/ai/{scoreSchema.v2,audit}.ts`, `lib/ai/provider.ts` (`ClaudeScoringProvider`), `lib/score/engine/{consensus,h2}.ts`, `lib/score/calibration.ts` (h2), `lib/score/setKey.ts`, `app/api/analyses/route.ts`, `app/api/analyses/[id]/**`, `lib/score/service.ts`, `lib/config/ai.server.ts` (hybrid.v2), `lib/ai/safety.ts`, `tr.json`: `analysis.explain5.*` kullanımı | `lib/config/engine.h2.server.ts`, `lib/score/contract.ts`, `lib/score/present.ts` |
| **T0 (bu)** | `lib/config/{teaser,scoring,flags,plans,engine.h2.server}.ts`, `lib/face/views.ts`, `lib/api/analysesInput.ts`, `lib/score/{contract,present,rowColumns}.ts`, `supabase/migrations/0010_v2_core.sql`, `lib/db/types.ts` (geçici ayna), `messages/tr.json` (ad alanları), bu belge | — |

Paylaşılan dosyayı değiştirmek gerekirse: önce burada sözleşmeyi güncelle, sonra kodu; diğer izleri bilgilendir.

## 1. Alt skor anahtarları ve motor adları

`lib/config/teaser.ts`:

```ts
SUB_KEYS_V1 = ["harmony","eyes","jawline","skin","hair","grooming"]   // legacy + hybrid.v1
SUB_KEYS_V2 = [...SUB_KEYS_V1, "brows"]                               // hybrid.v2 (KB R1-W5: kaş ayrı alt skor)
type SubKey   = (typeof SUB_KEYS_V2)[number]                           // 7 anahtar; her Record<SubKey,…> brows ister
type SubKeyV1 = (typeof SUB_KEYS_V1)[number]                           // eski motor iç tipleri
SUB_KEYS = SUB_KEYS_V1                                                 // geriye uyumlu liste (eski arayüz ve teaser)
```

- Eski motor kodu (`lib/score/{aggregate,potential,service}.ts`, `lib/score/engine/*`, `lib/config/engine.server.ts`) `SubKeyV1` ile yazılıdır; dokunma.
- `lib/config/scoring.ts`: `SCORE_ENGINES = ["legacy","hybrid.v1","hybrid.v2"]`; `SUB_KIND`/`SUB_KIND_HYBRID` brows = `"modifiable"`. `scoreEngineBlocked` legacy dışındaki her motoru üretim kapısına sokar.
- `lib/score/contract.ts`: `ENGINE_NAMES = ["hybrid.v1","hybrid.v2","legacy"]`; `engineOf(row)` `engine_version` sütunundan.
- Ekranda "Yapısal / Geliştirilebilir" rozetleri **v2'de gösterilmez** (KB P#10/P#11, §4.9); `kinds` yalnız içeride (sıralama) kullanılır. `analysis.kind.*` anahtarları v1 ekranı için duruyor.
- `lib/config/ai.server.ts getAiEnv().scoreEngine` hâlâ `hybrid.v1 | legacy` okur; **W3** buraya `hybrid.v2` ekler ve `prepareScoring`/`scoreAnalysis`'i bağlar. O zamana kadar `SCORE_ENGINE=hybrid.v2` legacy'ye düşer (dağıtım nötr).

## 2. Girdi: `POST /api/analyses` (`lib/api/analysesInput.ts`, `lib/face/views.ts`)

### 2.1 Görünümler (`lib/face/views.ts`)

| key | zorunluluk | kırpım | JPEG | ham tavan | geometri | yaw aralığı (mutlak °) |
|---|---|---|---|---|---|---|
| `front` | zorunlu | 768 px | 0,85 | 600 KB | **evet** (tek kaynak) | 0–15 |
| `profile_left` / `profile_right` | gruptan en az biri (`full` modunda) | 640 px | 0,80 | 400 KB | hayır | 60–100 |
| `left45` / `right45` | isteğe bağlı | 640 px | 0,80 | 400 KB | hayır | 25–60 |
| `hairline` | isteğe bağlı | 640 px | 0,80 | 400 KB | hayır | 0–20 |

- `TOTAL_IMAGE_MAX_BYTES = 3 000 KB` ham (base64 ≈ 4,1 MB; Vercel gövde sınırı ~4,5 MB).
- `checkViewSet(views, mode)`: `device_only` → yalnız `front`; `full` → `front` + en az bir profil. Tekrar ve bilinmeyen görünüm reddedilir.
- `classifyView(yawDeg)` → `front | left45 | right45 | profile_left | profile_right | null("between"|"invalid")`. **Yaw işareti varsayımı:** `YAW_POSITIVE_SIDE = "left"` (pozitif yaw = kullanıcının sol yanağı kameraya bakar). **W1** `/debug/landmarks` ile doğrular; tersse yalnız bu sabiti çevirir.
- Profil fotoğrafı ödeme öncesi "gerçekten profil mi" diye doğrulanmaz (KB P#4 Claude notu); yalnız tek yüz/okunabilirlik. Ödeme sonrası uygun değilse yeniden çekim istenir (W3 `failure.code = "CAPTURE_QUALITY"`, `retryable: true`).
- Etiketler: `camera.views.<key>.{name, instruction, optionalNote?}`; `camera.views.{stepLabel, optionalLabel, profileRequiredNote, addOptional, pickFromGallery, done}`.

### 2.2 Gövde ve normalizasyon

Ham gövde (`AnalysisInputRaw`, Zod):

```ts
{
  clientRequestId: uuid,
  geometry: GeometrySchema,                        // yalnız ön fotoğraf; 478 nokta yok (değişmedi)
  mode?: "device_only" | "full",                   // yoksa: images varsa "full", yoksa "device_only"
  images?: { view: ViewKey; data: base64 JPEG }[], // ≤ 6, görünüm başına tavan, toplam tavan
  image?: string,                                  // ESKİ istemci: tek ön selfie (images ile birlikte olamaz)
  sourceHashes?: string[]                          // sha256 hex (64), ORİJİNAL dosyaların; images ile aynı sayı ve sıra
}
```

Kurallar: `device_only` modunda görsel **gönderilmez** (images boş/yok; `image` yasak); `sourceHashes` tek başına gönderilebilir (set önbelleği ön kontrolü). `full` modunda `checkViewSet` + bayt tavanları + `sourceHashes.length === images.length`.

Normalize biçim (`AnalysisInputSchema = AnalysisInputRaw.transform(normalizeAnalysisInput)`; rotaya giden tek tip):

```ts
type AnalysisInput = {
  clientRequestId: string; geometry: GeometryResult;
  mode: "device_only" | "full";
  images: ImageItem[];           // sıra korunur; device_only'de []
  sourceHashes: string[] | null; // images ile aynı sıra; yoksa null (önbellek kullanılmaz)
  legacy: boolean;               // eski { image } gövdesi → images [{front}], mode "full", legacy true; profil şartı yok
}
```

`decodeImages(images)` her görünümü görünüm tavanıyla çözer; hata `{ error, view }`. Görseller yalnız bellekte; AI sağlayıcısına gider, bırakılır.

**Bugünkü rota davranışı (T0):** `legacy:true` gövde eski motorla aynen çalışır; v2 gövde (`images[]`) şemada kabul edilir ama rota `BAD_INPUT "Çoklu açı analizi henüz açık değil."` döner. **W3** rotayı §2.3'e göre yazar. Mobil bir sürüm boyunca `image` takma adını kullanmaya devam eder (PLAN M9).

### 2.3 Akış ve kota (W3 + W2)

1. **Ödeme öncesi** `POST /api/analyses { mode:"device_only", geometry, sourceHashes? }` → `reserve_analysis(p_user, clientRequestId, p_limit (önemsiz), p_since, 'device_only')` → satır `status='device_only'`, `device_result = deviceResultFromGeometry(geometry)`, `face_shape`, `geometry`, `sections_ready=["device"]`, `set_key` (hash'ler geldiyse). Kota **sayılmaz**, LLM **çağrılmaz**. Yanıt `200 ClientAnalysisV2` (stage `device_only`).
2. **Ödeme** (W2): `purchases` satırı `paid` (webhook/sunucu doğrulaması; tarayıcıdan gelen "başarılı" açmaz). Tek seferlik rapor: `purchases.analysis_id` bu analize yazılır (tekil indeks).
3. **Ödeme sonrası** `POST /api/analyses { clientRequestId (aynı), mode:"full", images[], sourceHashes? }` → `promote_analysis(p_user, analysisId, p_limit, p_since)` (device_only → queued; kota burada sayılır; dolu ise `QUOTA_EXCEEDED`) → yanıt `202 ClientAnalysisV2` (stage `queued`) → aynı çağrı içinde (`after()` / waitUntil; görseller yalnız bu çağrının belleğinde) motor çalışır: `running` → kartlar hazır oldukça `sections_ready` güncellenir → `completed` (`overall, potential, subscores, score_range, percentile, signals, runs, calibration_version='h2', engine_version='hybrid.v2', prompt_version='score.v2', scoring_model`) → rapor `coach_reports` (`prompt_version='report.v3'`). Hata → `failed` + `signals.failure`; hak düşmez (kota failed saymaz); istemci yeniden gönderir.
   - `maxDuration` plan sınırına göre (Vercel Pro 300 s); süre sınırı yok ama `fail_stuck_jobs` 2 saatte takılı sayar.
   - İlk ödeme öncesi analiz olmadan doğrudan `full` gelirse: `reserve_analysis(..., 'queued')` ile aynı kota kuralı.
4. **Yoklama** `GET /api/analyses/[id]` → `ClientAnalysisV2` (rota `AccessV2` hesaplar, §3.4). İstemci `stage` ve `sectionsReady` ile kart kart açar (W2 `RevealSequence`).
5. **Set önbelleği** (`lib/score/setKey.ts`, W3): `set_key = HMAC-SHA-256(SET_CACHE_SECRET, hashes.slice().sort().join("\n"))` hex. `analysis_sets` satırı varsa ve `expires_at > now()` ise saklı `scores` kopyalanır, model çağrılmaz (Ç11). Secret yoksa önbellek kapalı. Kamera çekimi her zaman yeni settir; eşleşme yalnız galeriden gelen orijinal dosyalarda.

Hak kaynakları (`AccessV2.entitled`, W2 `lib/billing/entitlement.ts`): `purchases(product='one_time_report', status='paid', analysis_id = this)` **veya** `purchases/subscriptions` aktif abonelik (analiz oluşturulurken ya da şimdi). `referralUnlock`: `FEATURE_REFERRAL_UNLOCK=true` ve `referrals where referrer_id = user and photo_submitted_at is not null` sayısı ≥ 5. `percentile`: `FEATURE_PERCENTILE=true`.

Hata kodları (mevcut `lib/api/errors.ts`): `BAD_INPUT` (şema; görünüm/bayt sebepleri mesajda: `view_set_profile_missing`, `image_too_large_<view>`, `images_total_too_large`), `IMAGE_TOO_LARGE`, `QUOTA_EXCEEDED` (+`retryAt`), `PREMIUM_REQUIRED` (full modunda hak yok), `CAPTURE_QUALITY`, `NO_FACE`, `AI_*`.

## 3. Çıktı: `ClientAnalysisV2` (`lib/score/contract.ts`, `lib/score/present.ts`)

### 3.1 Sözlük (`lib/score/contract.ts`)

```ts
ANALYSIS_STATUSES = ["device_only","queued","running","processing","completed","failed"]  // DB
ANALYSIS_STAGES   = ["device_only","queued","running","completed","failed"]               // istemci; processing→running
SECTION_KEYS      = ["device","overall","subscores","potential","faceShape","explanations","improveFirst","report"]
REGION_KEYS       = ["brows","eyeArea","nose","lipsSmile","cheeks","jawline","skin","hair","beard"]   // KB §5/2
MEASURE_KEYS      = ["canthalTiltDeg","jawRatio","fwhr","thirds"]

DeviceResult   = { ratios:{canthalTiltDeg,jawRatio,fwhr,thirds:{upper|null,middle,lower}}, faceShapePrelim:{primary,secondary?,confidence} }
ScoreRange     = [lo, hi]                       // tek ondalık, değer içinde
ScoreV2        = { value, range }
OverallV2      = { value, range: ScoreRange|null, percentile: number|null }
PotentialV2    = { value, range, delta }        // delta = round1(max(0, potential−overall)); ≤ 1,5; value ≤ 9,5
ExplanationV2  = { lookedAt: string[≤3], held: string[≤3], lowered: string[≤2], raise: {step,effect}[≤3], confidenceNote }   // KB §4.9
ImproveItemV2  = { sub: SubKey, stepId, step, gain }                                       // ≤ 3 (P#13)
ReportV3       = { version:"report.v3", letter, regions:{key:RegionKey, strength, seen, improvements: string[≤2]}[], measures:{key:MeasureKey, value, balancedRange:[lo,hi]}[], closing }
FaceShapeV2    = { prelim, detailed?:{shape,secondary?,reason}, agree: boolean|null, override?: FaceShape }
ClientSignalsV2= { engine:"hybrid.v2", explanations: Partial<Record<SubKey,ExplanationV2>>, improveFirst, notAssessed:{sub,reason}[], faceShapeDetailed|null, captureHints, viewsUsed: string[] }
AnalysisFailure= { code: "AI_FAILED"|"AI_TIMEOUT"|"AI_SAFETY_BLOCKED"|"NO_FACE"|"CAPTURE_QUALITY", retryable }
```

`analyses.signals` (v2) = `ClientSignalsV2` + sunucu kısmı (`v:2, runs özeti, raw, structuralSource, model, audit`); istemciye yalnız `ClientSignalsV2.safeParse` ile geçen kısım gider.

### 3.2 Yanıt (`ClientAnalysisV2`)

```ts
{
  id, engine:"hybrid.v2", stage, createdAt, calibrationVersion,
  device: DeviceResult | null,                                  // HER ZAMAN açık (P#12)
  overall:      Locked<OverallV2|null>,
  subscores:    Record<SubKey, Locked<ScoreV2|null>>,          // 7 anahtar
  potential:    Locked<PotentialV2|null>,
  explanations: Record<SubKey, Locked<ExplanationV2|null>>,
  report:       Locked<ReportV3|null>,
  faceShape:    FaceShapeV2 | null,                             // prelim ve override her zaman; detailed/agree yalnız açıkken
  improveFirst: Locked<ImproveItemV2[]|null>,
  sectionsReady: SectionKey[],                                  // ödeme öncesi ["device"]
  noiseBand: 0.3,
  notAssessed: {sub,reason}[], captureHints, viewsUsed: number,
  failure: AnalysisFailure | null                               // yalnız stage failed
}
```

`Locked<T>` üç hâl: `{value, locked:false}` açık · `{value:null, locked:true}` **kilitli yer tutucu (sabit; gerçek değerden türemez)** · `{value:null, locked:false}` yok / değerlendirilmedi / henüz hazır değil.

### 3.3 Sunucu satırı (`AnalysisRowV2`, `ANALYSIS_ROW_COLUMNS_V2`)

`id, status, created_at, face_shape, overall, potential, subscores, gains, observations, geometry, calibration_version, prompt_version, engine_version, signals, device_result, score_range, percentile, sections_ready, set_key` + rota ekler: `report` (coach_reports.report), `face_shape_override` (profiles), `failure`. **`runs` ve `ai_usage` istemci yoluna seçilmez.**

`score_range` jsonb: `{ overall:[lo,hi], potential:[lo,hi], subscores:{ harmony:[..], …, brows:[..] } }`. `percentile` numeric → PostgREST metin dönebilir; present sayıya çevirir.

### 3.4 Kilit kuralları (`toClientAnalysisV2(row, access)`; testler `tests/unit/presentV2.test.ts`)

| Durum | device | overall | subscores | potential | explanations | report | improveFirst | faceShape.detailed | sectionsReady |
|---|---|---|---|---|---|---|---|---|---|
| `device_only` / `queued` / `running` / `failed` | açık | kilitli | kilitli | kilitli | kilitli | kilitli | kilitli | yok (agree null) | `["device"]` |
| `completed`, hak yok | açık | kilitli | kilitli | kilitli | kilitli | kilitli | kilitli | yok | `["device"]` |
| `completed`, **referralUnlock** (hak yok) | açık | `{value, range:null, percentile:null}` | kilitli | kilitli | kilitli | kilitli | kilitli | yok | `["device"]` |
| `completed`, **entitled** | açık | `{value, range, percentile?}` | `{value, range}` | `{value, range, delta}` | açık | açık | açık | var; `agree = detailed.shape === prelim.primary` | satırdaki liste |

- Hazır olmayan ya da aralığı eksik alan: `{value:null, locked:false}` (yarım değer gitmez).
- `notAssessed.reason="excluded"` alt skor herkese `{null, locked:false}` ve öncelik listesinden düşer; `"not_visible"` yalnız açık sonuçta listelenir.
- `percentile` yalnız `access.percentile` (FEATURE_PERCENTILE) ve yalnız `overall`'da (Ç6). Alt skorda yüzdelik yok.
- `faceShape.override` (profiles.face_shape_override) herkese açık; prelim asla sessizce değişmez (Ç8).
- v1 sunumu (`toClientAnalysis`) 7 anahtar döner; v1 satırda `brows` = `{null, locked:false}` (değerlendirilmedi).

## 4. Motor yapılandırması (`lib/config/engine.h2.server.ts`, yalnız sunucu)

| Sabit | Değer | Env |
|---|---|---|
| `ENGINE_H2` | `{ version:"hybrid.v2", promptVersion:"score.v2", calibrationVersion:"h2" }` | — |
| `STRUCTURAL_SOURCES` / `getStructuralSource()` | `claude | geometry | blend`, varsayılan **blend** | `STRUCTURAL_SOURCE` |
| `BLEND_CLAUDE_WEIGHT` | 0,5 (uyum, göz, çene: 0,5 Claude cetveli + 0,5 geometri bant puanı aynı ölçekte) | — |
| `CALIBRATION_H2_DEFAULT` / `getCalibrationH2()` | `{ center:5.5, sd:1.5, min:1.0, max:9.8 }` | `CALIBRATION_H2_CENTER` (3–8), `CALIBRATION_H2_SD` (0,5–3) |
| `CONSENSUS` | `{ runs:3, extraRunIfSpread:0.5, maxRuns:4 }` — alt skor bazında ortanca; herhangi bir alt skorda yayılım > 0,5 ise 4. çalıştırma, 4'ün ortancası; metin ortancaya en yakın çalıştırmadan | — |
| `POTENTIAL_H2` | `{ maxAboveOverall:1.5, absoluteMax:9.5 }`; her kazanç bir plan adımına (`ImproveItemV2.stepId`) bağlı | — |
| `NOISE_BAND` | 0,3 (`ClientAnalysisV2.noiseBand`; ilerleme "değişim yok") | — |
| `SUB_WEIGHTS_H2` | hybrid.v1 ağırlıkları + brows 0,06, toplam 1 (harmony 0,1415 · eyes 0,0943 · jawline 0,1415 · skin/hair/grooming 0,1887 · brows 0,0566) | — |
| `SET_CACHE_DAYS` | 365 | `SET_CACHE_SECRET` (HMAC) |

Kalibrasyon h2 (W3, `lib/score/calibration.ts`): ham cetvel puanı → z (referans sette) → `center + z·sd` → clamp → round1; yüzdelik = normal CDF (yalnız overall, bayrakla). Referans set gelene kadar z, cetvelin yayımlanan 5 çapasıyla hesaplanır (W3 belgeler). Herkese aynı (K1).

İstem kuralları (W3 `score.v2`): beden/boyut/şekil eleştirisi yok; yapısal bölgelerde **tarif et, yargılama** (Ek B dili); etnik köken, din, yaş, kimlik çıkarımı yok; hastalık adı yok (yalnız `seeProfessional` kalıbı); "YZ tahmini" notu her skor ekranında (`analysis.scoreNote`). Bağlam: yaş bandı, sunum, cihaz oranları (`device_result`), ön yüz şekli. Anket skoru değiştirmez.

Claude SDK notları (W3; kod yazmadan önce `claude-api` skill'i): `claude-opus-5-5` temperature/top_p/top_k almaz, prefill ve zorunlu `tool_choice` yok; yanıt thinking bloğuyla başlar → ilk **text** bloğu okunur; `output_config { effort, format:{type:"json_schema", schema} }`; `stop_reason` refusal/max_tokens kontrolü. Mevcut yardımcılar: `getAnthropic()`, `toAnthropicJsonSchema()`, `readJsonText()`, `classifyAnthropicError()`, usage/cost (`lib/ai/anthropic.ts`).

## 5. Veritabanı (migration `0010_v2_core.sql`; yerel; push onay ister)

**profiles** (+): `age_band text` ∈ `under_18 | 18_24 | 25_34 | 35_49 | 50_plus`; `under_18 boolean` (generated = `age_band = 'under_18'`, yazılamaz); `presentation text` ∈ `male | female | unspecified`; `face_shape_override text` ∈ yüz şekilleri. Grant: `authenticated` kendi `presentation`, `face_shape_override` (ve eski `questionnaire`, `locale`) sütununu günceller; `age_band` yalnız service role (yaş uç noktası).

- **Yaş** (W1): `POST /api/onboarding/age { ageBand }` → `age_band` + `is_adult = ageBand !== "under_18"`. `under_18` seçimi `FEATURE_UNDER_18=false` iken `FEATURE_DISABLED` ve "yakında" ekranı (`onboarding.age.under18Soon*`); `birth_year` artık sorulmaz (sütun kalır). `withGuard requireAdult` değişmez (`is_adult`); 18 altı açıldığında `requireAdult` yerine `under_18` kısıtları (doktor katmanı, yağ oranı, oruç) gelir — bu sprintte kapalı.
- **Sunum** (W1): tek kaynak `profiles.presentation`; anket (ödeme sonrası) artık sormaz. Okuma: `profiles.presentation ?? questionnaire.presentation ?? "unspecified"` (eski kayıtlar 0010'da bir kez taşındı). `analysisContextFromQuestionnaire` W3'te buna göre güncellenir.

**analyses** (+): `status` kümesi `device_only | queued | running | processing | completed | failed`; `sections_ready jsonb '[]'`; `set_key text`; `device_result jsonb`; `score_range jsonb`; `percentile numeric(5,2)`; `runs jsonb` (yalnız sayı; istemciye gitmez). Tarayıcı politikası yok (değişmedi).

**analysis_sets** `(set_key pk, user_id, scores jsonb, model, prompt_version, calibration_version, created_at, expires_at = now()+365d)`; **offers** `(user_id pk, started_at, expires_at, promo_product, regular_product)`; **referrals** `(id, code, referrer_id, referee_id unique, photo_submitted_at, created_at)`; **purchases** `(id, user_id, product ∈ one_time_report|weekly|monthly|yearly, analysis_id null (tekil), provider, status ∈ pending|paid|refunded|failed, created_at)`. RLS: sahip okur (`auth.uid()`), yazma yalnız service role.

**RPC:** `reserve_analysis(p_user, p_client_request_id, p_limit, p_since, p_status default 'processing')` — `device_only` kota saymaz/takılmaz; kota `queued|running|processing|completed` sayar; geçersiz başlangıç durumu hata. `promote_analysis(p_user, p_analysis_id, p_limit, p_since) → boolean` (device_only → queued; kota burada). `fail_stuck_jobs` queued/running 2 saat; `purge_expired_analysis_sets` günlük cron. Yerel Postgres 16'da 0001→0010 zinciri ve kota senaryoları doğrulandı (T0 raporu).

**Tipler:** `lib/db/types.ts` geçici el yazımı ayna (`ProfilesV2Columns`, `AnalysesV2Columns`, `DatabaseV2Mirror`), yalnız `import type`; 0010 uygulanınca `pnpm db:types` üzerine yazar.

## 6. Bayraklar, ürünler, haklar

**`lib/config/flags.ts`** (hepsi kapalı; yalnız `"true"` açar): `under18 → FEATURE_UNDER_18`, `percentile → FEATURE_PERCENTILE`, `doctorLayer → FEATURE_DOCTOR_LAYER`, `referralUnlock → FEATURE_REFERRAL_UNLOCK`, `yearlyPlan → FEATURE_YEARLY_PLAN` (+ eski `expertNetwork`, `weekPass`, `providerNames`).

**`lib/config/plans.ts`** — eski `PLANS`, `ENTITLEMENTS`, `PlanId`, `SUBSCRIPTION_PLAN_IDS`, `DEFAULT_PLAN_ID`, `weeklyEquivalentTry`, `formatTry` **aynen kalır** (checkout, RevenueCat, kota bunları kullanır). Yeni:

- `PRODUCT_IDS = ["one_time_report","weekly","monthly","yearly"]`, `PRODUCTS[id] = { id, kind:"one_time"|"subscription", periodDays, featureFlag, providerRefEnv:{regular,promo}, grants }`.
- `grants`: `one_time_report → { analysesTotal:1, reports:1, reportRegens:0, tryons:0 (AÇIK) }`; abonelikler `{ analysesPerWindow:1, windowDays:7, reportRegens:0, tryonsPerWindow:10 }`. Ücretsiz rapor yeniden üretimi yok (Ç10).
- Fiyat: `getProductPrice(id, env) → { regularTry|null, promoTry|null, placeholder }`; env `PRODUCT_PRICE_<ID>_TRY`, `PRODUCT_PROMO_PRICE_<ID>_TRY`. Yer tutucu: tek seferlik ve tanıtımlar `null` (paywall `paywall.v2.pricePending` gösterir, satış yapılmaz); abonelikler SPEC 5.1 değerleri. **Kurucu kararı gelene kadar fiyat uydurulmaz.**
- `listedProducts(env)`: yıllık yalnız `FEATURE_YEARLY_PLAN`; sıra `PRODUCT_ORDER`.
- `OFFER = { durationHours:24, placeholder:true }`, `getOfferDurationHours(env)` (`OFFER_DURATION_HOURS`). Teklif sunucuda (`offers`), kullanıcı başına bir kez, sıfırlanmaz; süre bitince gerçekten normal ürün kimliği (sahte sayaç yasak).
- `ENTITLEMENTS_V2 = { deviceOnly:{ analyses:"unlimited", quotaCounted:false }, referral:{ invitesRequired:5, unlocks:"overall_only" } }`.
- iyzico/RevenueCat ürün kimlikleri env: `IYZICO_PRODUCT_ONE_TIME_REPORT_REF`, `…_PROMO_REF`, `IYZICO_PLAN_{WEEKLY,MONTHLY,YEARLY}_PROMO_REF` (+ mevcut `_REF`). `subscriptions.plan` check kümesi değişmedi.

## 7. `messages/tr.json` ad alanları

| Ad alanı | İz | İçerik |
|---|---|---|
| `common.aiGenerated` | T0 | **"Aura ile oluşturuldu · YZ simülasyonu"** (K16); `tryon.consent.b4`, `tryon.afterAlt`, `content/legal/kullanim-kosullari.md`, SPEC satırları güncellendi |
| `auth.signIn.*` | W1 | `title, body, google, apple, email, emailNote (AÇIK), legalNote, error, cancelled` |
| `onboarding.age.{bandTitle, bandDescription, bands.<band>, under18SoonTitle, under18SoonBody}` | W1 | bantlar: `under_18, 18_24, 25_34, 35_49, 50_plus` |
| `onboarding.gender.{title, description, options.{male,female,unspecified}, continue}` | W1 | |
| `camera.views.*`, `camera.qualityPrompt.{title, body, yes, no}` | W1 | pop-up metni KB §3.1 birebir |
| `analysis.sub.brows` = "Kaşlar" | W1/W3 | 7. alt skor |
| `analysis.scoreNote`, `analysis.competitorsNote`, `analysis.rangeLabel {lo,hi}`, `analysis.percentile {p}`, `analysis.noChange {band}` | W2/W3 | |
| `analysis.explain5.{lookedAt, held, lowered, raise, confidenceNote, structuralNote}` | W3 | KB §4.9 beş satır |
| `analysis.locked.{ringAria, subBarAria, ratiosNote, firstStepsTitle, planPreviewTitle, faceShapePrelim, deviceDone, unlockBody}` | W1 | kilitli ekran; `ratiosNote` KB P§1 birebir |
| `analysis.faceShapeV2.{prelim, detailed, unsure, agree, notMe, pickOwn, overrideNote}` | W1/W3 | Ç8 |
| `analysis.stage.{device_only, queued, running, failed, retry}`, `analysis.reveal.{cardReady, waiting}` | W2 | kart kart açılış |
| `paywall.v2.*` | W2 | `title, benefitsTitle, benefits.b1–b4, illustrativeLabel, offerTitle, offerEnds {time}, offerEnded, products.<id>.{name,note}, pricePending, regularPrice {price}, promoPrice {price}, cta, paidNote, referral.{title, body, progress {done,total}, code, share}` |

Korunan e2e metinleri: `camera.guide.open = "Kamerayı aç"`, `analysis.start = "Analizi başlat"`, `analysis.unlock = "Kilidi aç"`. `tests/unit/messagesTone.test.ts` yeni ad alanlarını yürür; yalnız iki KB kalıbı ("sonuç zayıf olabilir", "iyi ya da kötü anlamı taşımaz") BANNED'den muaftır. "Ücretsiz/bedava" sözü paywall'da yok (R2-Ö5). "Yapısal / Geliştirilebilir" rozetleri v2 ekranlarında kullanılmaz.

## 8. Analitik ve gizlilik (tüm izler)

- Olaylar `lib/analytics.ts` adlarıyla; v2 olayları yalnız açı adları ve sayılar taşır (`views: ["front","profile_left"]`, `count`), skor/metrik/hash/e-posta/görsel asla.
- `sourceHashes` kişisel veri sayılır (KB Ç11): aydınlatma ve açık rıza metinleri W1'de sürüm artışı alır ("birden çok açı", "set hash'i ve skor 1 yıl saklanır").
- Privacy e2e (Faz sonu): görsel yalnız `POST /api/analyses` ve `/api/tryon`; `images[]` gövdesinde 478 nokta yok; ödeme öncesi yanıtta skor yok (`device_only` JSON'unda `"range"`, sayı değeri, `set_key`, `runs` yok — `tests/unit/presentV2.test.ts LEAK`); anonim oturum kalkınca test kullanıcıları `auth.admin.createUser` ile.

## 9. T0'da bilerek yapılmayanlar / AÇIK

1. `lib/config/ai.server.ts` `hybrid.v2` okumuyor; `prepareScoring`/`scoreAnalysis` v1'de. **W3** bağlar.
2. `lib/score/setKey.ts` (HMAC) ve `app/api/analyses/[id]/run` yok; algoritma §2.3'te. **W3**.
3. `AccessV2` hesabı (`purchases`/`subscriptions`/`referrals`) yok. **W2** `lib/billing/entitlement.ts` genişletir.
4. Fiyatlar, teklif süresi, deneme hakları, e-posta ile giriş, yaw işareti: yer tutucu/varsayım; kurucu ve W1 doğrular.
5. `0010` yalnız yerel; `pnpm db:types` push sonrası. `lib/db/types.ts` geçici aynadır (CLAUDE.md "tablo tipleri elle yazılmaz" kuralından bilinçli, geçici sapma; dosya üretilen tiple değiştirilecek).
6. `0004 fail_stuck_jobs` 0010'da yeniden tanımlandı (queued/running 2 saat); SPEC 13.4 satırı buna göre okunmalı.
