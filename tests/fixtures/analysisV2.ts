// Ödeme sonrası sonuç ekranı için sabit (sahte) ClientAnalysisV2 verisi: testler ve /debug/sonuc önizlemesi.
// Gerçek bir kullanıcı, fotoğraf ya da model çıktısı değildir; motor (W3) gelmeden ekran bu veriyle doğrulanır.
import { SUB_KEYS_V2 } from "@/lib/config/teaser";
import type { ClientSignalsV2, ReportV3, SectionKey } from "@/lib/score/contract";
import { deviceResultFromGeometry, toClientAnalysisV2, type AccessV2, type AnalysisRowV2, type ClientAnalysisV2 } from "@/lib/score/present";

export const FIXTURE_GEOMETRY = {
  version: "geo-v1" as const,
  quality: { yaw: 1, pitch: 2, roll: 0, brightness: 120, sharpness: 90, passed: true },
  metrics: { lengthRatio: 1.4, jawRatio: 0.84, foreheadRatio: 0.9, fwhr: 1.9, canthalTiltDeg: 3, lowerToMiddle: 1.2, thirds: { upper: 0.31, middle: 0.34, lower: 0.35 }, hairlineFound: true },
  faceShape: { primary: "oval" as const, secondary: "square" as const, confidence: 0.6 },
  capturedAt: "2026-11-04T10:00:00Z",
};

const EXPLANATIONS: ClientSignalsV2["explanations"] = {
  harmony: { lookedAt: ["Sağ–sol denge", "Üst, orta ve alt bölüm oranları", "Yan profilde burun–çene hizası"], held: ["Bölümler birbirine yakın oranlarda"], lowered: ["Sağ ve sol yanak hizasında küçük fark"], raise: [{ step: "Üstte hacimli kesim", effect: "Yüz bölümleri daha dengeli algılanır" }], confidenceNote: "3 açı, iyi ışık" },
  eyes: { lookedAt: ["Göz aralığı", "Göz ekseni eğimi", "Kaş–göz mesafesi"], held: ["Göz aralığı dengeli"], lowered: [], raise: [{ step: "Kaş çizgisini düzenli tut", effect: "Göz bölgesi daha açık görünür" }], confidenceNote: "Ön ve 45° açı" },
  jawline: { lookedAt: ["Çene–elmacık genişliği oranı", "Yan profilde çene geçişi"], held: ["Çene hattı profilde belirgin"], lowered: ["Alt yüzde yumuşak geçiş"], raise: [{ step: "Hafif sakal", effect: "Çene hattı daha net okunur" }], confidenceNote: "Yan profil kullanıldı" },
  skin: { lookedAt: ["Alın ve yanak dokusu", "T bölgesi parlaması", "Göz altı tonu"], held: ["Doku düzenli"], lowered: ["T bölgesinde parlama", "Göz altında hafif ton farkı"], raise: [{ step: "Günlük SPF", effect: "Ton eşitliği belirgin artar" }, { step: "Hafif nemlendirici", effect: "Parlama azalır" }], confidenceNote: "Ön fotoğraf, dengeli ışık" },
  hair: { lookedAt: ["Kesimin formu", "Saçın düzeni", "Alın çizgisi"], held: ["Kesim yüz şekline uygun"], lowered: ["Uçlar dağınık"], raise: [{ step: "Kesimi yenile", effect: "Form daha net durur" }], confidenceNote: "Saç çizgisi fotoğrafı yok" },
  grooming: { lookedAt: ["Dudak yüzeyi", "Sakal hattı", "Genel çekim özeni"], held: ["Sakal hattı düzenli"], lowered: ["Dudaklarda hafif kuruluk"], raise: [{ step: "Dudak balmı", effect: "Yüzey düzelir" }], confidenceNote: "2 açı" },
  brows: { lookedAt: ["Kaş yoğunluğu", "Çizgi dışı kıllar", "İki kaşın dengesi"], held: ["Kaşlar yoğun ve dengeli"], lowered: ["Çizgi dışında birkaç kıl"], raise: [{ step: "Kaş düzeni", effect: "Çizgi daha temiz okunur" }], confidenceNote: "Ön fotoğraf" },
};

export const FIXTURE_SIGNALS: ClientSignalsV2 = {
  engine: "hybrid.v2",
  explanations: EXPLANATIONS,
  improveFirst: [
    { sub: "skin", stepId: "st_spf", step: "Günlük SPF", gain: 0.4 },
    { sub: "hair", stepId: "textured_crop", step: "Kesimi yenile", gain: 0.3 },
    { sub: "brows", stepId: "lv_brow_tidy", step: "Kaş düzeni", gain: 0.2 },
  ],
  notAssessed: [],
  faceShapeDetailed: { shape: "square", secondary: "oval", reason: "Yan profilde çene köşeleri belirgin; ön fotoğraftaki yumuşak geçiş ışıktan kaynaklanıyor olabilir." },
  captureHints: ["lighting"],
  viewsUsed: ["front", "profile_left", "left45"],
};

export const FIXTURE_REPORT: ReportV3 = {
  version: "report.v3",
  letter: "En güçlü yanın cilt dokun ve dengeli kaşların. En büyük fırsat saç formu: kesim yenilendiğinde yüz bölümleri daha dengeli okunur. Plan bunlara göre hazırlandı.",
  regions: [
    { key: "brows", strength: "Yoğun ve dengeli kaşlar.", seen: "Çizgi dışında birkaç kıl.", improvements: ["Kaş düzeni"] },
    { key: "eyeArea", strength: "Göz aralığı dengeli.", seen: "Göz altında hafif ton farkı.", improvements: [] },
    { key: "skin", strength: "Düzenli doku.", seen: "T bölgesinde parlama.", improvements: ["Günlük SPF", "Hafif nemlendirici"] },
    { key: "hair", strength: "Kesim yüz şekline uygun.", seen: "Uçlar dağınık.", improvements: ["Kesimi yenile"] },
  ],
  measures: [
    { key: "canthalTiltDeg", value: 3, balancedRange: [-2, 6] },
    { key: "jawRatio", value: 0.84, balancedRange: [0.75, 0.95] },
    { key: "fwhr", value: 1.9, balancedRange: [1.7, 2.1] },
  ],
  closing: "Değişim haftalar sürer; ışık ve açı skoru etkiler. Tıbbi tavsiye değildir.",
};

const SUBS = { harmony: 5.4, eyes: 5.9, jawline: 5.1, skin: 6.3, hair: 5.2, grooming: 5.9, brows: 6.1 };
const LOW_SUBS = { harmony: 3.9, eyes: 4.2, jawline: 3.6, skin: 3.4, hair: 3.8, grooming: 4.0, brows: 4.1 };
const rangesFor = (subs: Record<string, number>) => Object.fromEntries(SUB_KEYS_V2.map((k) => [k, [Math.round((subs[k] - 0.2) * 10) / 10, Math.round((subs[k] + 0.2) * 10) / 10]]));

export function fixtureRow(over: Partial<AnalysisRowV2> = {}): AnalysisRowV2 {
  return {
    id: "00000000-0000-4000-8000-00000000f1x1",
    status: "completed",
    created_at: "2026-11-04T10:00:00Z",
    face_shape: "oval",
    overall: 5.8,
    potential: 6.9,
    subscores: SUBS,
    gains: null,
    observations: null,
    geometry: FIXTURE_GEOMETRY,
    calibration_version: "h2",
    engine_version: "hybrid.v2",
    signals: FIXTURE_SIGNALS,
    device_result: deviceResultFromGeometry(FIXTURE_GEOMETRY),
    score_range: { overall: [5.6, 6.0], potential: [6.6, 7.2], subscores: rangesFor(SUBS) },
    percentile: 61.5,
    sections_ready: ["device", "overall", "subscores", "potential", "faceShape", "explanations", "improveFirst", "report"],
    set_key: null,
    report: FIXTURE_REPORT,
    face_shape_override: null,
    ...over,
  };
}

export const ENTITLED: AccessV2 = { entitled: true, referralUnlock: false, percentile: true };

export type FixtureState = "completed" | "reveal" | "queued" | "low" | "failed" | "device_only";

/** Önizleme durumları: tamam / yarı açılmış (ilk 3 kart) / sırada / düşük skor / başarısız / ödeme alındı-görsel yok. */
export function fixtureAnalysis(state: FixtureState = "completed"): ClientAnalysisV2 {
  switch (state) {
    case "reveal": {
      // Yarı açılmış durum: ilk üç bölüm hazır, gerisi bekliyor. NOT: bugünkü present.ts (CONTRACTS_V2 §3.4) queued/running
      // satırda her bölümü kilitli gönderir; bu sabit veri, motor çalışırken hazır bölümlerin hak sahibine açıldığı
      // (önerilen) sözleşmeyi temsil eder. İstemci iki durumda da çalışır: bugün açılış completed'da sırayla oynar.
      const sections: SectionKey[] = ["device", "overall", "subscores"];
      const done = toClientAnalysisV2(fixtureRow({ report: undefined, signals: { ...FIXTURE_SIGNALS, explanations: {}, improveFirst: [], faceShapeDetailed: null } }), ENTITLED);
      const openNull = { value: null, locked: false } as const;
      return { ...done, stage: "running", sectionsReady: sections, potential: openNull, report: openNull, improveFirst: openNull, faceShape: done.faceShape ? { prelim: done.faceShape.prelim, agree: null } : null };
    }
    case "queued":
      return toClientAnalysisV2(fixtureRow({ status: "queued", sections_ready: ["device"], overall: null, potential: null, subscores: null, signals: null, score_range: null, percentile: null, report: undefined }), ENTITLED);
    case "low":
      return toClientAnalysisV2(fixtureRow({ overall: 3.8, potential: 5.1, subscores: LOW_SUBS, score_range: { overall: [3.6, 4.0], potential: [4.8, 5.4], subscores: rangesFor(LOW_SUBS) }, percentile: 12.4 }), ENTITLED);
    case "failed":
      return toClientAnalysisV2(fixtureRow({ status: "failed", overall: null, potential: null, subscores: null, signals: null, score_range: null, report: undefined, failure: { code: "CAPTURE_QUALITY", retryable: true } }), ENTITLED);
    case "device_only":
      return toClientAnalysisV2(fixtureRow({ status: "device_only", overall: null, potential: null, subscores: null, signals: null, score_range: null, percentile: null, sections_ready: ["device"], report: undefined }), ENTITLED);
    default:
      return toClientAnalysisV2(fixtureRow(), ENTITLED);
  }
}
