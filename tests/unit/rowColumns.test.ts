import { describe, expect, it } from "vitest";
import { ANALYSIS_ROW_COLUMNS, LEGACY_ANALYSIS_ROW_COLUMNS, isMissingColumnError, selectAnalysisRows, type AnalysisRowsResult } from "@/lib/score/rowColumns";

// Migration 0009 uygulanmamış ortam: analiz okumaları eski sütun listesine düşer (yayın sırası koruması).

function fakeRun(responses: AnalysisRowsResult[]) {
  const seen: string[] = [];
  const run = (cols: string) => {
    seen.push(cols);
    return Promise.resolve(responses[seen.length - 1] ?? { data: null, error: { code: "unexpected" } });
  };
  return { seen, run };
}

describe("selectAnalysisRows", () => {
  it("eski liste = tam liste eksi engine_version, signals", () => {
    const full = ANALYSIS_ROW_COLUMNS.split(",").map((c) => c.trim());
    const legacy = LEGACY_ANALYSIS_ROW_COLUMNS.split(",").map((c) => c.trim());
    expect(full.filter((c) => !legacy.includes(c))).toEqual(["engine_version", "signals"]);
    expect(legacy.every((c) => full.includes(c))).toBe(true);
  });
  it("0009 varsa tek sorgu, tam liste", async () => {
    const { seen, run } = fakeRun([{ data: { id: "a" }, error: null }]);
    expect(await selectAnalysisRows(run)).toEqual({ data: { id: "a" }, error: null });
    expect(seen).toEqual([ANALYSIS_ROW_COLUMNS]);
  });
  it("sütun yok (42703 / PGRST204) → eski listeyle bir kez yeniden dener", async () => {
    for (const code of ["42703", "PGRST204"]) {
      const { seen, run } = fakeRun([
        { data: null, error: { code } },
        { data: [{ id: "b" }], error: null },
      ]);
      expect(await selectAnalysisRows(run)).toEqual({ data: [{ id: "b" }], error: null });
      expect(seen).toEqual([ANALYSIS_ROW_COLUMNS, LEGACY_ANALYSIS_ROW_COLUMNS]);
    }
  });
  it("başka hata yeniden denenmez, olduğu gibi döner", async () => {
    const { seen, run } = fakeRun([{ data: null, error: { code: "PGRST116" } }]);
    expect(await selectAnalysisRows(run)).toEqual({ data: null, error: { code: "PGRST116" } });
    expect(seen).toEqual([ANALYSIS_ROW_COLUMNS]);
  });
  it("isMissingColumnError", () => {
    expect(isMissingColumnError({ code: "42703" })).toBe(true);
    expect(isMissingColumnError({ code: "23505" })).toBe(false);
    expect(isMissingColumnError(null)).toBe(false);
    expect(isMissingColumnError({})).toBe(false);
  });
});
