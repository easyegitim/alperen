import { NOISE_BAND, formatBand, formatDelta } from "@/lib/progress/noise";
import { shareSpecIssues, type ShareCardSpec } from "@/lib/share/spec";
import { latestChange, trendPointsFromSummaries } from "@/mobile/src/features/progress/change";
import type { GhostOutline } from "@/lib/face/ghostGuide";
import { addEntry, latestGhost, parseIndex, serializeIndex } from "@/mobile/src/features/progress";
import { CARD_SIZES, shareLayoutFromSpec, wrapText } from "@/mobile/src/features/share/layout";

const pt = (x: number, y: number): [number, number] => [x, y];
const GHOST: GhostOutline = { version: 1, aspect: 0.75, mirrored: true, oval: Array.from({ length: 36 }, (_, i) => pt(0.5 + (i % 3) * 0.01, 0.5)), eyes: [pt(0.4, 0.4), pt(0.45, 0.4), pt(0.55, 0.4), pt(0.6, 0.4)], nose: pt(0.5, 0.5), mouth: [pt(0.45, 0.65), pt(0.55, 0.65)], takenAt: 1 };

describe("ilerleme ±gürültü bandı (KB §4.2; CONTRACTS_V2 S3.3.3)", () => {
  it("|Δ| ≤ 0,3 'değişim yok' (sınır dahil); büyük fark yükseldi/düştü; kalibrasyon farklıysa karşılaştırma yok", () => {
    const p = (id: string, date: string, overall: number, cal: string | null = "h2") => ({ id, date, overall, calibrationVersion: cal });
    expect(NOISE_BAND).toBe(0.3);
    expect(latestChange([p("a", "2026-10-01", 5.8), p("b", "2026-10-10", 6.1)])?.change).toEqual({ delta: 0.3, kind: "no_change", band: 0.3 });
    expect(latestChange([p("a", "2026-10-01", 5.8), p("b", "2026-10-10", 6.2)])?.change?.kind).toBe("up");
    expect(latestChange([p("b", "2026-10-10", 5.2), p("a", "2026-10-01", 5.8)])?.change?.kind).toBe("down");
    const cal = latestChange([p("a", "2026-10-01", 5.8, "h1"), p("b", "2026-10-10", 7.0, "h2")]);
    expect(cal?.change).toBeNull();
    expect(cal?.calibrationChanged).toBe(true);
    expect(latestChange([p("a", "2026-10-01", 5.8)])).toBeNull();
    expect(formatBand()).toBe("0,3");
    expect(formatDelta(0.4)).toBe("+0,4");
    expect(formatDelta(-0.5)).toBe("−0,5");
  });
  it("özetlerden trend noktaları: yalnız tamamlanmış ve açık skorlu", () => {
    const list = [
      { id: "1", status: "completed" as const, createdAt: "2026-10-01", faceShape: null, overall: 5.8, potential: 6.9, calibrationVersion: "h2", engine: "hybrid.v2" as const },
      { id: "2", status: "completed" as const, createdAt: "2026-10-08", faceShape: null, overall: null, potential: null, calibrationVersion: "h2", engine: "hybrid.v2" as const },
      { id: "3", status: "failed" as const, createdAt: "2026-10-09", faceShape: null, overall: 5, potential: 6, calibrationVersion: "h2", engine: "hybrid.v2" as const },
    ];
    expect(trendPointsFromSummaries(list).map((p) => p.id)).toEqual(["1"]);
  });
});

describe("ilerleme dizini: hayalet kılavuz yalnız cihazda (CONTRACTS_V2 S3.3.4)", () => {
  it("ghost alanı dizinde saklanır, bozuk ghost atılır, en son çekimin kılavuzu bulunur", () => {
    let idx = parseIndex(null);
    idx = addEntry(idx, { id: "a", file: "a.jpg", takenAt: 1, ghost: GHOST });
    idx = addEntry(idx, { id: "b", file: "b.jpg", takenAt: 2 });
    const round = parseIndex(serializeIndex(idx));
    expect(round.items.find((i) => i.id === "a")?.ghost?.oval).toHaveLength(36);
    expect(latestGhost(round)?.takenAt).toBe(1);
    const broken = parseIndex(JSON.stringify({ version: 1, items: [{ id: "c", file: "c.jpg", takenAt: 3, ghost: { version: 1, oval: [] } }] }));
    expect(broken.items[0].ghost).toBeUndefined();
    expect(latestGhost(broken)).toBeNull();
  });
});

describe("paylaşım kartı v2 düzeni (KB §8; K17)", () => {
  const common = { format: "square" as const, audience: "personal" as const, appName: "Aura", url: "aura.app", disclaimer: "YZ tahmini", withPhoto: false };
  it("'En güçlü yanın' kartında sayı yok; berber kartında fotoğraf yok; reklam kartı fotoğrafla geçersiz", () => {
    const strongest: ShareCardSpec = { ...common, kind: "strongest", sub: "skin", title: "En güçlü yanın: Cilt görünümü", line: "Doku düzenli" };
    const l = shareLayoutFromSpec(strongest, false);
    expect([l.w, l.h]).toEqual([CARD_SIZES.square.w, CARD_SIZES.square.h]);
    expect(l.bars).toHaveLength(0);
    expect(l.texts.some((t) => /\d,\d/.test(t.text))).toBe(false);
    expect(l.texts.some((t) => t.text.includes("En güçlü yanın"))).toBe(true);
    const barber: ShareCardSpec = { ...common, kind: "barber", withPhoto: false, barber: { styleName: "Dokulu kısa kesim", sidesGuard: "2" }, presetIds: { hair: "textured_crop" }, lines: ["Yanlar: 2 numara"] };
    const b = shareLayoutFromSpec(barber, true);
    expect(b.photo).toBeNull();
    expect(b.texts.some((t) => t.text === "Dokulu kısa kesim")).toBe(true);
    const score: ShareCardSpec = { ...common, kind: "score", overall: 6.3, potential: null, subs: [{ key: "skin", label: "Cilt", value: 6 }] };
    const s = shareLayoutFromSpec(score, true);
    expect(s.photo).not.toBeNull();
    expect(s.texts.some((t) => t.text.startsWith("Potansiyel"))).toBe(false);
    expect(shareSpecIssues({ ...score, audience: "marketing", withPhoto: true })).toContain("photo_on_marketing_card");
    expect(wrapText("a bb ccc dddd", 5)).toEqual(["a bb", "ccc", "dddd"]);
  });
});
