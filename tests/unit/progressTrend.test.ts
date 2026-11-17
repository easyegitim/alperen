import { describe, expect, it } from "vitest";
import { NOISE_BAND } from "@/lib/config/scoring";
import { comparable, latestChange } from "@/lib/progress/trend";

// Faz 6 ilerleme (KB §4.2; S3.3.3): son iki analiz, ±bant "değişim yok", kalibrasyon farkında kıyas yok, yalnız kendi geçmişi.
const p = (id: string, date: string, overall: number, calibrationVersion: string | null = "h2-1") => ({ id, date, overall, calibrationVersion });

describe("latestChange", () => {
  it("tek analiz → null; sıralama tarihe göre (giriş sırası önemsiz)", () => {
    expect(latestChange([p("a", "2026-10-01", 6)])).toBeNull();
    const r = latestChange([p("c", "2026-11-01", 6.4), p("a", "2026-09-01", 5.0), p("b", "2026-10-01", 6.1)]);
    expect(r?.from.id).toBe("b");
    expect(r?.to.id).toBe("c");
    expect(r?.change).toEqual({ delta: 0.3, kind: "no_change", band: NOISE_BAND });
  });
  it("bant sınırı dahil: 0,3 değişim yok, 0,4 yükseldi, −0,4 düştü; band dışarıdan geçirilebilir", () => {
    expect(latestChange([p("a", "2026-10-01", 6.0), p("b", "2026-11-01", 6.3)])?.change?.kind).toBe("no_change");
    expect(latestChange([p("a", "2026-10-01", 6.0), p("b", "2026-11-01", 6.4)])?.change?.kind).toBe("up");
    expect(latestChange([p("a", "2026-10-01", 6.4), p("b", "2026-11-01", 6.0)])?.change?.kind).toBe("down");
    expect(latestChange([p("a", "2026-10-01", 6.0), p("b", "2026-11-01", 6.4)], 0.5)?.change).toMatchObject({ kind: "no_change", band: 0.5 });
  });
  it("kalibrasyon sürümü farklıysa karşılaştırma yok; ikisi de null (eski motor) aynı sayılır", () => {
    const r = latestChange([p("a", "2026-10-01", 6.0, "h1"), p("b", "2026-11-01", 7.0, "h2-1")]);
    expect(r).toMatchObject({ calibrationChanged: true, change: null });
    expect(comparable(p("a", "x", 1, null), p("b", "y", 1, null))).toBe(true);
    expect(comparable(p("a", "x", 1, null), p("b", "y", 1, "h2-1"))).toBe(false);
    expect(latestChange([p("a", "2026-10-01", 6.0, null), p("b", "2026-11-01", 6.1, null)])?.change?.kind).toBe("no_change");
  });
});
