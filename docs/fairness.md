# Adalet (önyargı) raporu — durum

**Henüz çalıştırılmadı.** `pnpm fairness` ücretli Gemini çağrısı yapar ve rızalı test seti (50–100 yetişkin; ten tonu Fitzpatrick I–VI, cinsiyet, sakal, gözlük, başörtüsü dengeli) ister. Fotoğraflar yalnız şifreli yerel diskte durur (SPEC 8.8); depoya konmaz.

Bu dosya betik çalıştığında üzerine yazılır. Uydurma sonuç yazılmaz.

## Nasıl çalıştırılır (insan onayıyla)

1. Şifreli diskte klasör: 768 px kare JPEG'ler (`lib/face/crop.ts` çıktısı), dosya adlarında kişi kimliği yok.
2. `manifest.json`:
   ```json
   { "dir": "/Volumes/sifreli/aura-fairness", "items": [ { "file": "0001.jpg", "groups": { "skinTone": "IV", "gender": "f", "beard": "no", "glasses": "no", "headCovering": "yes" } } ] }
   ```
3. `GEMINI_API_KEY=... pnpm fairness /Volumes/sifreli/aura-fairness/manifest.json --calls 3`
4. Çıktı tabloda bir boyut "⛔" ise yayın durur; prompt (`lib/ai/prompts/score.v1.ts`) veya kalibrasyon (`lib/score/calibration.ts`) düzeltilip tekrar çalıştırılır.
5. Her prompt/model değişikliğinde tekrar (SPEC 8.8, 20.1).

Ölçüm mantığı `lib/score/fairness.ts` içinde ve birim testlidir (`tests/unit/fairness.test.ts`).

## hybrid.v1 (Claude gözlemi + kod skoru) — durum: henüz çalıştırılmadı

`SCORE_ENGINE=hybrid.v1` için kapı mutlak düzey değil **alt gruplar arası farktır** (SPEC 8.10, engine spec §12). Ölçüm mantığı `scripts/fairness-report.ts` (`engineFairness`) ve `scripts/engine-tooling.ts` içinde, birim testi `tests/unit/engineTooling.test.ts`. Uydurma sonuç yazılmaz; bu bölüm betik çalışınca rapor çıktısıyla değiştirilir.

| Ölçüt | Sınır |
| --- | --- |
| (a) Yapısal bileşen başına bant içi pay farkı | ≤ 10 puan |
| (b) Alt skor ortalama farkı (Monk başına cilt, sunum başına bakım ve cilt dahil) | ≤ 0,1 |
| (c) Genel skor ortalama farkı | ≤ 0,15 |
| (d) İki değerlendiriciye karşı alan başına κ farkı (Monk kovası, saç tipi) | ≤ 0,1 |
| (e) `too_dark`, elle çekim, `CAPTURE_QUALITY` ret, rötuş ve cilt kapalı oranları farkı | ≤ 5 puan |
| (f) Hariç tutulan grupların tavan (potansiyel) farkı | raporlanır |

Alt gruplar: Monk kovası, sunum, sakal, gözlük, başörtüsü, saçsız, makyaj, saç tipi. Köken bölgesi yalnız çevrimdışı, rızalı değerlendirme setinde tutulur (KVKK m.6); üründe asla.

### Nasıl çalıştırılır (insan onayıyla, ücretli)

1. Şifreli diskte 768 px kare JPEG'ler; dosya adlarında kişi kimliği yok.
2. `manifest.json` her kayıt için `groups`, cihazda üretilmiş `geometry` (yalnız sayılar; landmark dizisi reddedilir), `context` (`headCovering`, `presentation`, `beardPreference`), iki insan değerlendiricinin `labels` (gözlem şeması) ve çekim sırasında kaydedilen `capture` (`tooDark`, `manual`, `rejected`) içerir.
3. `ANTHROPIC_API_KEY=... pnpm fairness <manifest.json> --engine hybrid.v1 --confirm-paid` (bayrak olmadan hiçbir istek atılmaz).
4. Gözlemci karşılaştırması ve tekrar tutarlılığı: `pnpm compare:observers <manifest.json> --repeats 3 --mod-gain 1,1.5,2 --csv out.csv --confirm-paid` (ücretli). Bant önerisi: `pnpm refit:engine --in runs.json` (ücretsiz, ağsız; bantlar yalnız genişler).
5. Bir ölçüt "⛔" ise `ENGINE_STATUS` fitted yapılamaz ve üretim açılamaz (SPEC 19 Faz 6 hybrid.v1 kapısı).
