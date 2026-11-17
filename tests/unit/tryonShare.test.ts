import { describe, expect, it } from "vitest";
import { drawTryonShare, tryonLabelLayout, type ShareDrawContext } from "@/lib/share/card";

// Paylaşım çıktısında YZ etiketi her zaman gömülü (KB §7.4 K16; PLAN 5e). Canvas yok: sahte bağlam çizim çağrılarını kaydeder.
function fakeCtx() {
  const calls: { op: string; args: unknown[] }[] = [];
  const ctx: ShareDrawContext = {
    fillStyle: "#000",
    font: "",
    textBaseline: "alphabetic",
    textAlign: "start",
    fillRect: (...a) => void calls.push({ op: "fillRect", args: a }),
    fillText: (...a) => void calls.push({ op: "fillText", args: a }),
    measureText: (t) => ({ width: t.length * 8 }),
    drawImage: (...a) => void calls.push({ op: "drawImage", args: a.slice(1) }),
    beginPath: () => void calls.push({ op: "beginPath", args: [] }),
    roundRect: (...a) => void calls.push({ op: "roundRect", args: a }),
    fill: () => void calls.push({ op: "fill", args: [] }),
  };
  return { ctx, calls };
}
const after = { width: 1024, height: 1024 } as unknown as CanvasImageSource & { width: number; height: number };
const LABEL = "Aura ile oluşturuldu · YZ simülasyonu";

describe("deneme paylaşım görseli", () => {
  it("etiket görselin üstüne, sağ alta gömülür; stil adı ve uygulama adı alt şeritte", () => {
    const { ctx, calls } = fakeCtx();
    drawTryonShare(ctx, { after, label: LABEL, title: "Buzz kesim + Van Dyke", appName: "Aura" }, 1024, 1164);
    const texts = calls.filter((c) => c.op === "fillText").map((c) => c.args);
    expect(texts.map((t) => t[0])).toEqual([LABEL, "Buzz kesim + Van Dyke", "Aura"]);
    const [, lx, ly] = texts[0] as [string, number, number];
    const img = calls.find((c) => c.op === "drawImage")!.args as number[];
    expect(img).toEqual([0, 0, 1024, Math.round(1164 * 0.88)]);
    // Etiket görsel alanının içinde (alt şeritte değil) ve sağ yarıda
    expect(ly).toBeLessThan(img[3]);
    expect(ly).toBeGreaterThan(img[3] * 0.85);
    expect(lx).toBeGreaterThan(1024 / 2);
    expect(calls.some((c) => c.op === "roundRect")).toBe(true);
  });
  it("etiket boşsa çizim reddedilir (etiketsiz paylaşım yok)", () => {
    const { ctx } = fakeCtx();
    expect(() => drawTryonShare(ctx, { after, label: "  ", title: "x", appName: "Aura" }, 1024, 1164)).toThrow("ai_label_required");
  });
  it("yerleşim görsel genişliğine ölçeklenir; en az 14 px", () => {
    const small = tryonLabelLayout(300, 300, 100);
    expect(small.fontPx).toBe(14);
    const big = tryonLabelLayout(1024, 1024, 100);
    expect(big.fontPx).toBe(Math.round(1024 * 0.028));
    expect(big.x + big.boxW).toBeLessThan(1024);
    expect(big.y + big.boxH).toBeLessThan(1024);
  });
});
