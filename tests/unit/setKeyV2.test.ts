import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { computeSetKey } from "@/lib/score/setKey";
import { cachedSignals, readCachedScores } from "@/lib/score/engine/setCache";

const H1 = "a".repeat(64);
const H2 = "b".repeat(64);

describe("computeSetKey (Ç11)", () => {
  it("HMAC-SHA-256 sıralı birleşik; sıra bağımsız; secret'a bağlı; hex", () => {
    const k = computeSetKey("gizli", [H2, H1]);
    expect(k).toBe(createHmac("sha256", "gizli").update(`${H1}\n${H2}`, "utf8").digest("hex"));
    expect(computeSetKey("gizli", [H1, H2])).toBe(k);
    expect(computeSetKey("baska", [H1, H2])).not.toBe(k);
    expect(k).toMatch(/^[0-9a-f]{64}$/);
  });
  it("tek dosya değişirse yeni anahtar; büyük harf hex normalize edilir", () => {
    expect(computeSetKey("gizli", [H1, "c".repeat(64)])).not.toBe(computeSetKey("gizli", [H1, H2]));
    expect(computeSetKey("gizli", [H1.toUpperCase()])).toBe(computeSetKey("gizli", [H1]));
  });
  it("secret yok, hash yok ya da geçersiz hash → null (önbellek kapalı; hata yok)", () => {
    expect(computeSetKey(undefined, [H1])).toBeNull();
    expect(computeSetKey("  ", [H1])).toBeNull();
    expect(computeSetKey("gizli", null)).toBeNull();
    expect(computeSetKey("gizli", [])).toBeNull();
    expect(computeSetKey("gizli", ["zzz"])).toBeNull();
  });
});

describe("readCachedScores", () => {
  it("bozuk ya da istemci sözleşmesine uymayan saklı veri yok sayılır", () => {
    expect(readCachedScores(null)).toBeNull();
    expect(readCachedScores({ overall: 5 })).toBeNull();
    expect(cachedSignals({ overall: 5, potential: 5, subscores: {}, score_range: {}, percentile: 50, face_shape: "oval", gains: {}, observations: {}, signals: { engine: "hybrid.v2" }, report: { version: "report.v3", letter: "a", regions: [], measures: [], closing: "b" } }, "2026-11-04T00:00:00.000Z")).toMatchObject({ cacheHit: true, progressAt: "2026-11-04T00:00:00.000Z", engine: "hybrid.v2" });
  });
});
