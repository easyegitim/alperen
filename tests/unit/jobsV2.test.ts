import { describe, expect, it } from "vitest";
import { SECTION_KEYS } from "@/lib/score/contract";
import { JOB_STALE_MS, failureOf, isJobStale, runAnalysisJob } from "@/lib/score/engine/jobs";
import { computeSetKey } from "@/lib/score/setKey";
import { ApiError } from "@/lib/api/errors";
import { GEO } from "../helpers/engineFixtures";
import { FakeRepo, FakeScoringV2, IMAGES, failRun, okRun, scoreOutput } from "../helpers/engineV2Fixtures";

// Arka plan işi (PLAN_V2 3a, 3b): kart kart sections_ready, completed satırı, coach_reports, set önbelleği (hit/miss),
// başarısızlıkta failed + failure + ai_usage (fırlatmaz; hak düşmez).

const H = ["a".repeat(64), "b".repeat(64)];
const CTX = { ageBand: null, presentation: "unspecified" as const, headCoveringDeclared: false, faceShapeOverride: null };
const ENV = { ANTHROPIC_API_KEY: "test", SET_CACHE_SECRET: "gizli" };

function job(repo: FakeRepo, provider: FakeScoringV2, env: Record<string, string> = ENV, hashes: string[] | null = H, userId = "u1") {
  return runAnalysisJob({ repo, analysisId: "a1", userId, images: IMAGES, sourceHashes: hashes, geometry: GEO, context: CTX, env, engine: { provider, auditProvider: null } });
}

describe("runAnalysisJob", () => {
  it("başarı: running → bölümler sırayla sections_ready'ye eklenir → completed; rapor coach_reports'a; set önbelleğe", async () => {
    const repo = new FakeRepo();
    const provider = new FakeScoringV2([okRun(scoreOutput({ skin: 6.1 }))]);
    const r = await job(repo, provider);
    expect(r).toEqual({ status: "completed", cacheHit: false });
    expect(repo.updates[0].patch).toMatchObject({ status: "running", set_key: computeSetKey("gizli", H) });
    const readyLists = repo.updates.map((u) => u.patch.sections_ready).filter(Array.isArray);
    expect(readyLists[0]).toEqual(["device", "overall"]);
    expect(readyLists[1]).toEqual(["device", "overall", "subscores"]);
    expect(readyLists[readyLists.length - 1]).toEqual([...SECTION_KEYS]);
    const row = repo.row();
    expect(row).toMatchObject({ status: "completed", engine_version: "hybrid.v2", calibration_version: "h2", prompt_version: "score.v2", scoring_model: "claude-opus-5-5" });
    expect(row.subscores).toMatchObject({ skin: 6.1 });
    expect(typeof row.completed_at).toBe("string");
    expect((row.signals as { progressAt: string }).progressAt).toBeTruthy();
    expect(repo.reports).toHaveLength(1);
    expect(repo.reports[0]).toMatchObject({ user_id: "u1", analysis_id: "a1", prompt_version: "report.v3", is_fallback: false });
    expect(repo.sets.size).toBe(1);
    const cached = repo.sets.get(computeSetKey("gizli", H) as string);
    expect(cached?.scores.overall).toBe(row.overall);
    expect(JSON.stringify(cached)).not.toMatch(/AAAA|"runs"|progressAt/);
    expect(provider.calls).toBe(3);
  });
  it("set önbelleği isabeti: model çağrılmaz, saklı skor ve rapor kopyalanır, tüm bölümler hazır, ai_usage sıfır", async () => {
    const repo = new FakeRepo();
    await job(repo, new FakeScoringV2([okRun(scoreOutput({ skin: 6.1 }))]));
    const repo2 = new FakeRepo();
    for (const [k, v] of repo.sets) repo2.sets.set(k, v);
    const provider = new FakeScoringV2([okRun(scoreOutput({ skin: 9 }))]);
    const r = await job(repo2, provider, ENV, [H[1], H[0]]); // sıra bağımsız
    expect(r).toEqual({ status: "completed", cacheHit: true });
    expect(provider.calls).toBe(0);
    const row = repo2.row();
    expect(row.subscores).toMatchObject({ skin: 6.1 });
    expect(row.sections_ready).toEqual([...SECTION_KEYS]);
    expect((row.signals as { cacheHit: boolean }).cacheHit).toBe(true);
    expect(repo2.reports[0].report).toEqual(repo.reports[0].report);
    expect(row.ai_usage).toMatchObject({ calls: 0, estUsd: 0 });
  });
  it("başka kullanıcının aynı set anahtarı isabet sayılmaz: skor ve rapor kopyalanmaz, model çağrılır", async () => {
    const repo = new FakeRepo();
    await job(repo, new FakeScoringV2([okRun(scoreOutput({ skin: 6.1 }))]));
    const provider = new FakeScoringV2([okRun(scoreOutput({ skin: 7.7 }))]);
    const r = await job(repo, provider, ENV, H, "user-B");
    expect(r).toEqual({ status: "completed", cacheHit: false });
    expect(provider.calls).toBe(3);
    expect(repo.row().subscores).toMatchObject({ skin: 7.7 });
  });
  it("önbellek ıskası: farklı set, secret yok ya da süresi dolmuş satır → model çağrılır", async () => {
    const repo = new FakeRepo();
    await job(repo, new FakeScoringV2([okRun(scoreOutput())]));
    const p1 = new FakeScoringV2([okRun(scoreOutput())]);
    await job(repo, p1, ENV, [H[0], "c".repeat(64)]);
    expect(p1.calls).toBe(3);
    const p2 = new FakeScoringV2([okRun(scoreOutput())]);
    await job(repo, p2, { ANTHROPIC_API_KEY: "test" }, H);
    expect(p2.calls).toBe(3);
    expect(repo.updates.filter((u) => u.patch.status === "running").at(-1)?.patch).toMatchObject({ set_key: null });
    for (const v of repo.sets.values()) v.expires_at = "2020-01-01T00:00:00.000Z";
    const p3 = new FakeScoringV2([okRun(scoreOutput())]);
    await job(repo, p3, ENV, H);
    expect(p3.calls).toBe(3);
  });
  it("başarısızlık: failed + signals.failure + ai_usage; fırlatmaz; önbelleğe yazılmaz; rapor yok", async () => {
    const repo = new FakeRepo();
    const r = await job(repo, new FakeScoringV2([failRun("refusal"), failRun("refusal"), failRun("refusal")]));
    expect(r).toEqual({ status: "failed", failure: { code: "AI_SAFETY_BLOCKED", retryable: false } });
    const row = repo.row();
    expect(row.status).toBe("failed");
    expect((row.signals as { failure: unknown }).failure).toEqual({ code: "AI_SAFETY_BLOCKED", retryable: false });
    expect((row.ai_usage as { attempts: number }).attempts).toBe(3);
    expect(repo.reports).toHaveLength(0);
    expect(repo.sets.size).toBe(0);
    expect(failureOf(new ApiError("AI_TIMEOUT", "x"))).toEqual({ code: "AI_TIMEOUT", retryable: true });
    expect(failureOf(new Error("db"))).toEqual({ code: "AI_FAILED", retryable: true });
  });
  it("DB hatası bile fırlatmaz (loglanır)", async () => {
    const repo = new FakeRepo();
    repo.failUpdates = true;
    const r = await job(repo, new FakeScoringV2([okRun(scoreOutput())]));
    expect(r.status).toBe("failed");
  });
});

describe("isJobStale", () => {
  const t0 = Date.parse("2026-11-04T10:00:00.000Z");
  it("yalnız queued/running; ilerleme zamanı (signals.progressAt) ya da created_at 10 dk'yı aşınca takılı", () => {
    expect(JOB_STALE_MS).toBe(600_000);
    expect(isJobStale({ status: "running", created_at: "2026-11-04T10:00:00.000Z" }, t0 + 60_000)).toBe(false);
    expect(isJobStale({ status: "running", created_at: "2026-11-04T10:00:00.000Z" }, t0 + 601_000)).toBe(true);
    expect(isJobStale({ status: "running", created_at: "2026-11-04T09:00:00.000Z", signals: { progressAt: "2026-11-04T10:05:00.000Z" } }, t0 + 601_000)).toBe(false);
    expect(isJobStale({ status: "completed", created_at: "2026-11-04T09:00:00.000Z" }, t0 + 601_000)).toBe(false);
    expect(isJobStale({ status: "queued", created_at: "bozuk" }, t0)).toBe(true);
  });
});
