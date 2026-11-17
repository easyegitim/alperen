import { linePath, trendScale } from "@/mobile/src/components/analysis/trendMath";
import { addEntry, orphanFiles, parseIndex, removeEntry, serializeIndex, setNote } from "@/mobile/src/features/progress";
import { CARD_SIZES, shareCardLayout } from "@/mobile/src/features/share/layout";

describe("ilerleme dizini (SPEC 11.2, cihazda)", () => {
  it("ekle/sil/not; yeni önce; bozuk dizin boş sayılır; yetim dosyalar bulunur", () => {
    let idx = parseIndex(null);
    idx = addEntry(idx, { id: "a", file: "a.jpg", takenAt: 1 });
    idx = addEntry(idx, { id: "b", file: "b.jpg", takenAt: 2, analysisId: "x" });
    expect(idx.items.map((i) => i.id)).toEqual(["b", "a"]);
    idx = setNote(idx, "a", "  not  ");
    expect(idx.items.find((i) => i.id === "a")?.note).toBe("not");
    expect(parseIndex(serializeIndex(idx)).items).toHaveLength(2);
    expect(parseIndex("{bozuk").items).toEqual([]);
    expect(orphanFiles(idx, ["a.jpg", "b.jpg", "c.jpg", "index.json"])).toEqual(["c.jpg"]);
    expect(removeEntry(idx, "a").items).toHaveLength(1);
  });
});

describe("skor trendi ölçeği", () => {
  it("tarihe göre sıralar, eksen aralığı 1–10 içinde, kalibrasyon değişimi işaretlenir", () => {
    const s = trendScale([{ id: "2", date: "2026-10-10", overall: 6.2, potential: 7.1, calibrationVersion: "v1" }, { id: "1", date: "2026-10-03", overall: 5.8, potential: 6.9, calibrationVersion: "v0" }], 320, 160);
    expect(s.data[0].id).toBe("1");
    expect(s.lo).toBe(4);
    expect(s.hi).toBe(9);
    expect(s.calibrationChanged).toBe(true);
    expect(linePath(s.data, "overall", s.x, s.y)).toMatch(/^M28\.0,.* L308\.0,/);
  });
});

describe("paylaşım kartı düzeni (F10)", () => {
  it("kart boyutları, fotoğraf alanı ve en çok 3 alt skor çubuğu", () => {
    const base = { overall: 6.3, potential: 7.4, subs: [{ label: "Cilt", value: 6 }, { label: "Saç", value: 7 }, { label: "Çene", value: 5 }, { label: "X", value: 1 }], appName: "Aura", url: "aura.app", disclaimer: "not" };
    const l = shareCardLayout({ ...base, format: "story", hasPhoto: false });
    expect([l.w, l.h]).toEqual([CARD_SIZES.story.w, CARD_SIZES.story.h]);
    expect(l.photo).toBeNull();
    expect(l.bars).toHaveLength(3);
    expect(l.texts.some((t) => t.text === "6,3")).toBe(true);
    const sq = shareCardLayout({ ...base, format: "square", hasPhoto: true });
    expect(sq.photo).not.toBeNull();
    expect(sq.bars[0].ratio).toBeCloseTo(0.6);
  });
});
