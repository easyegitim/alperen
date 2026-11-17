import { describe, expect, it } from "vitest";
import { CoachReport } from "@/lib/ai/reportSchema";
import { cutAtWord, fitReportLengths } from "@/lib/coach/fitLengths";

const pick = (id: string) => ({ presetId: id, why: "Yüz şekline uyar.", barberScript: "Berbere: kısa yanlar.", maintenance: "3–5 haftada bir." });

function base(): CoachReport {
  return {
    summary: "Kısa özet.",
    scoreNarrative: "Nötr açıklama.",
    hair: [pick("textured_crop")],
    beard: [],
    hairColor: null,
    skincare: { morning: [{ stepType: "st_spf", note: "Her sabah." }], evening: [], weekly: [] },
    faceContours: { enabled: false, tips: [] },
    exercises: [],
    habits: [{ id: "hb_sleep", target: "7–9 saat" }],
    style: ["Sade üstler."],
    linkedActions: { skin: ["st_spf"], hair: [], grooming: [], jawline: [] },
    seeProfessional: null,
  };
}

const words = (n: number) => Array.from({ length: n }, (_, i) => `sözcük${i}`).join(" ");

describe("cutAtWord", () => {
  it("sınır içindeki metne dokunmaz", () => {
    expect(cutAtWord("kısa metin", 20)).toBe("kısa metin");
  });
  it("son tam sözcükte keser, sondaki noktalamayı atar", () => {
    expect(cutAtWord("bir iki, üç dört", 10)).toBe("bir iki");
    const s = words(60);
    const out = cutAtWord(s, 100);
    expect(out.length).toBeLessThanOrEqual(100);
    expect(s.startsWith(out)).toBe(true);
    expect(out.split(" ").every((w) => /^sözcük\d+$/.test(w))).toBe(true);
  });
  it("tam sınırda sözcük biterse oradan keser; boşluksuz uzun sözcükte sert keser", () => {
    expect(cutAtWord("abcde fgh", 5)).toBe("abcde");
    expect(cutAtWord("a".repeat(30), 10)).toBe("a".repeat(10));
  });
});

describe("fitReportLengths (engine spec §9.6)", () => {
  it("aşırı uzun alanlar sınırına kesilir, diziler en çok öğeye iner ve sonuç CoachReport.safeParse'tan geçer", () => {
    const r = base();
    const long = {
      ...r,
      summary: words(120),
      scoreNarrative: words(100),
      hair: [pick("a"), pick("b"), pick("c"), pick("d"), pick("e")].map((p) => ({ ...p, why: words(80) })),
      hairColor: { ...pick("x"), barberScript: words(80) },
      skincare: { ...r.skincare, weekly: Array.from({ length: 6 }, () => ({ stepType: "st_clay_mask_weekly", note: words(50) })) },
      style: Array.from({ length: 9 }, () => words(60)),
      seeProfessional: { specialty: "dermatoloji", text: `${words(60)} olabilir` },
    };
    expect(CoachReport.safeParse(long).success).toBe(false);
    const fitted = fitReportLengths(long);
    const parsed = CoachReport.safeParse(fitted);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.summary.length).toBeLessThanOrEqual(450);
    expect(parsed.data.hair).toHaveLength(3);
    expect(parsed.data.hair[0].presetId).toBe("a");
    expect(parsed.data.skincare.weekly).toHaveLength(3);
    expect(parsed.data.style).toHaveLength(4);
    expect(parsed.data.hairColor?.barberScript.length).toBeLessThanOrEqual(240);
    expect(long.summary.startsWith(parsed.data.summary)).toBe(true);
  });
  it("geçerli rapor değişmeden kalır; girdi değiştirilmez", () => {
    const r = base();
    const copy = structuredClone(r);
    expect(fitReportLengths(r)).toEqual(r);
    expect(r).toEqual(copy);
  });
  it("yanlış tipler onarılmaz (şema denetiminde reddedilir); null ve JSON dışı değerler olduğu gibi döner", () => {
    const bad = { ...base(), hair: "değil-dizi", summary: 5 };
    expect(CoachReport.safeParse(fitReportLengths(bad)).success).toBe(false);
    expect(fitReportLengths(null)).toBeNull();
    expect(fitReportLengths("metin")).toBe("metin");
  });
});
