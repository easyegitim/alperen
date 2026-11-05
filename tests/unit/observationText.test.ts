import { describe, expect, it } from "vitest";
import { SUB_KEYS } from "@/lib/config/teaser";
import { observationFor } from "@/lib/score/observationText";

const legacy = {
  skin: "yanaklarda hafif parlama var",
  hair: "Saç düzenli ve kesim formunu koruyor",
  brows: "kaşlar düzenli",
  facialHair: "sakal hatları net.",
};

const hybrid = {
  skin: "Birkaç küçük aktif sivilce var; doku pürüzsüz.",
  hair: "Saç düzenli; kesimin formu belirgin.",
  brows: "Kaşlar düzenli.",
  facialHair: "Sakal hatları net. Dudaklar nemli görünüyor.",
};

describe("observationFor (sözleşme C11)", () => {
  it("eski satır: cümle büyük harfle başlar, noktayla biter", () => {
    expect(observationFor("skin", legacy)).toBe("Yanaklarda hafif parlama var.");
    expect(observationFor("hair", legacy)).toBe("Saç düzenli ve kesim formunu koruyor.");
    expect(observationFor("grooming", legacy)).toBe("Kaşlar düzenli. Sakal hatları net.");
  });

  it("hybrid satır: tam cümleler olduğu gibi, tek boşlukla birleşir", () => {
    expect(observationFor("skin", hybrid)).toBe(hybrid.skin);
    expect(observationFor("grooming", hybrid)).toBe("Kaşlar düzenli. Sakal hatları net. Dudaklar nemli görünüyor.");
  });

  it("birleşimden sonra küçük harfle başlayan cümle yok", () => {
    for (const obs of [legacy, hybrid]) {
      for (const k of SUB_KEYS) {
        const s = observationFor(k, obs);
        if (s === null) continue;
        expect(s).not.toMatch(/[.!?]\s+[a-zçğıöşü]/);
        expect(s.charAt(0)).toBe(s.charAt(0).toLocaleUpperCase("tr-TR"));
      }
    }
  });

  it("yapısal alt skorlar her zaman null (satır anahtar taşısa bile)", () => {
    const withStructural = { ...hybrid, harmony: "Uyum metni.", eyes: "Göz metni.", jawline: "Çene metni.", photo: "Işık." };
    expect(observationFor("harmony", withStructural)).toBeNull();
    expect(observationFor("eyes", withStructural)).toBeNull();
    expect(observationFor("jawline", withStructural)).toBeNull();
  });

  it("Türkçe büyük harf: i → İ", () => {
    expect(observationFor("skin", { skin: "izler puanlanmaz" })).toBe("İzler puanlanmaz.");
  });

  it("metin olmayan veya boş değer → null; bakımda tek parça kalır", () => {
    expect(observationFor("skin", null)).toBeNull();
    expect(observationFor("skin", "metin")).toBeNull();
    expect(observationFor("skin", ["a"])).toBeNull();
    expect(observationFor("skin", { skin: 3 })).toBeNull();
    expect(observationFor("hair", { hair: "   " })).toBeNull();
    expect(observationFor("grooming", { brows: "Kaşlar düzenli." })).toBe("Kaşlar düzenli.");
    expect(observationFor("grooming", { brows: 1, facialHair: null })).toBeNull();
  });
});
