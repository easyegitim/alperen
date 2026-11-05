import { describe, expect, it } from "vitest";
import { CHEEK_REF, IDX } from "@/lib/face/indices";
import { GLOW_UP_GATE } from "@/lib/config/tryon";
import { buildProtectMask, featurePolygons, midCheekPolygons, protectOpacity, rasterizeMask, skinRegionMask } from "@/lib/tryon/mask";
import { compositePixels } from "@/lib/tryon/pixels";
import { MASK_REGIONS, glowUpSkinActive, maskRegionFor } from "@/lib/tryon/types";
import { syntheticFace, withContours } from "../helpers/syntheticFace";

const W = 640, H = 700;
const P = { cheek: 300, length: 440, jaw: 240, forehead: 260, cx: 320, cy: 330 };
const L = withContours(syntheticFace(P), P);
const at = (m: Uint8ClampedArray, x: number, y: number) => m[Math.round(y) * W + Math.round(x)];
const pt = (i: number) => L[i];
// Oval elipsi (withContours ile aynı): merkez (cx, cy + L·0,05), yarıçaplar (cheek·0,55, L·0,52). Noktalar yumuşatma
// bandının (±15 px) dışında, bölgenin içinde seçilir.
const oy = P.cy + P.length * 0.05, orx = P.cheek * 0.55, ory = P.length * 0.52;
const eyeR = pt(IDX.irisR), noseTip = pt(IDX.noseTip), lipMid = { x: P.cx, y: P.cy + P.length * 0.3 };
const menton = { x: P.cx, y: oy + ory };
const chin = { x: P.cx, y: menton.y - 40 };
/** Dış yanak / favori: ovalin kenarına yakın, burun altı hizası (orijinal sakal burada kalırdı — R1-E10). */
const outerCheek = { x: P.cx - orx + 30, y: pt(IDX.subnasale).y - 20 };
/** Bıyık: burun altı ile dudak arası. */
const moustache = { x: P.cx, y: (pt(IDX.subnasale).y + lipMid.y) / 2 };
/** Orta yanak: göz altı ile burun kanadı arası. */
const midCheek = { x: (pt(IDX.eyeOuterR).x + pt(CHEEK_REF.noseAlaR).x) / 2, y: pt(CHEEK_REF.eyeBottomR).y + 40 };
const forehead = { x: P.cx, y: pt(IDX.browTopR).y - 45 };
const neck = { x: P.cx, y: menton.y + 40 };

describe("bölge maskeleri v2 (PLAN 5a/5d; CONTRACTS_V2 S2.6)", () => {
  it("MASK_REGIONS altı bölge; maskRegionFor: glow_up → features_only, sakal → features_cheeks, saç/renk → below_brows", () => {
    expect([...MASK_REGIONS]).toEqual(["below_brows", "above_lip", "features_only", "features_cheeks", "hair_only", "beard_only"]);
    expect(maskRegionFor("glow_up", {})).toBe("features_only");
    expect(maskRegionFor("combo", { hair: "buzz_cut", beard: "van_dyke" })).toBe("features_cheeks");
    expect(maskRegionFor("style", { beard: "clean_shaven" })).toBe("features_cheeks");
    expect(maskRegionFor("style", { hair: "buzz_cut" })).toBe("below_brows");
    expect(maskRegionFor("combo", { hair: "buzz_cut", beard: "goatee", color: "jet_black" })).toBe("features_cheeks");
  });

  it("glow_up: cilt katmanı KAPALIYSA yüz saç/sakal denemesi gibi geri yazılır (sakal → features_cheeks, yoksa below_brows); doku kapısı yalnız cilt açıkken", () => {
    expect(maskRegionFor("glow_up", { hair: "buzz_cut" }, ["hair"])).toBe("below_brows");
    expect(maskRegionFor("glow_up", { beard: "short_boxed" }, ["beard"])).toBe("features_cheeks");
    expect(maskRegionFor("glow_up", { hair: "buzz_cut", beard: "short_boxed" }, ["hair", "beard"])).toBe("features_cheeks");
    expect(maskRegionFor("glow_up", { hair: "buzz_cut" }, ["hair", "skin"])).toBe("features_only");
    expect(maskRegionFor("glow_up", {}, ["skin"])).toBe("features_only");
    expect(maskRegionFor("glow_up", {}, [])).toBe("features_only"); // boş = hepsi
    expect(glowUpSkinActive("glow_up", ["hair"])).toBe(false);
    expect(glowUpSkinActive("glow_up", ["skin"])).toBe(true);
    expect(glowUpSkinActive("glow_up")).toBe(true);
    expect(glowUpSkinActive("combo", ["skin"])).toBe(false);
  });

  it("features_only: göz, burun, dudak korunur; yanak, alın, çene, boyun modele kalır", () => {
    const m = rasterizeMask(L, W, H, "features_only");
    expect(featurePolygons(L)).toHaveLength(6);
    expect(at(m, eyeR.x, eyeR.y)).toBe(255);
    expect(at(m, noseTip.x, noseTip.y)).toBe(255);
    expect(at(m, lipMid.x, lipMid.y)).toBe(255);
    expect(at(m, midCheek.x, midCheek.y)).toBe(0);
    expect(at(m, outerCheek.x, outerCheek.y)).toBe(0);
    expect(at(m, forehead.x, forehead.y)).toBe(0);
    expect(at(m, chin.x, chin.y)).toBe(0);
    expect(at(m, neck.x, neck.y)).toBe(0);
  });

  it("features_cheeks: özellikler + orta yanak korunur; dış yanak/favori, bıyık, çene ve çene altı modele kalır (R1-E10)", () => {
    const m = rasterizeMask(L, W, H, "features_cheeks");
    expect(midCheekPolygons(L)).toHaveLength(2);
    expect(at(m, eyeR.x, eyeR.y)).toBe(255);
    expect(at(m, midCheek.x, midCheek.y)).toBe(255);
    expect(at(m, outerCheek.x, outerCheek.y)).toBe(0); // sakalsız stilde orijinal favori/yanak sakalı geri yazılmaz
    expect(at(m, moustache.x, moustache.y)).toBe(0);
    expect(at(m, chin.x, chin.y)).toBe(0);
    expect(at(m, neck.x, neck.y)).toBe(0);
    // above_lip (eski) aynı dış yanak pikselini orijinalden kopyalıyordu: fark bu.
    expect(at(rasterizeMask(L, W, H, "above_lip"), outerCheek.x, outerCheek.y)).toBe(255);
  });

  it("hair_only: yüz ovali (alın dahil) ve boyun korunur; ovalin dışındaki saç modele kalır", () => {
    const m = rasterizeMask(L, W, H, "hair_only");
    expect(at(m, forehead.x, forehead.y)).toBe(255);
    expect(at(m, eyeR.x, eyeR.y)).toBe(255);
    expect(at(m, chin.x, chin.y)).toBe(255);
    expect(at(m, neck.x, neck.y)).toBe(255);
    expect(at(m, 6, 6)).toBe(0);
    expect(at(m, P.cx, 6)).toBe(0); // tepe: saç
  });

  it("beard_only: kaş üstündeki her şey (saç, alın) ve özellikler korunur; yanak, bıyık, çene modele kalır", () => {
    const m = rasterizeMask(L, W, H, "beard_only");
    expect(at(m, P.cx, 6)).toBe(255);
    expect(at(m, 6, 6)).toBe(255);
    expect(at(m, forehead.x, forehead.y)).toBe(255);
    expect(at(m, eyeR.x, eyeR.y)).toBe(255);
    expect(at(m, outerCheek.x, outerCheek.y)).toBe(0);
    expect(at(m, moustache.x, moustache.y)).toBe(0);
    expect(at(m, chin.x, chin.y)).toBe(0);
  });

  it("opaklık: features_only 0,8 (GLOW_UP_GATE), diğerleri 1; yumuşatılmış maske tepe değeri 204", () => {
    expect(protectOpacity("features_only")).toBe(GLOW_UP_GATE.featuresOnlyOpacity);
    for (const r of MASK_REGIONS) if (r !== "features_only") expect(protectOpacity(r)).toBe(1);
    const m = buildProtectMask(L, W, H, "features_only");
    expect(m.reduce((a, v) => (v > a ? v : a), 0)).toBe(Math.round(255 * GLOW_UP_GATE.featuresOnlyOpacity));
    expect(at(m, eyeR.x, eyeR.y)).toBe(204);
  });

  it("skinRegionMask: kaş altı oval eksi özellikler — yanak içinde, gözde/burunda/dudakta değil", () => {
    const m = skinRegionMask(L, W, H);
    expect(at(m, midCheek.x, midCheek.y)).toBe(255);
    expect(at(m, chin.x, chin.y)).toBe(255);
    expect(at(m, eyeR.x, eyeR.y)).toBe(0);
    expect(at(m, noseTip.x, noseTip.y)).toBe(0);
    expect(at(m, lipMid.x, lipMid.y)).toBe(0);
    expect(at(m, forehead.x, forehead.y)).toBe(0);
  });
});

describe("kullanıcının yüzü her modda orijinal piksellerle geri yazılır (SPEC 10.4, KB K15/Ç9)", () => {
  // Sentetik C: yeşil; G: kırmızı. Maskede 255 olan pikseller C'den birebir gelir.
  const cp = new Uint8ClampedArray(W * H * 4), gp = new Uint8ClampedArray(W * H * 4);
  for (let p = 0; p < W * H; p++) {
    cp.set([20, 200, 40, 255], p * 4);
    gp.set([200, 90, 90, 255], p * 4); // parlaklık C'ye yakın: kenar bandı ton düzeltmesi tetiklenmez
  }
  const px = (out: Uint8ClampedArray, q: { x: number; y: number }) => {
    const i = (Math.round(q.y) * W + Math.round(q.x)) * 4;
    return [out[i], out[i + 1], out[i + 2]];
  };
  const protectedPoints = {
    below_brows: [eyeR, noseTip, lipMid, chin],
    above_lip: [eyeR, noseTip],
    features_cheeks: [eyeR, noseTip, lipMid, midCheek],
    hair_only: [eyeR, noseTip, lipMid, chin, forehead, neck],
    beard_only: [eyeR, noseTip, forehead],
  } as const;
  for (const [region, points] of Object.entries(protectedPoints)) {
    it(`${region}: korunan noktalar C ile birebir (piksel farkı 0)`, () => {
      const mask = buildProtectMask(L, W, H, region as keyof typeof protectedPoints);
      const { out } = compositePixels(Uint8ClampedArray.from(gp), Uint8ClampedArray.from(cp), mask, W, H);
      for (const q of points) expect(px(out, q), `${region} ${q.x},${q.y}`).toEqual([20, 200, 40]);
      expect(px(out, { x: 4, y: H - 4 })).toEqual([200, 90, 90]); // köşe her modda modelden
    });
  }
  it("features_only (glow_up): göz/burun/dudak ≥ %80 orijinal (0,8 opaklık); cilt modelden", () => {
    const mask = buildProtectMask(L, W, H, "features_only");
    const { out } = compositePixels(Uint8ClampedArray.from(gp), Uint8ClampedArray.from(cp), mask, W, H);
    const [r, g] = px(out, eyeR);
    expect(g).toBeGreaterThanOrEqual(Math.floor(200 * 0.8 + 90 * 0.2) - 1);
    expect(r).toBeLessThanOrEqual(Math.ceil(20 * 0.8 + 200 * 0.2) + 1);
    expect(px(out, midCheek)).toEqual([200, 90, 90]);
  });
});
