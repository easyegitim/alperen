import { describe, expect, it } from "vitest";
import { ShareSpecError, drawShareCard, specFromLegacyInput, type CardDrawContext, type CardPhoto } from "@/lib/share/card";
import type { BarberShareSpec, ScoreShareSpec, StrongestShareSpec } from "@/lib/share/spec";

// Faz 6 paylaşım kartı (KB §8 R2-Ö3/R2-Ö2, K17; CONTRACTS_V2 S3.3.1). Canvas yok: sahte bağlam çizim çağrılarını kaydeder.
function fakeCtx() {
  const calls: { op: string; args: unknown[] }[] = [];
  const ctx: CardDrawContext = {
    fillStyle: "#000",
    font: "",
    textBaseline: "alphabetic",
    textAlign: "start",
    fillRect: (...a) => void calls.push({ op: "fillRect", args: a }),
    fillText: (...a) => void calls.push({ op: "fillText", args: a }),
    measureText: (t) => ({ width: t.length * 20 }),
    drawImage: (_img: CanvasImageSource, ...a: number[]) => void calls.push({ op: "drawImage", args: a }),
    beginPath: () => void calls.push({ op: "beginPath", args: [] }),
    roundRect: (...a) => void calls.push({ op: "roundRect", args: a }),
    fill: () => void calls.push({ op: "fill", args: [] }),
    save: () => void calls.push({ op: "save", args: [] }),
    restore: () => void calls.push({ op: "restore", args: [] }),
    arc: (...a) => void calls.push({ op: "arc", args: a }),
    clip: () => void calls.push({ op: "clip", args: [] }),
  };
  const texts = () => calls.filter((c) => c.op === "fillText").map((c) => String(c.args[0]));
  return { ctx, calls, texts };
}
const photo = { width: 800, height: 600 } as unknown as CardPhoto;
const common = { format: "square" as const, audience: "personal" as const, appName: "Aura", url: "aura.app", disclaimer: "Yapay zekâ tahmini; kişisel değerini ölçmez.", withPhoto: false };
const score: ScoreShareSpec = { ...common, kind: "score", overall: 6.4, potential: 7.1, subs: [{ key: "skin", label: "Cilt", value: 7.2 }, { key: "eyes", label: "Göz çevresi", value: 6.9 }, { key: "hair", label: "Saç", value: 6.1 }] };
const strongest: StrongestShareSpec = { ...common, kind: "strongest", sub: "eyes", title: "En güçlü yanın: Göz çevresi", line: "Göz altı tonu dengeli görünüyor." };
const barber: BarberShareSpec = { ...common, kind: "barber", withPhoto: false, barber: { styleName: "Kısa kenar, dokulu üst", sidesGuard: "2", topLengthCm: 5, beardLine: "Çene hattının bir parmak altı" }, presetIds: { hair: "textured_crop" }, lines: ["Yanlar: 2 numara", "Üst: 5 cm", "Sakal hattı: Çene hattının bir parmak altı"] };

describe("skor kartı", () => {
  it("genel skor, potansiyel (+fark), 3 alt skor, uyarı notu ve adres yazılır; fotoğraf yoksa daire kırpımı yok", () => {
    const { ctx, calls, texts } = fakeCtx();
    drawShareCard(ctx, score, 1080, 1080);
    const t = texts();
    expect(t).toContain("Aura");
    expect(t).toContain("6,4");
    expect(t.some((x) => x.startsWith("Potansiyel 7,1") && x.includes("+0,7"))).toBe(true);
    for (const s of ["Cilt", "Göz çevresi", "Saç", "7,2", "6,9", "6,1", "aura.app"]) expect(t).toContain(s);
    expect(t.join(" ")).toContain("Yapay zekâ tahmini");
    expect(calls.some((c) => c.op === "clip")).toBe(false);
    expect(calls.filter((c) => c.op === "roundRect").length).toBe(6); // 3 çubuk × (ray + dolgu)
  });
  it("potansiyel null ise satır çizilmez; fotoğraf verilip withPhoto true ise daire kırpımlı çizilir", () => {
    const a = fakeCtx();
    drawShareCard(a.ctx, { ...score, potential: null }, 1080, 1080);
    expect(a.texts().some((x) => x.startsWith("Potansiyel"))).toBe(false);
    const b = fakeCtx();
    drawShareCard(b.ctx, { ...score, withPhoto: true }, 1080, 1920, photo);
    expect(b.calls.map((c) => c.op)).toEqual(expect.arrayContaining(["save", "arc", "clip", "drawImage", "restore"]));
    const img = b.calls.find((c) => c.op === "drawImage")!.args as number[];
    expect(img.slice(0, 4)).toEqual([100, 0, 600, 600]); // kare kırpım, ortalanmış
    // withPhoto false ise fotoğraf verilse de çizilmez (kullanıcı seçimi)
    const c = fakeCtx();
    drawShareCard(c.ctx, score, 1080, 1080, photo);
    expect(c.calls.some((x) => x.op === "drawImage")).toBe(false);
  });
  it("etiketler dışarıdan gelir (tr.json), varsayılan Türkçe", () => {
    const { ctx, texts } = fakeCtx();
    drawShareCard(ctx, score, 1080, 1080, null, { overall: "Genel", potential: "Hedef" });
    expect(texts()).toContain("Genel");
    expect(texts().some((x) => x.startsWith("Hedef 7,1"))).toBe(true);
  });
});

describe("K17 ve berber kuralı: geçersiz spec çizilmez", () => {
  it("reklam kartına fotoğraf → ShareSpecError, tuvale hiçbir şey çizilmez", () => {
    const { ctx, calls } = fakeCtx();
    expect(() => drawShareCard(ctx, { ...score, audience: "marketing", withPhoto: true }, 1080, 1080, photo)).toThrow(ShareSpecError);
    expect(calls).toEqual([]);
  });
  it("berber kartına fotoğraf (çalışma zamanı) → ShareSpecError; adres boşsa da çizilmez", () => {
    const { ctx, calls } = fakeCtx();
    const bad = { ...barber, withPhoto: true as unknown as false };
    expect(() => drawShareCard(ctx, bad, 1080, 1080, photo)).toThrow(/photo_on_barber_card/);
    expect(() => drawShareCard(ctx, { ...score, url: " " }, 1080, 1080)).toThrow(/url_missing/);
    expect(calls).toEqual([]);
  });
  it("reklam kartı fotoğrafsız çizilebilir (izinli model/sentetik görsel ayrı iştir)", () => {
    const { ctx, texts } = fakeCtx();
    drawShareCard(ctx, { ...score, audience: "marketing" }, 1080, 1080, photo);
    expect(texts()).toContain("6,4");
  });
});

describe("en güçlü yanın kartı", () => {
  it("başlık ve cümle yazılır; hiçbir skor rakamı yok", () => {
    const { ctx, texts, calls } = fakeCtx();
    drawShareCard(ctx, strongest, 1080, 1920);
    const t = texts();
    expect(t.join(" ")).toContain("En güçlü yanın: Göz");
    expect(t.join(" ")).toContain("Göz altı tonu dengeli");
    expect(t.filter((x) => /\d,\d/.test(x))).toEqual([]);
    expect(calls.some((c) => c.op === "clip")).toBe(false);
  });
  it("uzun başlık/cümle sarılır", () => {
    const { ctx, calls } = fakeCtx();
    drawShareCard(ctx, { ...strongest, line: "Kelime ".repeat(16).trim() }, 1080, 1920);
    expect(calls.filter((c) => c.op === "fillText").length).toBeGreaterThan(6);
  });
});

describe("berber kartı", () => {
  it("stil adı, satırlar ve not; fotoğraf hiç çizilmez", () => {
    const { ctx, texts, calls } = fakeCtx();
    drawShareCard(ctx, { ...barber, barber: { ...barber.barber, notes: "Doğal dokuyu koru." } }, 1080, 1080);
    const t = texts();
    for (const s of ["Kısa kenar, dokulu üst", "Yanlar: 2 numara", "Üst: 5 cm", "Doğal dokuyu koru.", "aura.app"]) expect(t.join("\n")).toContain(s);
    expect(calls.some((c) => c.op === "drawImage" || c.op === "clip")).toBe(false);
  });
  it("stil adı boşsa çizilmez", () => {
    const { ctx } = fakeCtx();
    expect(() => drawShareCard(ctx, { ...barber, barber: { styleName: " " } }, 1080, 1080)).toThrow(/barber_style_missing/);
  });
});

describe("eski girdi (bir sürüm uyumluluk)", () => {
  it("ShareCardInput → kişisel skor kartı; fotoğraf varsa withPhoto", () => {
    const spec = specFromLegacyInput({ overall: 6.4, potential: 7.1, subs: [{ label: "Cilt", value: 7.2 }], appName: "Aura", url: "aura.app", format: "story", disclaimer: "d", photo: null });
    expect(spec).toMatchObject({ kind: "score", audience: "personal", withPhoto: false, subs: [{ label: "Cilt", value: 7.2 }] });
    expect(specFromLegacyInput({ overall: 6, potential: 6.5, subs: [], appName: "A", url: "u", format: "square", disclaimer: "d", photo: photo as unknown as ImageBitmap }).withPhoto).toBe(true);
  });
});
