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
