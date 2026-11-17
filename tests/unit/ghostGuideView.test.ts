import { describe, expect, it } from "vitest";
import { GHOST_VIEWBOX, ghostGuidePaths } from "@/components/camera/GhostGuide";
import { FACE_OVAL } from "@/lib/face/indices";
import type { GhostOutline } from "@/lib/face/ghostGuide";

// Faz 6 hayalet kılavuz katmanı (S3.3.4): saklanan çizgi → önizleme yolları; ayna farkı x'i çevirir. Çizgi hiçbir isteğe girmez.
const outline: GhostOutline = {
  version: 1,
  aspect: 0.75,
  mirrored: false,
  oval: Array.from({ length: FACE_OVAL.length }, (_, i) => [0.3 + (i % 5) * 0.1, 0.2 + (i % 7) * 0.1] as [number, number]),
  eyes: [[0.35, 0.4], [0.45, 0.4], [0.55, 0.4], [0.65, 0.4]],
  nose: [0.5, 0.55],
  mouth: [[0.42, 0.7], [0.58, 0.7]],
  takenAt: 1_700_000_000_000,
};

describe("ghostGuidePaths", () => {
  it("3:4 kaynak, 3:4 viewBox: kapalı oval, iki göz çizgisi, ağız çizgisi, burun noktası", () => {
    const p = ghostGuidePaths(outline, false);
    expect(p.oval.startsWith("M")).toBe(true);
    expect(p.oval.endsWith("Z")).toBe(true);
    expect(p.eyes[0]).toBe("M105,160 L135,160");
    expect(p.eyes[1]).toBe("M165,160 L195,160");
    expect(p.mouth).toBe("M126,280 L174,280");
    expect(p.nose).toEqual([150, 220]);
    expect(GHOST_VIEWBOX).toEqual({ w: 300, h: 400 });
  });
  it("aynalı önizlemede (web ön kamera) x çevrilir; ham kare koordinatı saklandığından sağ göz sola geçer", () => {
    const p = ghostGuidePaths(outline, true);
    expect(p.eyes[0]).toBe("M195,160 L165,160");
    expect(p.nose).toEqual([150, 220]);
    expect(p.mouth).toBe("M174,280 L126,280");
  });
  it("yatay kaynak (4:3) dikey önizlemede cover ile taşar; dikey hizası korunur", () => {
    const p = ghostGuidePaths({ ...outline, aspect: 4 / 3 }, false);
    // scale = max(300/1.333, 400/1) = 400 → dw = 533, ox = -116.7
    expect(p.nose[1]).toBe(220);
    expect(p.nose[0]).toBeCloseTo(-116.7 + 0.5 * 533.3, 0);
  });
});
