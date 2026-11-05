import { SEG_CLASS } from "@/lib/face/types";
import { decodeBase64, decodeMask, hairAboveFace, SEGMENTER_MODEL } from "@/mobile/src/features/capture/segmentation";
import { isSegmenterAvailable, segmentImage } from "@/mobile/modules/aura-segmenter";
import { segmentForHairline } from "@/mobile/src/native/segmenter";

function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

describe("segmenter maskesi (M8)", () => {
  it("base64 çözme Node ile aynı sonucu verir; geçersiz karakterde null", () => {
    const bytes = new Uint8Array([0, 1, 2, 3, 250, 255, 7]);
    expect(Array.from(decodeBase64(toBase64(bytes))!)).toEqual(Array.from(bytes));
    expect(decodeBase64("not*valid")).toBeNull();
  });
  it("decodeMask boyut doğrular", () => {
    const m = new Uint8Array(4 * 3).fill(SEG_CLASS.faceSkin);
    const r = decodeMask(4, 3, toBase64(m))!;
    expect(r.width).toBe(4);
    expect(r.mask.length).toBe(12);
    expect(decodeMask(4, 4, toBase64(m))).toBeNull();
    expect(decodeMask(0, 3, toBase64(m))).toBeNull();
  });
  it("hairAboveFace: yüz kutusunun üstünde saç varsa true, yoksa false", () => {
    const w = 20, h = 20;
    const mask = new Uint8Array(w * h).fill(SEG_CLASS.background);
    const face = [
      { x: 0.3, y: 0.5 },
      { x: 0.7, y: 0.9 },
    ];
    expect(hairAboveFace({ width: w, height: h, mask }, face)).toBe(false);
    for (let y = 7; y < 10; y++) for (let x = 6; x < 14; x++) mask[y * w + x] = SEG_CLASS.hair;
    expect(hairAboveFace({ width: w, height: h, mask }, face)).toBe(true);
  });
  it("native modül yokken (Jest/Expo Go) segmenter sessizce devre dışı", async () => {
    expect(isSegmenterAvailable).toBe(false);
    await expect(segmentImage("file:///x.jpg", SEGMENTER_MODEL)).rejects.toThrow("segmenter_unavailable");
    expect(await segmentForHairline("file:///x.jpg")).toBeNull();
  });
});
