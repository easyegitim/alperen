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
   - **Ödeme sonrası görsel gönderimi (entegrasyon, 4 Kas):** iyzico yönlendirmesi sekme belleğini sildiği için set yeniden çekilir: sonuç ekranındaki "Çekime dön" → `/tara?analysis=<id>` → `POST /api/analyses/[id]/run { images[], sourceHashes? }`. Rota `device_only` satırı hak + `promote_analysis` ile sıraya alır (kota burada sayılır), `failed`/takılı işi yeniden başlatır, `completed` satırı olduğu gibi döner. `clientRequestId` gerekmez. Hak zaten varsa (abonelik / bağlanmamış ödenmiş rapor) çekim ekranı `device_only` yanıtından hemen sonra aynı seti bellekten `run`'a yollar (`GET /api/billing/status?analysis=` ile). Geometri satırdakidir; cihaz oranları ve ön yüz şekli ödeme sonrası değişmez (KB §4.2/7).
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
| `device_only` / `queued` / `failed`; `running` hak yok | açık | kilitli | kilitli | kilitli | kilitli | kilitli | kilitli | yok (agree null) | `["device"]` |
| `running`, **entitled** (kart kart açılış, KB P#23) | açık | `sections_ready`'de ise açık, değilse `{null, locked:false}` | aynı | aynı | aynı | aynı | aynı | `faceShape` hazırsa var | satırdaki liste |
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
3. `AccessV2` hesabı: tek kaynak `lib/billing/{entitlement,purchases}.ts` (W2); `lib/score/engine/access.ts` yalnız yeniden dışa aktarır (entegrasyon, 4 Kas).
4. Fiyatlar, teklif süresi, deneme hakları, e-posta ile giriş, yaw işareti: yer tutucu/varsayım; kurucu ve W1 doğrular.
5. `0010` yalnız yerel; `pnpm db:types` push sonrası. `lib/db/types.ts` geçici aynadır (CLAUDE.md "tablo tipleri elle yazılmaz" kuralından bilinçli, geçici sapma; dosya üretilen tiple değiştirilecek).
6. `0004 fail_stuck_jobs` 0010'da yeniden tanımlandı (queued/running 2 saat); SPEC 13.4 satırı buna göre okunmalı.

---

## Sprint 2 — Rapor/plan (Faz 4) ve Dene (Faz 5) sözleşmeleri (T1, 4 Kasım 2026)

Kaynak önceliği aynı: KB > PLAN_V2 > bu belge > SPEC/CLAUDE.md. Sprint 1 sözleşmeleri (§0–§9) aynen geçerli; motor (`lib/score/engine/*`, `lib/ai/scoreSchema.v2.ts`, `lib/ai/prompts/score.v2.ts`) bu sprintte **donmuştur** — plan için eksik alan yalnız yeni isteğe bağlı adaptörle eklenir ve `contractDeviation` olarak raporlanır. Bu sprintte motor dosyasına dokunulmadı; eksik alan tespit edilmedi (plan girdileri `ReportV3.regions`, `SignalsV2.observations`, `improveFirst`, `faceShape` ve `device_result` ile karşılanıyor).

### S2.0 Dosya sahipliği

| İz | Yazar | Yalnız okur |
|---|---|---|
| **W4** rapor + plan (F09; PLAN 4a–4g) | `lib/coach/{plan,planBasisV2,generatePlan}.ts` (yeni), `lib/coach/knowledge.ts` (**retrieve sıralamasını iyileştirir; arayüz ve `MethodRecord` değişmez**), `lib/ai/prompts/plan.v2.ts`, `lib/ai/planSchema.v2.ts` (Claude seçim şeması, küçük/düz), `lib/doctor/*`, `app/api/{questionnaire,plan,doctor,links}/*`, `app/(app)/(gated)/plan/**`, `app/admin/doctor/**`, `components/report/*` (v3 iskeleti: mektup, 9 bölge, ölçüler, kapanış), `components/plan/*` (`PlanPhases`, `PriorityTable`, `StepCard`, `BarberCard`, `BasisChips`, `BodyImageScreen`), `components/onboarding/QuestionnaireWizardV2.tsx`, `AvatarPreview.tsx`, `content/methods/` (Sprint 3 TSV), `scripts/import-methods.ts`, `tr.json`: `plan.v2.*`, `report.v2.*`, `questionnaire.v2.*`, `doctor.*` **metin değerleri** (anahtar kümeleri sözleşme) | `lib/coach/planTypes.ts`, `lib/questionnaireV2.ts`, `lib/config/plan.ts`, `lib/score/contract.ts`, `lib/db/types.ts`, migration 0013 |
| **W5** dene (F11; PLAN 5a–5f) | `lib/tryon/mask.ts` (`features_only`, `features_cheeks`, `hair_only`, `beard_only`; `Protect` birliğini `MaskRegion`'a genişletir), `lib/face/indices.ts` (kontur listeleri), `content/beard-presets.ts` (istemler: favori/yanak/boyun adıyla), `lib/ai/prompts/tryon.v2.ts`, `lib/ai/tryonQc.ts`, `lib/ai/tryonProvider.ts` (model `getTryonConfig().imageModel`), `lib/tryon/{composite,pixels,quota,glowUp}.ts`, `app/api/tryon/**` (v2 gövde, QC döngüsü, `flag` rotası), `components/tryon/*`, `scripts/tryon-gate.ts`, `tr.json`: `tryon.v2.*` metin değerleri | `lib/tryon/types.ts`, `lib/api/tryonInput.ts`, `lib/config/tryon.ts`, migration 0014 |
| **T1 (bu)** | `lib/coach/{planTypes,knowledge}.ts` (iskelet), `lib/questionnaireV2.ts`, `lib/config/{plan,tryon,flags}.ts`, `lib/tryon/types.ts`, `lib/api/tryonInput.ts`, `lib/analytics.ts` (olay adları), `supabase/migrations/{0013_v2_plan_doctor,0014_v2_tryon}.sql`, `lib/db/types.ts` (ayna), `messages/tr.json` (ad alanları + KB metinleri), `.env.example`, bu bölüm | — |

Paylaşılan dosyayı değiştirmek gerekirse: önce burada sözleşmeyi güncelle, sonra kodu; diğer izi bilgilendir. `mobile/` bu sprintte dokunulmaz; `lib/`, `content/`, `messages/` değişiklikleri mobil typecheck/lint/test'ten geçmek zorunda (T1'de geçti).

### S2.1 Plan: `PlanV2` (`lib/coach/planTypes.ts`)

```ts
PLAN_PHASES   = ["weeks_0_4","months_1_3","months_3_6"]           // KB §6.1
PLAN_TIERS    = ["diy","expert","doctor"]                           // Kendin yap · Uzman · Doktor
PLAN_AREAS    = ["hair","beard","color","skin","brows","exercise","habit","style"]   // sekmeler
EVIDENCE_LEVELS = ["many_studies","limited_studies","expert_opinion"]; EVIDENCE_FROM_GRADE = { A, B, C }   // KB §6.2 (A/B/C içeride)

StepCard = { id (katalog/yöntem kimliği, kod doğrular), area, phase, tier, title (nötr ad), summary?,
             observationRef: { region: RegionKey, observation? }, costTryRange: {min, max|null}, frequency: {per: once|day|week|month, times},
             minutesPerDay, difficulty 1–3, impact 1–3, effort 1–3, evidence: {level, source?}, perceptionOnly?, tryonPresetId?, barberSpec?, linkIds? }
PriorityRow = { stepId, impact, effort, score = impact/effort }   // buildPriorityTable: azalan; eşitlikte az emek önce
BasisChip   = { key ∈ BASIS_CHIP_KEYS, value?, source: questionnaire|photo|device|profile }   // PLAN §3: her cevap ve fotoğraf gerçeği görünür
PlanV2      = { version:"plan.v2", phases, steps[≤40], priorityTable, basisChips[≤30], layers:{diy,expert,doctor:[]}, exclusions, disclaimers[], meta }
PlanViewV2  = { plan, doctor: { state: DoctorLayerState, steps: StepCard[], disclosure: true }, basisStale }   // sunucu okuma anında kurar
```

Kurallar (`planIssues`, şema `superRefine`; testler `tests/unit/planTypesV2.test.ts`):

1. Plan **kodla** kurulur: Claude yalnız bilgi tabanından kimlik seçer ve gerekçe yazar; bilinmeyen kimlik düşer (`validateMethodIds`), `meta.droppedUnknownIds` sayar. `PlanV2` şeması Claude'a verilmez; W4'ün Claude seçim şeması küçük ve düz olur (≤ 24 isteğe bağlı alan, tüm alanlar zorunlu, min/max yok; sınırlar kodda).
2. **Yapısal alt skorlar plan-nötr:** `STRUCTURAL_REGIONS = eyeArea|nose|cheeks|jawline` bölgesine bağlı adım yalnız `PERCEPTION_AREAS = hair|beard|brows|color|style` alanında ve `perceptionOnly:true` olur (KB §4.9 son iki satır: "bakımla değişmez; saç/sakal/kaş algıyı etkiler"). Cilt/egzersiz/alışkanlık yapısal bölgeye bağlanamaz. Skor, kazanç ve puan alanı `StepCard`'da yoktur.
3. **Doktor katmanı plana yazılmaz:** `tier:"doctor"` adım `plan_v2` içinde olamaz; `layers.doctor` boş. Doktor adımları okuma anında `doctor_recommendations` (yalnız `physician_reviewed`/`delivered`) satırının `physician_items` alanından `PlanViewV2.doctor.steps`'e eklenir; `FEATURE_DOCTOR_LAYER=false` → `state:"off"`, 18 altı → `"under_18"`, tarama yok → `"screen_required"`, risk → `"screen_risk"`, taslak → `"pending_review"`.
4. `basisChips`: boy, kilo, VKİ ve serbest not **asla** çip olmaz (eski kural aynen). `exclusions` her bilerek atlanan bölümü nedeniyle taşır (tr.json `plan.v2.exclusions.*`).
5. `disclaimers` her planda `notMedicalAdvice` içerir; `cosmeticProcedures` metni KB §4.7 birebir (`plan.v2.disclaimers.cosmeticProcedures`).
6. Saklama: `coach_reports.plan_v2 jsonb` + `plan_version='plan.v2'` + `report_version='report.v3'` (0013). Rapor metni (`ReportV3`) `coach_reports.report`'ta kalır. Yeniden üretim ücretli/haktan düşer (Ç10): `reportRegens` 0.
7. Kanıt cümlesi (KB §6.2, onay bekliyor): `plan.v2.evidence.{many_studies,limited_studies,expert_opinion}` = "Çok sayıda çalışmada denendi / Sınırlı sayıda çalışma var / Uzman görüşüne dayanıyor"; yanında `evidence.source` bağlantısı.

### S2.2 Bilgi tabanı: `KnowledgeSource` (`lib/coach/knowledge.ts`)

```ts
interface KnowledgeSource { name: "catalog"|"methods"; retrieve(q: KnowledgeQuery, limit ≤ 40): Promise<MethodRecord[]>; get(id); ids() }
KnowledgeQuery = { observations: string[], areas: PlanArea[], regions?, goals, goalDirection?, constraints: KnowledgeConstraints }
KnowledgeConstraints = { headCovering: boolean|null, presentation, jawHealth: none|issue, beardPreference: none|some, budgetBand, timeBand, under18, bodyFatAllowed, restrictionSignal, glasses, doctorLayer }
MethodRecord = { id, area, title (nötr), summary, tier, evidence:{level, grade?, source?}, costBand: none|low|medium|high, costTryRange?, frequency, minutesPerDay, difficulty, impact, effort, tags[], regions[], contraindications[], flawIds[], tryonPresetId?, source:{kind: catalog|tsv, ref} }
```

- **İlk sürüm** `CatalogKnowledgeSource`: `content/*` (14 cilt adımı, 7 alışkanlık, 8 egzersiz, 60 stil) → 89 kayıt; `filterByConstraints` K8/K9/K10/Ç1/Ç17 kurallarını **kodla** uygular (model görmez); `relevanceScore` alan + bölge + gözlem/etiket kelime örtüşmesi + hedef + bütçe. W4 sıralamayı iyileştirebilir; arayüz ve kısıt kuralları değişmez. CLAUDE NOTU: katalog kayıtlarının kanıt/etki/emek/maliyet değerleri varsayılandır (yalnız SPF ve güneş koruması `many_studies`); TSV gelince gerçek değerler.
- **TSV sözleşmesi (VARSAYIM; dosyalar gelmedi, KB §11/PLAN §4.1):** `TSV_METHOD_COLUMNS.required = id, area, title_tr, summary_tr, tier, evidence_grade (A|B|C), cost_band, frequency_per, frequency_times, minutes_per_day, difficulty, impact, effort`; `optional = source_url, cost_min_try, cost_max_try, tags, regions, contraindications, flaw_ids, tryon_preset_id, user_label_tr, notes_internal`; listeler `;` ile. Kusur dosyası `TSV_FLAW_COLUMNS.required = flaw_id, region, internal_name_tr, user_label_tr`. İçe aktarma (`scripts/import-methods.ts`, Sprint 3) başlık satırını eşleştirir, eksik zorunlu sütunda durur ve raporlar; `content/methods/*.json` = `MethodsFile { version:"methods.v1", importedAt, sourceFile, records }`. İç taksonomi adı (`internal_name_tr`) kullanıcıya gitmez; `user_label_tr` gider (KB §5 ÖNERİ).
- Claude'a istemde yalnız `retrieve` sonucu (≤ 40 kayıt: id, title, summary, area, tier, evidence, cost, minutes) verilir; `tier:"doctor"` kayıtlar yalnız hekim kuyruğu taslağı için ayrı çağrıda (flag + 18+ + tarama "ok").

### S2.3 Anket v2: `QuestionnaireV2` (`lib/questionnaireV2.ts`; KB §3.2/5–6, Ç17)

`{ version:"q.v2", goals[], goalDirection: sharper_mature|softer_younger|as_is_groomed, budget: upto_1000|1000_2500|2500_5000|5000_plus, oneTimeBudget: none|upto_15000|15000_60000|60000_plus|unknown, minutesPerDay: 5|10|20|30, activity:{ sportDays: 0_1|2_3|4_plus, work: desk|standing }, hairLengthPref, beardLengthPref, skinType, jawHealth[], glasses:{detected, value}, headCovering:{detected, value}, body?:{heightCm, weightKg} }`

- Skoru **değiştirmez** (KARAR R1-E4/R2-C13); sunum sorulmaz (`profiles.presentation`). Saklama `profiles.questionnaire_v2` + `questionnaire_v2_at` (0013); yazma yalnız `POST /api/questionnaire` (W4, Zod, service role) — authenticated grant verilmedi. Eski `profiles.questionnaire` ve `lib/questionnaire.ts` dokunulmadan kalır (eski ekranlar ve mobil).
- Ç17: `glasses/headCovering.detected` = `SignalsV2.observations.{glassesDetected,headCoveringDetected}` ile dolu gelir; `value` kullanıcı cevabı. `resolvePhotoConfirm` = value ?? detected; `hairAdviceAllowedV2` yalnız çözüm `false` iken. Tahmin ve seçim yoksa saç önerisi yok (`exclusions.hair = head_covering_unknown`).
- Bütçe tutarları KB taslağı, AÇIK (§11.3): `lib/config/plan.ts PLAN_CONFIG.placeholder = true`; `questionnaire.v2.hints.budgetPending` görünür. Süre bantları CLAUDE NOTU (5/10/20/30). Beden algısı taraması: 4 soru (`doctor.screen.q1–q4`), `BODY_IMAGE_SCREEN_RISK_YES_COUNT = 2` (CLAUDE NOTU; klinik ölçek değil); yalnız sonuç saklanır (`profiles.body_image_screen_result`), cevaplar saklanmaz.

### S2.4 Doktor katmanı (KB Ç3/Ç5, PLAN 4f; AUP high-risk)

- `FEATURE_DOCTOR_LAYER` varsayılan **false**. Açıkken bile akış: Claude taslağı (≤ 2 öğe `{ methodId, area, rationale, sources[] }`) → `doctor_recommendations(status='draft')` → admin hekim ekranı (`app/admin/doctor`, `ADMIN_EMAILS`) → `physician_reviewed` (`physician_id`, `reviewed_at`, `physician_items` zorunlu; DB check) → kullanıcı görünce `deliver_doctor_recommendation()` → `delivered`. **Tarayıcı politikası yok**; `draft`/`rejected` satır hiçbir API'den kullanıcıya gitmez. Taslağa düşen metin kullanıcı kanalındaki `safety.ts` filtresinden geçmez (ayrı kanal) ama doz, marka, eczane/satış linki içeremez; linkler yalnız `DOCTOR_LAYER.allowedLinkHosts` (TİTCK, DOI, PubMed, Cochrane, WHO) — kod doğrular.
- Kullanıcıya her öneriyle `doctor.disclosure` ("yapay zekâ ile hazırlandı; hekim gözden geçirdi") ve `doctor.notMedicalAdvice`; 18 altına hiç (`under_18` → `state:"under_18"`); tarama "risk" → katman kapalı + `doctor.screen.risk*` + psikolog yönlendirmesi.
- Hekim inceleme süreci (kim, nasıl, süre) ve gelir modeli AÇIK (KB §11.7): flag kapalı kalır.

### S2.5 Yönlendirme ve ürün bağlantıları (KB Ç4, PLAN 4g)

`product_links (id, ref_id, kind: product|expert|source, label, url https, merchant, is_ad=true, commercial_model: none|listing_fee, active)` — komisyon modeli **yok**; `product_link_clicks` yalnız service role (POST `/api/links/click`, W4); analitik olayına link kimliği gitmez. `FEATURE_PRODUCT_LINKS` varsayılan false: kapalıyken `StepCard.linkIds` arayüzde gösterilmez. Açıkken `plan.v2.links.adLabel = "Reklam"` zorunlu (K19). Reklamda hekim adı yok (K18). Uzman dizini `partners` tablosu (0001) ile, sponsorsuz.

### S2.6 Dene v2: girdi, modlar, kalite kontrolü (`lib/api/tryonInput.ts`, `lib/tryon/types.ts`, `lib/config/tryon.ts`)

```ts
POST /api/tryon  (TryonInputV2Raw → normalizeTryonInput → TryonRequestV2)
{ clientRequestId, analysisId?, mode?: style|combo|glow_up, presets?: {hair?, beard?, color?}, presetId? (ESKİ takma ad, bir sürüm), image (base64 JPEG ≤ 1,5 MB, bellek), mask?, planStepIds?[≤10], layers?: (hair|beard|skin)[] }
```

- `style`: tam bir preset (yuva = preset.kind). `combo`: saç + sakal zorunlu, renk isteğe bağlı (`TRYON_COMBO_MIN_PARTS = 2`); `mode` yoksa parçalardan çıkarılır. `glow_up`: `analysisId` zorunlu; `planStepIds`/`layers` yalnız bu modda; `layers` yoksa hepsi. Bilinmeyen/yuvaya uymayan preset `BAD_INPUT`. `presetId` ile `presets` birlikte gönderilemez. Eski `TryonInput` dışa aktarımı korunur (mobil M9); rota W5'te `TryonInputV2`'ye geçer.
- Bayrak kapıları (rota, W5): `combo` → `FEATURE_TRYON_COMBO` (varsayılan açık), `glow_up` → `FEATURE_GLOW_UP` (varsayılan açık); kapalıysa `FEATURE_DISABLED`.
- Maske (`MASK_REGIONS`): `below_brows | above_lip` (mevcut) + `features_only | features_cheeks | hair_only | beard_only` (W5 `mask.ts`). `maskRegionFor(mode, presets)`: glow_up → `features_only` (opaklık 0,8); sakal içeren her deneme → `features_cheeks` (yanak, favori, çene altı, bıyık modele kalır; R1-E10); yalnız saç/renk → `below_brows`. Drift politikası `composite.ts` aynen (sakal hacmi tek yönlü ≤ %15, diğer ≤ %3); kemik yapısı değişmez.
- **Kalite kontrolü** (`QcVerdict`, R2-C10/3 KARAR): Claude'a sonuç + orijinal; küçük düz şema `{ identityKept, styleApplied, strayHairCleared, artifacts: none|minor|major, reasons: QC_REASONS[] }` (hepsi zorunlu, enum, min/max yok); `pass` **kodda** `qcPass()`. Geçmezse en çok `TRYON_QC_MAX_REGEN` (2) yeniden üretim; yine geçmezse `tryon_events.status='qc_failed'`, kullanıcıya `tryon.v2.qc.failedTitle` ("Bu fotoğrafla bu stil iyi sonuç vermedi"), görsel **gösterilmez**, kota **düşmez** (Ç10). `TRYON_QC=off` yalnız geliştirme. Model `TRYON_QC_MODEL` (claude-opus-5-5), efor `TRYON_QC_EFFORT` (low); W5 `claude-api` skill + `lib/ai/anthropic.ts` yardımcılarıyla yazar (thinking ilk blok, `stop_reason` kontrolü, `output_config.format json_schema`).
- Görsel modeli: `getTryonConfig().imageModel` = `TRYON_IMAGE_MODEL` > `GEMINI_IMAGE_MODEL` > `gemini-3.1-flash-lite-image` (bugünkü). PLAN 5c `gemini-3.1-flash-image` önerir; sağlayıcı seçimi AÇIK (KB §11.6), yarıştırma yok — kullanılabilirlik uydurulmaz, kurucu env ile seçer.
- Glow-up (Ç9): istem plana bağlı cilt değişimi (ton eşitliği, kızarıklık); ben/çil/iz/gözenek/yüz şekli/ten rengi/saç çizgisi/kimlik korunur; `GLOW_UP_GATE` (ÖNERİ, `placeholder:true`): doku oranı 0,55–1,6, ton kayması ≤ 6 L*, yüksek frekans geri yazımı 0,5 — eşikler ilk kapı koşusunda ölçülür. Doktor işlemleri gösterilmez; reklamda kullanılmaz (K17); yeniden üretim haktan düşer. Gözlere hizalı kaydırıcı; altında `appliedStepIds`.
- Yanıt `TryonResultV2 = { eventId, mode, presets, image, mimeType, model, qc|null, regenCount, appliedStepIds, label }`; `label = common.aiGenerated` ("Aura ile oluşturuldu · YZ simülasyonu", K16) istemci görsele gömer; paylaş düğmesi (`lib/share/card.ts shareOrDownload`).
- "Bozuk görünüyor" (R2-C10/5): `POST /api/tryon/[id]/flag` → `flag_tryon_broken(p_user, p_event)` (yalnız kendi `success` satırı; idempotent); oran `ops.daily_tryon_quality.broken_rate`.
- Sürüm kapısı (`TRYON_RELEASE_GATE`): 30 rızalı yüz × 12 sakal = 360 görsel, ≥ %95; %90 altı stil `hidden` (W5 `scripts/tryon-gate.ts`, ücretli, onay).

### S2.7 Kota: `reserve_tryon` v2 (migration 0014)

`reserve_tryon(p_user, p_client_request_id, p_preset, p_model, p_limit, p_since, p_mode default 'style', p_presets jsonb default null, p_weight int default 1, p_analysis_id uuid default null)` — **eski 6 parametreli çağrı aynen çalışır**. Kota = kayan pencerede `sum(weight)` (`pending` + `success`); `failed`, `identity_drift`, `qc_failed` sayılmaz (iade). `used + p_weight > p_limit` → null. Ağırlıklar `getTryonConfig().weights` (hepsi 1, `weightsPlaceholder:true`; deneme kotası ve ek paket AÇIK, KB §11.2). `lib/tryon/quota.ts` W5'te `sum(weight)` ile güncellenir (bugün satır sayar). `p_preset` uyumluluk için saç > sakal > renk ilk dolu değer.

### S2.8 Veritabanı (0013, 0014; yalnız dosya — canlı projeye push onay ister)

**0013** `coach_reports (+plan_v2 jsonb, plan_version, report_version)`; `profiles (+questionnaire_v2 jsonb, questionnaire_v2_at, body_image_screen_result ok|risk, body_image_screened_at)` — authenticated yazamaz; `doctor_recommendations (id, user_id, analysis_id, report_id, status draft|physician_reviewed|delivered|rejected, ai_items ≤2, ai_model, ai_prompt_version, physician_items ≤2, physician_id, physician_notes, reviewed_at, delivered_at, created_at)` RLS açık, **politika yok**; check: reviewed/delivered yalnız hekim + zaman + physician_items ile; `deliver_doctor_recommendation(p_id, p_user)` yalnız physician_reviewed → delivered; `product_links` (aktif satır herkese okunur), `product_link_clicks` (politika yok); `ops.doctor_queue`.
**0014** `tryon_events` status + `qc_failed`; `+mode, presets, weight 1–5, analysis_id, plan_step_ids, qc, regen_count 0–3, flagged_broken, flagged_at`; `reserve_tryon` v2; `flag_tryon_broken`; `ops.daily_tryon_quality`. Görsel/maske/landmark hiçbir sütunda yok.
Doğrulama: scratch Postgres 16 (`/tmp/aura-pg-t1`, CI stub `scripts/ci/supabase-stub.sql`, pg_cron satırı sed ile atlanır — CI ile aynı) üzerinde 0001→0014 zinciri uygulandı; eski/yeni `reserve_tryon` çağrısı, ağırlık kotası, `qc_failed` iadesi, bozuk bayrağı, doktor kuyruğu teslim kuralları ve ≤ 2 öğe check'i geçti. `lib/db/types.ts` aynası güncellendi (`CoachReportsV2Columns`, `TryonEventsV2Columns`, `doctor_recommendations`, `product_links`, `product_link_clicks`, yeni RPC'ler); `pnpm db:types` push sonrası üzerine yazar.

### S2.9 Bayraklar ve env (`lib/config/flags.ts`, `.env.example`)

| Bayrak | Varsayılan | Not |
|---|---|---|
| `FEATURE_DOCTOR_LAYER` | false | hekim akışı AÇIK; kapalıyken taslak bile yazılmaz |
| `FEATURE_PRODUCT_LINKS` | false | Ç4: ücret/komisyon kapalı; "Reklam" etiketi |
| `FEATURE_GLOW_UP` | **true** | yalnız `"false"` kapatır (`DEFAULT_ON_FLAGS`) |
| `FEATURE_TRYON_COMBO` | **true** | yalnız `"false"` kapatır |

Env: `TRYON_IMAGE_MODEL`, `TRYON_QC` (on|off), `TRYON_QC_MODEL`, `TRYON_QC_EFFORT`, `TRYON_QC_MAX_REGEN` (0–3), `TRYON_WEIGHT_{STYLE,COMBO,GLOW_UP}` (1–5). Plan bantları env'de değil: bant adları sözleşme, tutarlar `questionnaire.v2.options.*` metninde (kurucu değiştirir).

### S2.10 `messages/tr.json` ad alanları (anahtar kümeleri sözleşme; `tests/unit/messagesTone.test.ts` yürür)

| Ad alanı | İz | Sabit anahtar kümeleri / KB metinleri |
|---|---|---|
| `plan.v2.*` | W4 | `phases` = PLAN_PHASES, `tiers` = PLAN_TIERS, `tabs` = PLAN_AREAS, `evidence` = EVIDENCE_LEVELS (**metin birebir**), `basis.title` = "Planın şunlara göre hazırlandı", `basis.chip` = BASIS_CHIP_KEYS, `disclaimers` = DISCLAIMER_KEYS (`notMedicalAdvice` = "Tıbbi tavsiye değildir.", `cosmeticProcedures` KB §4.7 birebir), `exclusions.*`, `step.*`, `barber.*`, `links.adLabel` = "Reklam" |
| `report.v2.*` | W4 | `regions` = REGION_KEYS; `notMedicalAdvice`, `cosmeticNote`, `measures.*`, `structuralNote` |
| `questionnaire.v2.*` | W4 | `options.goalDirection` = GOAL_DIRECTIONS (KB Ö7 metinleri birebir), `options.budget` = BUDGET_BANDS, `options.oneTimeBudget` = ONE_TIME_BUDGET_BANDS, `photoConfirm.*`, `hints.*` |
| `doctor.*` | W4 | `disclosure` (YZ açıklaması, AUP), `screen.q1–q4`, `admin.*`; ilaç adı/doz/marka yok (test) |
| `tryon.v2.*` | W5 | `modes` = TRYON_MODES, `qc.failedTitle` = "Bu fotoğrafla bu stil iyi sonuç vermedi", `flagBroken` = "Bozuk görünüyor", `glowUp.layers`, `combo.*` |

Ton: BANNED listesi (çirkin, kötü, kusur, zayıf, problem, sorun, argo, "ortalama") bu ad alanlarında da geçerli; "incel" alt dizisi yüzünden **"incele-" kökü kullanılmaz** ("gözden geçir", "onay" kullanılır).

### S2.11 Analitik (`lib/analytics.ts`)

`SPRINT2_EVENTS = plan_viewed, plan_step_opened, questionnaire_v2_completed, tryon_combo_started, tryon_qc_failed, tryon_flagged_broken, glowup_viewed` — **yüksüz** (`undefined`): adım kimliği, bölge, mod, skor, fotoğraf, plan içeriği eklenmez. `tests/unit/paywallConfig.test.ts` listesi derleme zamanında tamdır.

### S2.12 Kişiselleştirme kabul testi (PLAN §3) — W4/W5 kapanış şartı

Her çıktıda görünür iz: fotoğraf (bölge "seen" + `viewsUsed` çipi) · yaş bandı/sunum çipi ve 18 altı kısıtları · cihaz oranları/yüz şekli (ölçüler + `faceShape` çipi; override dahil) · hedef yönü (stil seti) · bütçe/süre/aktivite/çene/boy-kilo (adım kartında ₺, dk/gün; egzersiz ve yağ oranı kuralları `exclusions`) · gözlük/başörtüsü (saç önerisi var/yok). Otomatik test + 360 px ekran görüntüsü (açık/koyu) ile.

### S2.13 Açık maddeler ve kurucudan beklenenler

1. Bütçe tutarları ve süre bantları (KB §11.3) — bant adları sabit, metin değişir.
2. Deneme kotası, mod ağırlıkları, ek paket (KB §11.2) — `TRYON_WEIGHT_*`.
3. Görsel sağlayıcı/model (KB §11.6) — `TRYON_IMAGE_MODEL`.
4. Hekim inceleme akışı ve gelir modeli (KB §11.7) — flag kapalı; `ADMIN_EMAILS` hekim hesapları.
5. Kanıt cümleleri ve BDD tarama soruları (KB §11.17; §6.4) — onay bekliyor.
6. TSV dosyaları (867 yöntem / 660 kusur) — sütun sözleşmesi varsayım; gelince içe aktarma (Sprint 3).
7. K7 kalanı (steroid, hormon, mewing) — dışarıda tutuldu (safety.ts değişmedi).
8. Glow-up eşikleri (`GLOW_UP_GATE`) ve QC maliyet fizibilitesi (KB §11.14) — ilk kapı koşusunda ölçülür (ücretli, onay).
9. `pnpm db:types` ancak 0013/0014 push sonrası (onay) — ayna geçici.

### S2.14 Sprint 2 entegrasyon notları (F09, 4 Kasım 2026) — sözleşmeden sapmalar ve bağlantılar

Birleştirme: `wt/faz5` → `wt/faz4` (`--no-ff`), çakışma yalnız `messages/tr.json` (anahtar düzeyinde çakışma yok, birleşim) ve `tests/unit/catalog.test.ts`. İki izin katalog genişletmeleri birbirine bağlandı: W4'ün 12 yeni cilt/bakım adımı ve 4 alışkanlığı `SKIN_STEP_EFFECTS`'e (glow-up istemi), W5'in 10 yeni saç preset'i `lib/coach/barber.ts` tablosuna eklendi.

Uçtan uca bağ (SCORE_ENGINE=hybrid.v2): ödeme sonrası sonuç (`ResultV2View`, kart kart açılış korunur) → rapor kartı `ReportV3` (`report` bölümü) → "Plan" `/plan/[id]` → anket v2 yoksa `/plan/[id]/anket` → `POST /api/questionnaire` → `/plan/[id]` → `PlanView` ilk açılışta `POST /api/plan` → adım kartı "Dene" `/dene?preset=<id>` · "Berbere göster" (BarberCard) · "İyileşmiş halin" `/dene?mode=glow_up&analysis=<id>` → `TryonScreen` (`initialMode`, `initialPreset`) → `POST /api/tryon` (kalite kontrolü, `qc_failed` iade) → paylaş (etiket gömülü) / "Bozuk görünüyor". Doktor katmanı bayrak kapalıyken `state:"off"` → hiç çizilmez; ürün bağlantıları bayrak kapalıyken `{}`.

| # | Sapma / karar | Not |
|---|---|---|
| 1 | Dosya adları: `lib/ai/prompts/report.v3.ts` + `lib/ai/reportSchema.v3.ts` (S2.0'daki `plan.v2.ts` / `planSchema.v2.ts` yerine); ek `lib/coach/{planStore,knowledgeSource}.ts` | `PLAN_SELECTION_PROMPT_VERSION = "plan.v2"` (`+fallback` belirlenimci yedekte) |
| 2 | `content/types.ts`: `SkinStep.area?` (hair/beard/brows/style), `SkinStep.evidence?` (A/B/C), `Habit.area?`; `Preset.hidden?`, `Preset.tags?`; `Protect` = `MaskRegion` | Eklemeli; mobil derlemesi geçti |
| 3 | Egzersiz katalog kayıtları `regions:["skin"]` | S2.1 kural 2: egzersiz yapısal bölgeye bağlanamaz |
| 4 | `ApiErrorCode` += `TRYON_QC_FAILED` (422) | S2.6 yalnız metni adlandırıyordu |
| 5 | Kalite kontrolü sağlayıcı hatası ya da `TRYON_QC=off` → görsel `qc:null` ("kontrol yapılmadı") ile döner, istemci sapma kontrolü tek kapı | Uyarı loglanır; kesinti davranışı sözleşmede yoktu |
| 6 | `POST /api/tryon` yanıtı += `promptVersion` ("tryon.v2") | Eklemeli |
| 7 | Sakal preset'leri `protect:"features_cheeks"`; 76 preset → `CatalogKnowledgeSource` 105 kayıt (S2.2 "89") | Test sayıyı türetir |
| 8 | Plan yeniden üretimi: yalnız anket plandan yeniyse (`basisStale`) ya da `unlimited_quota`; aksi `QUOTA_EXCEEDED` | Ücretli yeniden üretim ürünü AÇIK (KB §11.1) |
| 9 | `hairLossSignal` `PlanViewV2`'nin yanında (`{ view, hairLossSignal }`) | Sözleşme tipine girmedi |
| 10 | `/dene` hakkı aboneliktir (`getPremiumStatus`); `one_time_report.grants.tryons = 0` (AÇIK §11.2) olduğundan tek seferlik rapor alan kullanıcı deneme ekranını kilitli görür | Kurucu deneme hakkını belirleyince `AccessV2` + ürün hakkıyla açılır |
| 11 | `/dene` arama parametreleri: `preset` (tek stil), `mode` (`style|combo|glow_up`; bayrakla kapalıysa tek stile düşer), `analysis` (kullanıcının tamamlanmış analizi; değilse en son) | "Sana önerilen" = plan v2 adımlarının `tryonPresetId`'leri ∪ v1 rapor |
| 12 | `ResultV2View` `flags?: { glowUp, expertNetwork }` (sunucu bayrakları → `ReportV3` bağlantıları) | Varsayılan `{ true, false }` |
| 13 | `seeProfessional` cümlesi motorda rapor kapanışına ekleniyor (`closingWith`); `ReportV3.seeProfessional` prop'u kullanılmıyor | Çift gösterim olmasın diye |

Sprint 2 inceleme düzeltmeleri (F09, 4 Kasım 2026; güvenlik/tıp/gizlilik, deneme pikselleri ve kişiselleştirme bulguları):

| # | Sapma / karar | Not |
|---|---|---|
| 14 | Glow-up YALNIZ `coach_reports.plan_v2` adımlarından; katalog yedeği kaldırıldı. Plan yoksa `BAD_INPUT` mesajı `plan_required`; `/dene` paneli planı açmaya yönlendirir | KB §7.2/Ç9: görsel plana bağlı; plan dışı kesim/sakal (sunum, başörtüsü süzgeci) görsele giremezdi |
| 15 | `POST /api/tryon` `analysisId` yalnız kullanıcının tamamlanmış analizi (aksi `BAD_INPUT`); yanıt += `layers`, `weight` (istemci kota çubuğunu ağırlıkla düşer) | FK 500 ve başka kullanıcının analizine referans önlendi |
| 16 | Kalite kontrolü AÇIKKEN yapılamazsa (sağlayıcı/zaman aşımı/şema) bir kez daha sorulur; yine olmazsa `qc_unavailable`: görsel GÖSTERİLMEZ, `tryon_events.status=failed` (hak iade), `qc={unavailable,reason}`, istemciye `AI_FAILED`. `unchecked` yalnız `TRYON_QC=off` | Satır 5'teki "kontrolsüz görsel döner" kararı değişti: Claude kontrolü kapıdır (R2-C10/3, Ç10) |
| 17 | `alignPointsFor(protect, policy)`: sapma kuralı `beard_add/beard_remove` ise (glow-up `features_only` maskesiyle bile) çene ucu (152) hizalamaya girmez; `CompositeInput.policy` | Sakallı glow-up `alignment_residual` ile hiç geçmiyordu |
| 18 | `maskRegionFor(mode, presets, layers?)`: glow-up'ta cilt katmanı kapalıysa yüz saç/sakal denemesi gibi geri yazılır (`features_cheeks`/`below_brows`); doku kapısı ve ince doku geri yazımı yalnız cilt katmanı açıkken (`glowUpSkinActive`) | KB K15/Ç9: model cildi yalnız plana bağlı cilt değişiminde |
| 19 | Yeniden üretim bütçesi `maxDuration − üretim − kontrol − 5 sn` (40 sn); route son tarihinde `AbortController` sağlayıcı ve kontrol çağrılarını keser, satır `failed` yazılır. 0014 öncesi ortamda `qc_failed` yazılamazsa `failed` yazılır (hak iade) | Bekleyen satır kotayı bir saat tutmasın |
| 20 | Gizli (`hidden`) preset hiçbir deneme gövdesinde kabul edilmez; katalog bilgi tabanına kayıt olmaz; TSV `tryon_preset_id` yalnız katalogdaki gizli olmayan stil | KB §7.3/4 sürüm kapısı |
| 21 | Beden algısı taraması "risk" yapışkan: `BODY_IMAGE_SCREEN_RETAKE_DAYS` (30, CLAUDE NOTU) dolmadan yeni gönderim kaydedilmez (`{result:"risk", retakeAt}`); katman `screen_risk` durumunda tarama yerine uzman notunu çizer | KB §6.4 sayfa yenilemeyle aşılamaz |
| 22 | Doktor taslağı tarama "ok" olunca kuyruğa (`POST /api/doctor/screen` + `analysisId` → `lib/doctor/enqueue.ts`); plan üretimindeki deneme de aynı "tek taslak" kuralıyla (`hasActiveDoctorRow`). İstemci tarama sonrası durumu `GET /api/doctor`dan okur (iyimser `pending_review` yok) | Kuyruk normal akışta hiç dolmuyordu |
| 23 | Hekim yetkisi `PHYSICIAN_EMAILS` (`isPhysicianUser`, `requirePhysician`): `/admin/doctor` ve `/api/doctor/review` yalnız bu liste; `ADMIN_EMAILS` ops için. Hekim onayında bir öğe bile kurala takılırsa hiçbir şey yazılmaz (400 + issues) | AUP: nitelikli kişi; diploma/sicil referansı saklama AÇIK (migration ister) |
| 24 | `KnowledgeQuery.faceShape`, `MethodRecord.faceShapes` (preset `suits`), kontrendikasyon `male_presentation`; `retrieve` izinli alan + yüz şekli + sunumla süzer; `buildPlanV2` `face_shape` / `safety` (başlık safety.ts) nedenleriyle düşürür; tek seferlik adımlar `oneTimeBudget` bandına (`none` → aylık üst sınır, `unknown` → süzgeç yok) sığmalı; istem anketine `presentation`, `oneTimeBudget` eklendi | PLAN §3 "yüz şekline göre süzülür", bütçe → ₺ |
| 25 | `StepCard.rationale` (Claude gerekçesi) ayrı alan; `summary` her zaman kaydın "ne yapılacağı" metni. Belirlenimci yedekte `aiGenerated` yerine `deterministicFallback` uyarısı + plan üstünde not | Sahte başarı yok |
| 26 | Etiket eşleşmesi: ≥ 3 harf (durak sözcük listesiyle), çok sözcüklü etiket tüm sözcükleri geçince eşleşir (`tokenizeTr`). TSV içe aktarma: alan varsayılan kontrendikasyonları (saç/renk/sakal/egzersiz) eklenir, K8 etiketi olmayan kilo içeriği, https olmayan `source_url`, safety ihlalli başlık/özet (doktor katmanı hariç) satırı düşürür; adım kartı kaynağı yalnız https ise bağlantı | S2.2 "kurallar modelden önce kodda" |
| 27 | Berber kartı KB §8 "önden ve yandan görsel" içermez: stil illüstrasyonları (kullanıcı fotoğrafı değil) üretilmedi; `plan.v2.barber.front/side` ölü anahtarları kaldırıldı. Görseller gelince `BarberSpec.imageFront/imageSide` eklenir | AÇIK (varlık yok); KB §8 ONAYLI ÖNERİ'nin eksik parçası |
| 28 | Saç dökülmesi kartı "plana eklendi" cümlesini yalnız planda saç derisi adımı varken (`hasScalpStep`) söyler; aksi hâlde genel öneri metni | Doğru olmayan iddia kaldırıldı |

---

## Sprint 3 — Faz 6 (web) ve mobil eşitlik (M9) sözleşmeleri (T2, 4 Kasım 2026)

Kaynak önceliği aynı: KB > PLAN_V2 > bu belge > SPEC/CLAUDE.md. Sprint 1–2 sözleşmeleri (§0–§9, S2.*) aynen geçerli. Motor ve sağlayıcılar (`lib/score/engine/*`, `lib/ai/*`) bu sprintte **donmuştur**; sunucu eski takma adları (`image`, `presetId`, 6 parametreli `reserve_tryon`) bir sürüm daha tutar — bu sprintte kaldırılmaz. Ücretli/ağ AI çağrısı yok; birim testler sağlayıcıyı taklit eder. Push, uzak migration, deploy, EAS build, mağaza gönderimi yok.

### S3.0 Dosya sahipliği

| İz | Yazar | Yalnız okur |
|---|---|---|
| **W6** web Faz 6 (F08 paylaşım/berber/hayalet, F12 rutin/ilerleme, F14 davet girişi, F18 admin oranı) | `lib/share/card.ts` (spec'ten çizim: `renderShareCard(spec)`), `components/share/*`, `components/plan/BarberCard.tsx` (paylaş), `components/camera/GhostGuideOverlay.tsx` (yeni), `components/camera/{SelfieCamera,CaptureScreen}.tsx` (kılavuz katmanı), `lib/local/progressStore.ts` (Dexie v2: `ghost`), `components/routine/*`, `components/progress/*`, `components/analysis/ScoreTrend.tsx` (gürültü etiketi), `app/api/routine/**` (gerekirse), `app/api/admin/metrics/route.ts` (`tryonQuality`), `app/admin/**` (oran kartı), `app/api/billing/revenuecat/route.ts` + `lib/billing/revenuecat.ts` (tek seferlik ürün eşlemesi, S3.3.7), `components/paywall/ReferralBlock.tsx` + yeni `ReferralClaimForm.tsx`, `supabase/migrations/0015_v2_faz6.sql` (yalnız dosya), `tests/unit/*` (kendi), `tests/e2e/privacy.spec.ts` (ghost/oval kuralı), `tr.json`: S3.4'teki ad alanlarının **metin değerleri** | `lib/share/spec.ts`, `lib/routine/forgiving.ts`, `lib/config/routine.ts`, `lib/progress/noise.ts`, `lib/face/ghostGuide.ts`, `lib/analytics.ts` |
| **W7a** mobil ödeme öncesi + paywall (M9-a) | `mobile/app/baslangic/{yas,cinsiyet,giris,izinler}.tsx`, `mobile/app/index.tsx` (anonim oturum → giriş), `mobile/app/tara.tsx` (çoklu açı, kalite pop-up'ı, cihaz ilerlemesi, `device_only` gönderim, ghost katmanı), `mobile/app/analiz/[id].tsx` **kilitli durum** (`stage !== completed || overall.locked`), `mobile/app/premium.tsx` (paywall v2: fayda listesi, illüstratif önce/sonra, sunucu süreli teklif, ürünler, davet bloğu + kod girişi), `mobile/src/features/{auth,onboarding,capture,paywall,billing,referral}/**`, `mobile/src/components/{capture,analysis/Locked*,paywall}/**`, `mobile/tests/{onboarding,capture,billing,referral}*.test.ts` | S3.2 paylaşılan katman, `lib/face/*`, `lib/score/present.ts`, `lib/billing/{offer,entitlement}.ts`, `lib/referral/{code,unlock}.ts` |
| **W7b** mobil açık sonuç + plan + dene + rutin/ilerleme (M9-b) | `mobile/app/analiz/[id].tsx` **açık/kart kart durum** (`ResultV2` karşılığı; W7a ile aynı dosyada `stage`'e göre dallanır — ortak dosya: önce W7a kilitli iskeleti yazar, W7b `components/analysis/result/*` bileşenlerini ekler), `mobile/app/plan/[id]/{index,anket}.tsx`, `mobile/app/(tabs)/{dene,plan,rutin,ilerleme}.tsx`, `mobile/src/components/{analysis/result,report,plan,tryon,routine,progress}/**`, `mobile/src/features/{tryon,routine,progress,share}/**`, `mobile/src/native/tryon.ts` (kombin/glow-up maskeleri), `mobile/src/lib/progressStore.ts` (`ghost` alanı), `mobile/tests/{tryon,progressShare,plan,routine}*.test.ts` | S3.2, `lib/coach/planTypes.ts`, `lib/questionnaireV2.ts`, `lib/config/plan.ts`, `lib/tryon/*` (saf), `lib/api/tryonInput.ts`, `lib/share/spec.ts`, `lib/routine/forgiving.ts`, `lib/progress/noise.ts` |
| **T2 (bu)** | `mobile/app/_layout.tsx`, `mobile/app/(tabs)/_layout.tsx`, `mobile/src/lib/{api,flags}.ts`, `mobile/src/theme/*`, `mobile/src/features/session/SessionProvider.tsx` (`aura` alanı), `mobile/eslint.config.js` (M1 listesi), `mobile/.env.example`, rota yer tutucuları, `mobile/tests/{sharedV2,apiV2}.test.ts`, `lib/share/spec.ts`, `lib/routine/forgiving.ts`, `lib/config/{routine,scoring}.ts` (`NOISE_BAND`), `lib/progress/noise.ts`, `lib/face/ghostGuide.ts`, `lib/analytics.ts` (olay adları), `messages/tr.json` (ad alanları + KB metinleri), `.env.example`, bu bölüm | — |

Paylaşılan dosyayı değiştirmek gerekirse: önce burada sözleşmeyi güncelle, sonra kodu; diğer izleri bilgilendir ve raporda `outOfOwnershipEdit` olarak listele. `mobile/app/analiz/[id].tsx` iki izin ortak dosyasıdır: W7a `stage`/kilit dallanmasını ve kilitli görünümü yazar; W7b yalnız `ResultV2View` dalını ekler (ayrı bileşen dosyasında), aynı satırlara dokunmaz.

### S3.1 Mobil rota haritası (expo-router; typed routes `pnpm --filter mobile typecheck` ile üretilir)

| Mobil rota (dosya) | Sahip | Web karşılığı | Durum (T2 sonrası) | Veri / kural |
|---|---|---|---|---|
| `/` (`app/index.tsx`) | W7a | `/` | var (anonim oturum) | v2: CTA → `/baslangic/yas`; anonim oturum **kalkar** (KB P#2, §2.3 "anonim oturum yok"); `/api/referral` ve `/api/billing/sync` zaten `allowAnonymous:false` |
| `/baslangic/yas` | W7a | `app/(app)/baslangic/yas` | var (doğum yılı) → bant listesine döner | `aura.onboarding.age(ageBand)`; `under_18` + bayrak kapalı → `FEATURE_DISABLED` → `onboarding.age.under18Soon*` |
| `/baslangic/cinsiyet` | W7a | `baslangic/cinsiyet` | **yer tutucu** | `aura.onboarding.profile(presentation)`; `onboarding.gender.*` |
| `/baslangic/giris` | W7a | `baslangic/giris` (`components/auth/SignIn.tsx`) | **yer tutucu** | Google/Apple: Supabase `signInWithOAuth` (PKCE, `skipBrowserRedirect:true`) + `expo-web-browser openAuthSessionAsync(url, "aura://auth/callback")` + `exchangeCodeForSession` (LinkAccount'taki kalıp; `linkIdentity` yerine oturum yokken `signInWithOAuth`); Apple, Google varsa zorunlu (Apple 4.8); e-posta OTP yedek (KB §11.11 AÇIK): `signInWithOtp({ email })` + `verifyOtp({ type:"email" })`; metinler `auth.signIn.*` |
| `/baslangic/izinler` | W7a | `baslangic/izinler` | var | aydınlatma + açık rıza ayrı metin; sürüm artışı W1'de yapıldı; `aura.onboarding.complete()` → `(tabs)/analiz` |
| `/baslangic/anket` | — | — | var (v1; dokunulmaz) | v2'de kullanılmaz (anket ödeme sonrası `/plan/[id]/anket`); dosya kalır, bağlantısı kaldırılır |
| `/tara` | W7a | `(gated)/tara` (`components/camera/*`) | var (tek açı) | çoklu açı adımları (`lib/face/views.ts`), kalite pop-up'ı (`camera.qualityPrompt.*`), cihaz ilerlemesi (`lib/face/deviceProgress.ts`), `aura.analyses.deviceOnly` (görsel yok), ödeme sonrası `aura.analyses.run(id, images)`; `?analysis=<id>` ile çekime dönüş; hayalet kılavuz katmanı (S3.3.4) |
| `/analiz/[id]` | W7a (kilitli) + W7b (açık) | `(gated)/analiz/[id]` (`ScoreViewV2`, `ResultV2View`, `RevealSequence`) | var (v1 ScoreView) | `aura.analyses.get` + `waitForAnalysis`; kilitli: halka+kilit, bulanık çubuklar, oranlar açık, 3 bulanık adım, cihazda bulanık plan önizlemesi; açık: kart kart (`sectionsReady`), explain5, yüz şekli override (`aura.me.faceShape`), ölçüler, potansiyel, rapor v3, paylaşım kartı (S3.3.1) |
| `/premium` | W7a | `(gated)/premium` (`components/paywall/*`) | var (RevenueCat v1) | paywall v2 (`paywall.v2.*`): `aura.billing.offer()` sunucu sayacı, ürünler (`PRODUCTS`, `listedProducts`), mağaza paketleri (RevenueCat), satın alma → `aura.billing.sync()` → `aura.billing.status()`; **istemci premium açmaz**; davet bloğu `aura.referral.get()` + kod girişi `aura.referral.claim(code)` |
| `/plan/[id]` (`plan/[id]/index.tsx`) | W7b | `(gated)/plan/[id]` (`components/plan/PlanView.tsx`) | var (v1 ReportView; **`plan/[analysisId]` → `plan/[id]` taşındı**, çağrılar güncellendi) | `aura.plan.get` (404 → anket var mı? yoksa `/plan/[id]/anket`; varsa `aura.plan.create`), `PlanViewV2`, fazlar/öncelik/adım kartı/çipler, berber kartı (S3.3.1), "Dene" → `/(tabs)/dene?preset=`, "İyileşmiş halin" → `/(tabs)/dene?mode=glow_up&analysis=` |
| `/plan/[id]/anket` | W7b | `(gated)/plan/[id]/anket` (`QuestionnaireWizardV2`) | **yer tutucu** | `emptyQuestionnaireV2(prefill)` + `QuestionnaireV2Schema`; `aura.questionnaire.submit` → `/plan/[id]`; skor değişmez |
| `/(tabs)/analiz` | W7b | `(gated)/analiz` | var | `aura.analyses.list()`; yeni analiz → `/tara` |
| `/(tabs)/plan` | W7b | `(gated)/plan` | var (v1) | son tamamlanmış analiz → `/plan/[id]`; hak yoksa kilit kartı |
| `/(tabs)/dene` | W7b | `(gated)/dene` (`components/tryon/*`) | var (v1 tek stil) | `aura.tryon.status`, kombin seçici (`presets{hair,beard,color}`), glow-up paneli (`mode:"glow_up"`, `analysisId`, `layers`, plan adımları), `TRYON_QC_FAILED` kartı (hak düşmez), etiket (`common.aiGenerated`) + paylaş, "Bozuk görünüyor" → `aura.tryon.flag`; kompozit maskesi `maskRegionFor(mode, presets, layers)`; drift → `aura.tryon.drift` |
| `/(tabs)/rutin` | W7b | `(gated)/rutin` | var (v1) | affedici seri (S3.3.2): `computeForgivingStreak`, dinlenme/dondurma metinleri `routine.v2.*`; dondurma kaydı S3.6 |
| `/(tabs)/ilerleme` | W7b | `(gated)/ilerleme` | var (v1) | ±bant "değişim yok" (S3.3.3): `classifyChange(prev, next, a.noiseBand)`; fotoğraflar sanal alanda; `ghost` alanı |
| `/hesap`, `/silme`, `/uzman` | — | aynı | var | değişmez |

### S3.2 Mobil paylaşılan katman (T2; iki iz de buna dokunmaz)

**`mobile/src/lib/api.ts`** — `createApiClient` değişmedi (Bearer). Yeni `createAuraApi(client)` → `AuraApi`; `useSession().aura` ile gelir. Yollar web rotalarıyla birebir; tipler yalnız saf modüllerden:

| Alan | Fonksiyon | Rota | Yanıt / not |
|---|---|---|---|
| onboarding | `age(ageBand)` | `POST /api/onboarding/age { ageBand }` | `{ isAdult, ageBand }`; under_18 + bayrak kapalı → `FEATURE_DISABLED` |
| | `profile(presentation)` | `POST /api/onboarding/profile` | 204 |
| | `complete()` | `POST /api/onboarding/complete` | 204; `BAD_INPUT presentation_missing` |
| analyses | `list()` | `GET /api/analyses` | `ClientAnalysisSummary[]` |
| | `deviceOnly({ clientRequestId, geometry, sourceHashes? })` | `POST /api/analyses` (mode `device_only`) | `200 ClientAnalysisV2` (stage `device_only`); **görsel yok**, kota sayılmaz |
| | `run(id, { images, sourceHashes? })` | `POST /api/analyses/[id]/run` | `202 ClientAnalysisV2` (queued); ön + ≥1 profil; `PREMIUM_REQUIRED` / `QUOTA_EXCEEDED` |
| | `get(id)` / `getLegacy(id)` | `GET /api/analyses/[id]` | `ClientAnalysisV2` (v2 satır) / `ClientAnalysis` (v1 satır) |
| billing | `status(analysisId?)` | `GET /api/billing/status[?analysis=]` | `BillingStatusDto { premium, plan, periodEnd, cancelAtPeriodEnd, status, analysisEntitled }` |
| | `offer()` | `GET /api/billing/offer` | `OfferResponse` (`lib/billing/offer.ts`; `serverNow` ile sayaç; `prices[*].placeholder`) |
| | `sync()` | `POST /api/billing/sync` | `{ premium, plan, periodEnd }`; `RATE_LIMITED` (6/dk) |
| questionnaire | `submit(q)` | `POST /api/questionnaire` | 204 |
| plan | `get(id)` / `create(id, regenerate?)` | `GET /api/plan/[id]` / `POST /api/plan` | `PlanDto { view: PlanViewV2, created?, fallback?, hairLossSignal }`; `NOT_FOUND`, `PREMIUM_REQUIRED`, `QUOTA_EXCEEDED` |
| doctor | `get(id)` / `screen({ answers, analysisId? })` | `GET /api/doctor?analysisId=` / `POST /api/doctor/screen` | `DoctorDto { state, steps, disclosure:true }` / `{ result, retakeAt? }` |
| me | `faceShape(shape|null)` | `PATCH /api/me/face-shape` | `{ override }` |
| tryon | `status()` / `run(TryonInputV2Raw)` / `runLegacy(TryonInput)` / `drift(eventId)` / `flag(eventId)` | `GET /api/tryon/status` / `POST /api/tryon` / `POST /api/tryon/[id]/{drift,flag}` | `TryonStatusDto` / `TryonResultV2` (`TRYON_QC_FAILED` 422 → görsel yok, hak düşmez) / 204 |
| referral | `get()` / `claim(code)` | `GET /api/referral` / `POST /api/referral { code }` | `ReferralDto { code, progress{done,total,pending}, unlocked }` / 204; bayrak kapalı → `FEATURE_DISABLED` |

Yoklama yardımcıları: `ANALYSIS_POLL = { intervalMs 2500, maxIntervalMs 6000, timeoutMs 15 dk }`, `nextPollDelayMs(attempt)`, `isAnalysisSettled(stage)`, `waitForAnalysis(aura, id, { onUpdate, signal, sleep, timeoutMs })` — her yanıt `onUpdate`'e gider (kart kart açılış `sectionsReady` ile), `completed|failed`'da durur. Testler: `mobile/tests/apiV2.test.ts` (görsel yalnız `[id]/run` ve `/api/tryon` gövdesinde).

**`mobile/src/lib/flags.ts`** — `FlagKey` aynası tam (`under18, percentile, doctorLayer, referralUnlock, yearlyPlan, productLinks, glowUp, tryonCombo` + eskiler); Sprint 3'te yeni bayrak yok (hayalet kılavuz ve berber kartı ONAYLI ÖNERİ, bayraksız; affedici seri ÖNERİ → yapılandırma yer tutucu, bayrak değil). Sunucu son sözü söyler.

**`mobile/src/theme/index.ts`** — `Palette` += `brand, brandSoft, elevated, success, warn, info, track, overlay` (web `globals.css` adlarıyla, açık/koyu); `radius` += `sm, xl`; `touchTarget = 44`; `typeScale`; `motion` (reduce-motion'da kapatılır). İki iz yeni renk sabiti tanımlamaz.

**`mobile/app/_layout.tsx`** — kök `Stack` v2 rotalarını kaydeder (`baslangic`, `tara`, `analiz/[id]`, `premium` modal, `plan/[id]/index`, `plan/[id]/anket`); ekranlar kendi `Stack.Screen` başlıklarını koyar. `(tabs)/_layout.tsx` değişmedi (sekmeler KB §3.2/7 ile aynı: Analiz · Plan · Dene · Rutin · İlerleme).

**M1 saf modül listesi (doğrulandı; `mobile/tests/sharedV2.test.ts` her birini içe aktarır):** `lib/score/{contract,present}.ts`, `lib/coach/planTypes.ts`, `lib/questionnaireV2.ts`, `lib/config/{plan,plans,flags,scoring,routine,tryon,teaser}.ts`, `lib/tryon/types.ts`, `lib/api/{tryonInput,analysesInput,errors}.ts`, `lib/onboarding/{age,gate}.ts`, `lib/face/{views,ghostGuide,overlay,deviceProgress,hash,indices,…}.ts`, `lib/share/spec.ts` (`lib/share/card.ts` DOM — yasak), `lib/routine/{streak,forgiving}.ts`, `lib/progress/noise.ts`, `lib/billing/{offer,entitlement,revenuecat}.ts`, `lib/referral/{code,unlock}.ts`, `lib/analytics.ts`, `content/*`, `messages/tr.json`. ESLint `no-restricted-imports` listesine eklendi: `@/lib/coach/{generatePlan,planStore}`, `@/lib/doctor/*`, `@/lib/referral/{server,verify,links}`, `@/lib/onboarding/{presentation,profileRead}`, `@/lib/api/quota`, `@/lib/tryon/quota`, `@/lib/tryon/*.server`, `@/lib/face/sessionStore` (ImageBitmap); istisnalar `!@/lib/share/spec`, `!@/lib/billing/{offer,entitlement}`.

### S3.3 Web Faz 6 sözleşmeleri (W6 uygular; T2 saf modülleri yazdı)

#### S3.3.1 Paylaşım kartları — `lib/share/spec.ts` (KB §8 KARAR R2-Ö3, ONAYLI ÖNERİ R2-Ö2, K17)

```ts
SHARE_CARD_KINDS = ["score","strongest","barber"]; SHARE_CARD_FORMATS = ["story","square"]; SHARE_CARD_SIZES; SHARE_AUDIENCES = ["personal","marketing"]
ShareCardSpec = ScoreShareSpec | StrongestShareSpec | BarberShareSpec   // ortak: format, audience, appName, url, disclaimer, withPhoto
ScoreShareSpec     { kind:"score", overall, potential|null, subs[≤3]{key,label,value} }
StrongestShareSpec { kind:"strongest", sub, title ("En güçlü yanın: {area}"), line (≤120, nötr tek cümle; ExplanationV2.held[0]) }   // SAYI YOK
BarberShareSpec    { kind:"barber", barber: BarberSpec, presetIds{hair?,beard?}, lines[], withPhoto:false }   // görsel yok (S2.14 #27)
shareSpecIssues(spec) → ShareSpecIssue[]  ("photo_on_marketing_card" | "photo_on_barber_card" | aralık/uzunluk | "url_missing")
SHARE_RULES.photoAllowed(kind, audience); strongestSub(subscores); topSubs(subscores, labelOf); shareFileName(kind, now)
```

- **Kural (K17):** `audience:"marketing"` kartında kullanıcı fotoğrafı **yok** — `shareSpecIssues` boş değilse çizici (web `lib/share/card.ts`, mobil Skia) **çizmez**. Varsayılan kart skor kartı; "En güçlü yanın" isteğe bağlı; berber kartı plan ekranındaki "Berbere göster"den (`BarberSpec`: stil adı, yanlar kaç numara, üst kaç cm, sakal hattı; önden/yandan görsel varlık gelince `imageFront/imageSide`). Kart cihazda üretilir; sunucuya gitmez. Etiket metinleri `share.v2.*`. W6 `renderShareCard(spec, photo?)` imzasına geçer (eski `ShareCardInput` bir sürüm kalır); mobil `features/share/layout.ts` aynı spec'i alır (W7b).
- Analitik: `share_card_created { withPhoto, kind }` (skor değeri yok).

#### S3.3.2 Affedici seri — `lib/config/routine.ts`, `lib/routine/forgiving.ts` (PLAN Faz 6 **[ÖNERİ]**; CLAUDE NOTU)

```ts
ROUTINE_FORGIVING = { restDaysPerWeek: 1, freezesPerMonth: 1, placeholder: true }; getRoutineForgiving(env)  // ROUTINE_REST_DAYS_PER_WEEK 0–3, ROUTINE_FREEZES_PER_MONTH 0–4 (mobil EXPO_PUBLIC_ aynı)
FreezeRecord = { date: "YYYY-MM-DD" }
computeForgivingStreak({ logs, activeItemCount, today, freezes?, config? }) → { streak, restDaysBridged, freezesBridged, today: "done"|"frozen"|"pending" }
restDaysLeftThisWeek(...) → n; canUseFreeze(freezes, date, today, config) → { ok } | { ok:false, reason: limit_reached|already_frozen|future_date|bad_date }
dayStatus(day, ...) → done|rest|frozen|missed|pending; isoWeekKey(ymd) "YYYY-Www" (Pzt başlangıç); monthKey(ymd) "YYYY-MM"
```

- Kurallar: yapılan gün (≥ %80, SPEC 11.1) seriyi artırır; **dondurulan gün** ve haftada `restDaysPerWeek` **eksik gün** seriyi köprüler (sayılmaz, koparmaz); bugün tamamlanmadıysa eksik sayılmaz (dünden geriye). Zincirin başındaki köprüler sayılmaz. `computeStreak` (v1) olduğu gibi kalır; arayüz `placeholder` iken `routine.v2.placeholderNote` gösterir.
- Analitik: `routine_rest_day` (dinlenme günü köprü olarak gösterildiğinde, günde bir), `routine_freeze_used`.

#### S3.3.3 İlerleme gürültü bandı — `lib/progress/noise.ts`, `lib/config/scoring.ts NOISE_BAND` (KB §4.2)

- **Tek kaynak:** `NOISE_BAND = 0.3` artık `lib/config/scoring.ts`'te (saf); `lib/config/engine.h2.server.ts` yeniden dışa aktarır, `ClientAnalysisV2.noiseBand = NOISE_BAND_CLIENT = NOISE_BAND`. Motor dosyalarına dokunulmadı.
- `classifyChange(prev, next, band = NOISE_BAND) → { delta (tek ondalık), kind: no_change|up|down, band }` — |Δ| ≤ bant (sınır dahil) "değişim yok". `CHANGE_LABEL_KEY` → `progress.v2.change.*`; `formatBand` "0,3"; `formatDelta` "+0,4"/"−0,5"; `trendChanges(points)` ardışık çiftler. Kalibrasyon sürümü farklıysa karşılaştırma yapılmaz (`progress.v2.calibrationChanged`); istemci `a.noiseBand`'ı geçirir.
- Analitik: `progress_no_change_shown` (yüksüz).

#### S3.3.4 Hayalet kılavuz — `lib/face/ghostGuide.ts` (KB §8 ONAYLI ÖNERİ R2-Ö1)

```ts
GHOST_INDICES (43 = FACE_OVAL 36 + göz köşeleri 4 + burun ucu + ağız köşeleri 2); GHOST_STYLE { opacity 0.35, strokeWidth 2 }
GhostOutline (zod) = { version:1, aspect (w/h), mirrored, oval[36], eyes[4], nose, mouth[2] (hepsi 0–1 normalize), takenAt }
ghostOutlineFromLandmarks(landmarks px, frameW, frameH, { mirrored, takenAt }) → GhostOutline | null   // z atılır; 478 nokta tutulmaz
ghostPolylines(outline, viewport{w,h}, { mirror }) → { oval, eyes, nose, mouth } px   // "cover" eşlemesi (önizlemeyle aynı), ayna farkında x çevrilir
polylinePath(points, close); parseGhostOutline(raw) → GhostOutline | null
```

- **Saklama:** yalnız cihazda, ilerleme kaydıyla birlikte: web `lib/local/progressStore.ts` Dexie **v2** `ProgressPhoto.ghost?: GhostOutline` (W6); mobil `ProgressEntry.ghost?: GhostOutline` (`index.json`, W7b). Analiz çekiminde ön kare için üretilir (kalite kapısından geçen kare; `AnalysisProgress`'ten önce). **Hiçbir isteğe, analitiğe, loga girmez**; `privacy.spec.ts` gövdede `"oval"`, `"ghost"`, `"eyes":[[` anahtarlarını yasaklar (W6 ekler). Yeniden analizde kamera üstüne silik çizgi (`ghost.*` metinleri, toggle; `prefers-reduced-motion`'dan bağımsız statik). Analitik: `ghost_guide_shown`.

#### S3.3.5 Davet kodu girişi (KB P#15/Ç12)

- **Karar:** ayrı `POST /api/referral/claim` rotası **yok** — W1'in `POST /api/referral { code } → 204` rotası zaten "claim"dir (`checkClaim`, `verifyReferralDevice` yer tutucu, `FEATURE_REFERRAL_UNLOCK`). W6 web giriş formunu (`components/paywall/ReferralClaimForm.tsx`, paywall v2 davet bloğunun altında ve `/baslangic/izinler` sonrası isteğe bağlı), W7a mobil formunu yazar. Hata eşlemesi `BAD_INPUT` mesajı → `referral.claim.errors.{unknown_code,self,already_claimed,device,generic}`; `FEATURE_DISABLED` → `disabled`. Kod biçimi `REFERRAL_CODE_RE` (`DV-XXXX-XXXX`, `normalizeReferralCode`). Analitik: `referral_claimed { ok }` (kod yok).

#### S3.3.6 Admin "Bozuk görünüyor" oranı (KB §7.3/5; F18)

- `GET /api/admin/metrics` yanıtı += `tryonQuality: { day, mode, success, qc_failed, identity_drift, flagged_broken, broken_rate }[]` (`ops.daily_tryon_quality`, 0014). PostgREST `ops` şemasını açmaz: W6 `0015_v2_faz6.sql` ile `public.ops_daily_tryon_quality(p_days int)` RPC'si (0007 kalıbı, `security definer`, yalnız service role) ekler; admin sayfasında günlük tablo + son 7 gün oranı; %5 üstü vurgulanır (CLAUDE NOTU eşik). Görsel yok.

#### S3.3.7 Mobil ödeme eşitliği (sunucu tarafı; W6)

- RevenueCat tek seferlik ürün: `lib/billing/revenuecat.ts` saf eşlemeye `productFromStoreId(id) → ProductId | null` (env `REVENUECAT_PRODUCT_ONE_TIME_REPORT_ID`, `…_PROMO_ID`; abonelikler mevcut `planFromProductId`), webhook `NON_RENEWING_PURCHASE` → `purchases(provider='revenuecat', product='one_time_report', status='paid', analysis_id null)` (idempotent `event_key`); `/api/analyses/[id]/run` mevcut `promoteAndStart` bağlar. Mağaza ürün kimlikleri ve fiyat kademeleri **AÇIK** (kurucu; S3.7). İstemci sonucu premium açmaz (değişmedi).

### S3.4 `messages/tr.json` ad alanları (anahtar kümeleri sözleşme; `messagesTone` WALKED'a eklendi)

| Ad alanı | İz | Sabit anahtarlar / KB metinleri |
|---|---|---|
| `share.v2.*` | W6/W7b | `kinds` = SHARE_CARD_KINDS, `kindHint.*`, `strongestTitle` = **"En güçlü yanın: {area}"** (KB §8), `photoToggle`, `photoHint`, `marketingNoPhoto`, `barberNoPhoto`, `disclaimer`, `footer`, `create`, `download`, `shared`, `downloaded`, `error`, `invalid`, `deviceNote`; eski `share.*` (v1 kart) kalır |
| `routine.v2.*` | W6/W7b | `restDay`, `restDayHint {n}`, `restDaysLeft {n}`, `restDaysNone`, `freeze`, `freezeHint {n}`, `freezeUsed`, `freezeDone`, `frozenDay`, `missedDay`, `streakKept`, `bridgedNote {rest,freeze}`, `placeholderNote`, `errors.*` = FreezeCheck nedenleri |
| `progress.v2.*` | W6/W7b | `change.{noChange,up,down}` ("Değişim yok" / "Yükseldi" / "Düştü"), `noiseNote {band}`, `deltaLabel {delta}`, `sincePrevious`, `calibrationChanged`, `changeAria {label}`; `analysis.noChange {band}` kalır |
| `referral.claim.*` | W6/W7a | `title`, `body`, `label`, `placeholder`, `submit`, `skip`, `success`, `errors.{unknown_code,self,already_claimed,device,disabled,generic}` |
| `ghost.*` | W6/W7a | `title`, `body` (KB §8 birebir anlam: "yüz çizgisi kamerada silik görünür; aynı açıya ve mesafeye otur"), `show`, `hide`, `none`, `aria`, `aligned`, `deviceNote` |
| `mobile.*` | T2/W7a/W7b | `stub.{title,body,back}` (yer tutucu ekranlar; sprint sonunda kullanılmaz kalmalı), `signIn.{emailFallback,openBrowser}`, `share.{systemSheet,saved}` |

Ton: BANNED listesi geçerli; "incele-" kökü yok; "ücretsiz" sözü yok.

### S3.5 Analitik (`lib/analytics.ts`)

`SPRINT3_EVENTS = ghost_guide_shown, routine_rest_day, routine_freeze_used, progress_no_change_shown, barber_card_opened` — **yüksüz**. Değişen: `share_card_created { withPhoto, kind? }`. Var olan: `referral_claimed { ok }`. Mobil **aynı adları** kullanır (`posthog-react-native` aynı `track`; ayrı `mobile_*` adı yok — platform PostHog SDK'nın kendi özelliğidir). Kılavuz noktası, seri sayısı, skor farkı, kod, fotoğraf olaylara girmez (`sanitizeProps` + tip).

### S3.6 Veritabanı ve saklama (yalnız dosya; canlı projeye push onay ister; canlı proje 0010–0014'ü de almadı)

- **0015_v2_faz6.sql** (W6; ÖNERİ): `routine_freezes (user_id, freeze_date date, created_at; pk (user_id, freeze_date))`, RLS sahip `select/insert/delete`; trigger `routine_freeze_limit()` takvim ayında `> 1` satırı reddeder (SQL sabiti; env ile değil — kurucu sayıyı değiştirirse migration); `public.ops_daily_tryon_quality(p_days)` RPC. Web/mobil `routine_freezes`'i `routine_logs` gibi doğrudan RLS ile okur/yazar; `canUseFreeze` istemci UX'i, trigger sunucu kapısı.
- Hayalet kılavuz ve ilerleme fotoğrafları **veritabanına girmez** (IndexedDB / sanal alan).
- `lib/db/types.ts` aynası W6 tarafından `routine_freezes` ile güncellenir; `pnpm db:types` push sonrası.

### S3.7 Açık maddeler ve kurucudan beklenenler

1. Affedici seri sayıları (haftada dinlenme, ayda dondurma) — ÖNERİ; `placeholder:true`.
2. Berber kartı önden/yandan stil görselleri (varlık yok; KB §8 ONAYLI ÖNERİ'nin eksik parçası).
3. Davet kilidi cihaz doğrulaması (KB §11.15) — `verifyReferralDevice` yer tutucu.
4. RevenueCat/App Store/Play ürünleri: `one_time_report` (+ tanıtım), `weekly`, `monthly` (yıllık bayrakla); fiyat kademeleri; Apple Small Business.
5. Google/Apple OAuth: Supabase sağlayıcıları (web'de var), **Apple Services ID + `aura://auth/callback` yönlendirme izni**, Android için Google istemci kimliği; e-posta OTP kalıyor mu (KB §11.11).
6. Mobil gizlilik proxy testi (mitmproxy, `mobile/tests/privacy/`) gerçek cihazda; `oval`/`ghost` kuralı eklenir.
7. Admin oran eşiği (%5) — CLAUDE NOTU.

### S3.8 T2 kararları ve sapmalar

| # | Karar | Not |
|---|---|---|
| 1 | `mobile/app/plan/[analysisId].tsx` → `mobile/app/plan/[id]/index.tsx` (`git mv`; param `id`), çağrılar (`(tabs)/plan.tsx`, `ScoreView.tsx`) güncellendi | expo-router aynı seviyede iki farklı dinamik ad kabul etmez; web `/plan/[id]` ile aynı |
| 2 | `POST /api/referral/claim` açılmadı; `POST /api/referral` claim'dir | Çift rota yok; mobil `aura.referral.claim` |
| 3 | `NOISE_BAND` `lib/config/scoring.ts`'e taşındı; `engine.h2.server.ts` yeniden dışa aktarır | Motor dosyalarına dokunulmadı; `engineH2Config.test` aynen geçer |
| 4 | `SessionProvider.aura` eklendi (T2 paylaşılan dosya) | İzler `useSession().aura` kullanır; `api` (ham) kalır |
| 5 | Mobil ESLint M1 listesi genişletildi (S3.2) | `sharedV2.test` kuralı yapılandırmadan okur |
| 6 | Yer tutucu ekranlar `mobile.stub.*` ile derlenir; sprint sonunda hiçbiri kalmamalı (W7a/W7b kapanış şartı) | `giris`, `cinsiyet`, `plan/[id]/anket` |
| 7 | `routine_freezes` sunucuda (RLS + trigger) — ÖNERİ; W6 bayraksız `placeholder` notu ile | Cihazlar arası tutarlılık; limit sunucu kapısı |

### S3.9 W6 uygulama notları (web Faz 6, 4 Kasım 2026)

| Konu | Uygulama | Not |
|---|---|---|
| Paylaşım kartı | `renderShareCard(spec, photo?, labels?)` → JPEG blob; `drawShareCard(ctx, spec, w, h, photo?, labels?)` saf (sahte bağlamla test); `shareSpecIssues` boş değilse `ShareSpecError`, tuvale hiçbir şey çizilmez. Eski `ShareCardInput` `specFromLegacyInput` ile skor kartına çevrilir (bir sürüm). `labels` tr.json `share.v2.labels.*` (`Genel skor`, `Potansiyel`). | `ShareCardButton` `strongest?: { sub, label, line }` alır (ResultV2View `strongestSub` + `held[0]`); `BarberShareButton` BarberCard diyaloğunda (`barber_card_opened`). `audience:"marketing"` bu arayüzden üretilmez. |
| Hayalet kılavuz | Web, çizgiyi **ham kare koordinatında** saklar: `mirrored:false` (galeri ve kamera karesi aynı), canlı önizleme aynalı olduğundan `GhostGuide mirror={true}` ile çizer (`ghostPolylines` x'i çevirir). `ProgressPhoto.ghost` yalnız "ilerlememe kaydet" işaretliyken yazılır (kullanıcı seçimi); `latestGhostOutline()` en yeni geçerli kaydı verir. `SelfieCamera overlay?: ReactNode` (yalnız live/countdown). | Mobil (W7b) `ProgressEntry.ghost` için aynı kural: ham kare koordinatı + `mirror` çizimde. Gerçek cihazda yaw/ayna doğrulaması ELLE. |
| Affedici seri | `lib/routine/calendar.ts`: `recentDays()` (7 günlük şerit; "rest" yalnız zincir içinde affedilen gün), `freezeStoreError()` (0015 trigger mesajı `routine_freeze_limit: <neden>`, 23505, 42P01/PGRST205 → `unavailable`). `routine_freezes` yoksa dondurma bölümü gizlenir, seri yine affedici hesaplanır. İstemcide `getRoutineForgiving()` env okuyamaz (NEXT_PUBLIC_ yok) → varsayılan + `placeholderNote`. | `routine_rest_day` oturum başına günde bir (sessionStorage). |
| İlerleme | `lib/progress/trend.ts`: `latestChange(points, band)` (son iki analiz; kalibrasyon farklıysa `change:null`), `comparable()`. `ScoreTrend band?` prop + `ScoreChangeNote` (`progress.v2.ownHistoryNote` eklendi). | `progress_no_change_shown` analiz kimliği başına bir kez. |
| Davet girişi | `components/paywall/ReferralClaimForm.tsx` (`enabled` verilmezse GET /api/referral 404 → çizilmez), `lib/referral/claim.ts` (`claimErrorKey`, `referralRatio`). Yerleşim: çekim özeti ("Analizi başlat" öncesi, `resumeAnalysisId` yokken) + `ReferralBlock` altında; `ReferralBlock` kilitli sonuçta (`ScoreViewV2`) da çizilir, `initial` fikstür prop'u. `referral.claim.errors.format`, `paywall.v2.referral.{pending,unlocks,unlockedNote}` eklendi. | Ayrı claim rotası yok (S3.8 #2). |
| Admin | `GET /api/admin/metrics` += `tryonQuality[]`, `tryonQualityAvailable` (RPC yoksa PGRST202/42883 → false, metrikler çökmez), `tryonBrokenRateAlert` (`lib/config/ops.ts`, env `OPS_TRYON_BROKEN_RATE_ALERT`, varsayılan 0,05). `lib/ops/tryonQuality.ts` `summarizeTryonQuality(rows, today, 7, alertAt)`. `MetricsPanel initial?` fikstür. | `/debug/admin?alert=1`. |
| RevenueCat tek seferlik | `productFromStoreId(id, env)` (env `REVENUECAT_PRODUCT_ONE_TIME_REPORT_ID`, `…_PROMO_ID`; env yoksa sezgisel `one_time|report|rapor`), `oneTimePurchaseFromWebhook(body)`; webhook `NON_RENEWING_PURCHASE` → `purchases` insert (payment_events tekrarında yazılmaz). | Ürün kimlikleri AÇIK (S3.7 #4). |
| Sahiplik dışı dokunuşlar | `components/analysis/result/ResultV2View.tsx` (strongest prop, 4 satır), `components/analysis/ScoreView.tsx` (`ScoreViewV2`'ye `<ReferralBlock />`, 1 satır). | Diğer izler aynı satırlara dokunmaz. |
| Fikstür sayfaları | `/debug/paylas?view=kart|davet|hayalet`, `/debug/rutin?view=rutin|ilerleme&state=…`, `/debug/admin?alert=1` (yalnız development). | Ekran görüntüleri `.smoke/shots-v2-s3/`. |

### S3.10 Entegrasyon notları (M9 birleştirme, 4 Kasım 2026)

| Konu | Karar | Not |
|---|---|---|
| `mobile/app/analiz/[id].tsx` | W7a sürümü (kilit dallanması, bekleyen setin `/run`'a gönderimi, "Çekime dön") + W7b `ResultV2View` (aynı props: `initial`, `onUpdate`); W7a'nın `ResultBranch` yer tutucusu silindi. | Yoklama ve kart kart açılış `ResultV2View` içinde (`useAnalysisPoll`). |
| `ClientAnalysisV2.detections` | Yeni alan: `{ glassesDetected, headCoveringDetected } \| null` (`PhotoDetections`, `lib/score/present.ts readDetections`). Yalnız **hak var + tamamlandı** iken `observations`'tan iki boolean okunur; başka gözlem alanı sızmaz; aksi hâlde `null`. | Mobil `plan/[id]/anket` ön dolumu (Ç17) web `(gated)/plan/[id]/anket` ile eşit; `null` → kullanıcı seçer. Web istemcisi alanı kullanmaz (sunucuda satırdan okur). |
| Mobil ortak saf modüller | `mobile/src/features/routine/forgivingView.ts` → `recentDays`/`freezeStoreError` `lib/routine/calendar.ts`'ten; `mobile/src/features/progress/change.ts` → `latestChange`/`comparable` `lib/progress/trend.ts`'ten (yeniden dışa aktarım; mobil testler aynı). `ReferralClaimForm` (mobil) `lib/referral/claim.ts claimErrorKey` kullanır (`device_check_failed` → `device`; boş kod → `format`). | Kopyalar kaldırıldı; `sharedV2.test` iki modülü de içe aktarır ve M1 kuralında serbest olduklarını doğrular. |
| Hayalet kılavuz (mobil) | `tara.tsx`: oturumda çizgi yoksa `getLatestGhost()` (ilerleme dizini, yalnız cihazda) okunur; "ilerlememe kaydet" işaretliyken `addProgressPhoto(uri, { analysisId, ghost })` ile ham kare koordinatında saklanır (web ile aynı kural, S3.9). | Ayna yönü gerçek cihazda ELLE doğrulanır. |
| Açık kalanlar | Web `ReferralBlock` kilitli sonuçta ve paywall sheet 1. sayfada ayrı ayrı çizilir (iki GET /api/referral, `referral_code_viewed` iki kez olabilir). `PlanDto.reportId` yok → mobil plan ekranında rapor geri bildirimi düğmesi yok. Mağaza ürün kimlikleri, Apple/Google native OAuth yapılandırması, RevenueCat webhook ürün eşlemesi kurucuda (S3.7). | — |

### S3.11 İnceleme düzeltmeleri (M9, 4 Kasım 2026)

| Konu | Karar | Not |
|---|---|---|
| Davet kilidi (KB Ç12) uçtan uca | `canConsumePurchaseFor(access, status)` artık `access.referralUnlock` ile de `device_only/queued/failed` satırda `true` döner; `promoteAndStart` satın alma yoksa ve davet açıksa **bağlama yapmadan** işi başlatır (`entitled` açılmaz). `presentV2` değişmedi: tamamlanınca yalnız `overall.value` (aralık/yüzdelik `null`). Web `ScoreHeroLocked`/mobil `LockedHero` `overall` prop'uyla sayıyı çizer; `ScoreViewV2`/`LockedResult` `queued/running/failed` için `analysis.stage.*` notu gösterir. | Davetle açılan kullanıcı `running` satırda sayfayı yenilerse kilitli ekran + "hazırlanıyor" notu görür; yoklama yalnız `ResultV2View`'da (açık kalan). |
| Affedici seri hakkı | `ForgivingStreak.restUsedThisWeek` eklendi (zincir içinde köprülenen, bugünün ISO haftasındaki dinlenme günleri); `restDaysLeftThisWeek` aynı yürüyüşten türer. `recentDays` yalnız daha eski bir "yapıldı" günüyle doğrulanan eksik günü `rest` etiketler (pencere dışına da bakar); web `routine_rest_day` olayı `restDaysBridged > 0` ile kapılı (mobil ile aynı). | Zincir dışı eksik günler (rutin başlamadan önce / zincir koptuktan sonra) hakkı harcamaz. |
| Paylaşım kartı | `ShareSpecIssue` `"disclaimer_missing"`: zorunlu not boşsa kart çizilmez (web `drawShareCard`, mobil `ShareCardButtonV2`/`BarberCard` aynı kapıdan geçer). | — |
| `/api/referral` | Eşzamanlı çift kayıt: `unique(referee_id)` ihlali (`23505`) → `BAD_INPUT already_claimed` (500 değil). | — |
| Gizlilik testi | Hayalet kılavuz kuralı GhostOutline **şeklini** yakalar (`"oval":[[ … "mouth":[[ "nose":[`), sözcüğü değil (`faceShape.primary:"oval"` meşru). Akış "ilerlememe kaydet"i işaretler, `/tara`'ya döner ve `[data-ghost-guide]` çizildiğini doğrular; sonra gövde kuralları tüm isteklere uygulanır. | PRIVACY_FACE_VIDEO olmadan koşmaz (CLAUDE.md). |
| Mobil çekim durumu kullanıcıya bağlı | `clearCaptureState()` (bekleyen set dosyaları + oturum selfie'si **dosyasıyla** + hayalet çizgi): `signOut`, hesap silme ve `onAuthStateChange`'de kullanıcı değişince/düşünce. `sweepTransientFiles()` kök düzen yüklenirken `Paths.cache` içindeki `ImagePicker/`, `ImageManipulator/` ve `aura-*.jpg` kalıntılarını siler (ilerleme fotoğrafları belge dizininde, dokunulmaz). expo-image-picker kopyaları hash+analiz kopyası alınır alınmaz silinir (`ViewCamera.finalize` / çoklu seçim döngüsü, `ShareCardButtonV2`). | `mobile/tests/transientFilesV2.test.ts` (jest-expo bellek içi dosya sistemi). |
| Mobil `/tara` | `useGate` kapısı (web `(gated)` layout); ilerleme kopyası + hayalet çizgi set gönderiminden **önce**, kararlı oturum selfie kopyasından (`aura-session-selfie.jpg`) alınır (hak varsa gönderim set dosyalarını siler); gönderim/istek hatasında bekleyen set düşürülür, dosyalar ekrana döner (çift sahiplik yok); `uploadPendingSet` kodlama hatasını `{ ok:false, api, GENERIC }` olarak döner. | — |
| Mobil eşitlik | Rızalar → `/tara` (`CAPTURE_PATH`); `CaptureSummary` davet kodu formu (`collapsible probe`, bayrak kapalıysa çizilmez); `LockedResult` `ReferralBlock` (plan önizlemesi → davet → oranlar); `/dene` çekimden dönüşte bekleyen istek bir kez kendiliğinden çalışır; `HairLossCard` doktor katmanına kaydırır; hak varken `failed` → `FailedCard` (hata kodu + ipucu), `device_only` → `PendingUploadCard`. | — |
