import { describe, expect, it } from "vitest";
import { base64ToBlob } from "@/lib/tryon/base64";

describe("base64ToBlob (CSP uyumlu)", () => {
  it("baytları ve mime türünü korur; data: öneki ve boşluklar temizlenir", async () => {
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 1, 2, 255]);
    const b64 = Buffer.from(bytes).toString("base64");
    for (const input of [b64, `data:image/jpeg;base64,${b64}`, b64.slice(0, 4) + "\n" + b64.slice(4)]) {
      const blob = base64ToBlob(input, "image/jpeg");
      expect(blob.type).toBe("image/jpeg");
      expect(new Uint8Array(await blob.arrayBuffer())).toEqual(bytes);
    }
  });
});
