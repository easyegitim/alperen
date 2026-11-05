import { describe, expect, it } from "vitest";
import { isModuleWorkerFromProbe, WORKER_PROBE_URL } from "@/lib/face/workerEnv";

describe("worker türü tespiti (CSP altında)", () => {
  it("importScripts yoksa modül worker", () => {
    expect(isModuleWorkerFromProbe(undefined)).toBe(true);
  });
  it("probe başarılıysa klasik worker", () => {
    const seen: string[] = [];
    expect(isModuleWorkerFromProbe((...u) => void seen.push(...u))).toBe(false);
    expect(seen).toEqual([WORKER_PROBE_URL]);
  });
  it("modül worker'daki TypeError modül sayılır", () => {
    expect(isModuleWorkerFromProbe(() => { throw new TypeError("Module scripts don't support importScripts()"); })).toBe(true);
  });
  it("CSP engeli (NetworkError) modül sayılmaz: klasik worker", () => {
    expect(isModuleWorkerFromProbe(() => { throw new DOMException("blocked", "NetworkError"); })).toBe(false);
  });
});
