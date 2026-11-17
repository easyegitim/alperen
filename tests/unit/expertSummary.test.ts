import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EXPERT_OBS_KEYS, EXPERT_SUB_KEYS, expertAnalysisSummary, partnerRequestEmail, type ExpertSummaryRow } from "@/lib/experts/email";

// engine spec §8 / §11 #18 (F19): partner e-postası yalnız izinli gözlem anahtarlarını ve değerlendirilmiş bakım alt
// skorlarını taşır; yapısal skor, yapısal metin, oran veya fotoğraf koşulu yok.

// Satırda genel skor, potansiyel ve yüz şekli olsa bile (eski select veya ileride geniş bir okuma) özete girmez.
const fullRow = (over: Partial<ExpertSummaryRow> = {}): ExpertSummaryRow & Record<string, unknown> => ({
  overall: "5.6",
  potential: 6.4,
  face_shape: "oval",
  subscores: { harmony: 4.1, eyes: 4.4, jawline: 3.9, skin: 5.2, hair: 5.5, grooming: 5.9, extra: 9 },
  observations: {
    skin: "Yanaklarda birkaç küçük aktif sivilce var.",
    hair: "Saç düzenli.",
    brows: "Kaşlar düzenli.",
    facialHair: "Sakal hatları yumuşamış.",
    harmony: "Simetri belirgin biçimde sapıyor.",
    eyes: "Göz aralığı geniş.",
    jawline: "Çene hattı dar.",
    photo: "Işık loş.",
  },
  ...over,
});

const signals = (notAssessed: { sub: "skin" | "hair" | "grooming"; reason: "excluded" | "not_visible" }[]) => ({
  engine: "hybrid.v1",
  improveFirst: [],
  explain: {},
  notAssessed,
  captureHints: [],
  obs: { hair: { visibility: "visible" } },
});

describe("expertAnalysisSummary (izin listesi)", () => {
  it("izin listeleri sabit", () => {
    expect([...EXPERT_OBS_KEYS]).toEqual(["skin", "hair", "brows", "facialHair"]);
    expect([...EXPERT_SUB_KEYS]).toEqual(["skin", "hair", "grooming"]);
  });
  it("eski satır: yapısal anahtarlar ve bilinmeyen anahtarlar atılır", () => {
    const s = expertAnalysisSummary(fullRow());
    expect(s.subscores).toEqual({ skin: 5.2, hair: 5.5, grooming: 5.9 });
    expect(Object.keys(s.observations ?? {})).toEqual(["skin", "hair", "brows", "facialHair"]);
    expect(Object.keys(s).sort()).toEqual(["observations", "subscores"]);
    const json = JSON.stringify(s);
    for (const banned of ["harmony", "eyes", "jawline", "photo", "Simetri", "Göz aralığı", "Çene hattı dar", "extra", "overall", "potential", "5.6", "6.4", "oval"]) {
      expect(json).not.toContain(banned);
    }
  });
  it("hybrid.v1: hariç tutulan ve bu çekimde görünmeyen alan gönderilmez", () => {
    const s = expertAnalysisSummary(
      fullRow({ engine_version: "hybrid.v1", signals: signals([{ sub: "hair", reason: "excluded" }, { sub: "skin", reason: "not_visible" }]) }),
    );
    expect(s.subscores).toEqual({ grooming: 5.9 });
  });
  it("hybrid.v1 sinyali ayrıştırılamazsa bakım skoru gönderilmez; tüm alanlar dışlanırsa null", () => {
    expect(expertAnalysisSummary(fullRow({ engine_version: "hybrid.v1", signals: { bozuk: true } })).subscores).toBeNull();
    expect(expertAnalysisSummary(fullRow({ subscores: null, observations: "metin" }))).toEqual({ subscores: null, observations: null });
  });
});

describe("partnerRequestEmail özeti", () => {
  beforeEach(() => vi.stubEnv("REFERRAL_SIGNING_SECRET", "test-secret"));
  afterEach(() => vi.unstubAllEnvs());
  it("tam satırdan kurulan e-postada yapısal anahtar ve metin yok", () => {
    const mail = partnerRequestEmail({
      partnerName: "Dr. Test",
      refCode: "AURA-TEST",
      specialty: "dermatoloji",
      contact: "0500",
      name: "Ad",
      message: null,
      summary: expertAnalysisSummary(fullRow()),
    });
    for (const banned of ["harmony", "eyes", "jawline", "Simetri", "Çene hattı dar", "photo", "Genel skor", "Potansiyel", "Yüz şekli", "5.6", "6.4", "oval"]) {
      expect(mail.html).not.toContain(banned);
    }
    expect(mail.html).toContain('"skin":5.2');
  });
});
