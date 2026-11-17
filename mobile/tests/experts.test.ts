import { buildExpertsPath, latestCompletedAnalysisId, toRequestBody, validateRequestForm } from "@/mobile/src/features/experts/model";
import { isMobileFeatureEnabled } from "@/mobile/src/lib/flags";

describe("Uzman Ağı yardımcıları (M8)", () => {
  it("filtre yolu: boş filtre yok, bilinmeyen uzmanlık atlanır, şehir kırpılır", () => {
    expect(buildExpertsPath("", "")).toBe("/api/experts");
    expect(buildExpertsPath("dermatoloji", "  İstanbul ")).toBe("/api/experts?specialty=dermatoloji&city=%C4%B0stanbul");
    expect(buildExpertsPath("bilinmeyen", "")).toBe("/api/experts");
  });
  it("form doğrulama sunucu şemasını yansıtır", () => {
    expect(validateRequestForm({ name: "A", contact: "+905551112233", message: "" })).toBe("name");
    expect(validateRequestForm({ name: "Ayşe", contact: "123", message: "" })).toBe("contact");
    expect(validateRequestForm({ name: "Ayşe", contact: "a@b.co", message: "x".repeat(601) })).toBe("message");
    expect(validateRequestForm({ name: "Ayşe", contact: "a@b.co", message: "" })).toBeNull();
  });
  it("gövde: boş mesaj ve paylaşım gönderilmez", () => {
    expect(toRequestBody("p1", { name: " Ayşe ", contact: " a@b.co ", message: "  " }, null)).toEqual({ partnerId: "p1", name: "Ayşe", contact: "a@b.co", message: undefined, shareAnalysisId: undefined });
    expect(toRequestBody("p1", { name: "Ayşe", contact: "a@b.co", message: "m" }, "an1").shareAnalysisId).toBe("an1");
  });
  it("son tamamlanmış analiz", () => {
    expect(latestCompletedAnalysisId([{ id: "x", status: "processing" }, { id: "y", status: "completed" }])).toBe("y");
    expect(latestCompletedAnalysisId(null)).toBeNull();
  });
  it("mobil bayrak yalnız 'true' ile açılır (varsayılan kapalı)", () => {
    expect(isMobileFeatureEnabled("expertNetwork")).toBe(false);
    expect(isMobileFeatureEnabled("expertNetwork", { expertNetwork: "true" })).toBe(true);
    expect(isMobileFeatureEnabled("expertNetwork", { expertNetwork: "TRUE " })).toBe(true);
    expect(isMobileFeatureEnabled("weekPass", { weekPass: "1" })).toBe(false);
  });
});
