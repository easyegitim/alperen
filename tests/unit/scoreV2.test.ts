import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api/errors";
import { SUB_KEYS_V2 } from "@/lib/config/teaser";
import { ClientSignalsV2, REGION_KEYS, ReportV3, type SectionKey } from "@/lib/score/contract";
import { scoreV2, type ScoreV2Context } from "@/lib/score/engine/scoreV2";
import type { SectionPatchV2 } from "@/lib/score/engine/typesV2";
import { deviceResultFromGeometry, toClientAnalysisV2, type AnalysisRowV2 } from "@/lib/score/present";
import { GEO } from "../helpers/engineFixtures";
import { FakeAudit, FakeScoringV2, IMAGES, assessment, failRun, okRun, scoreOutput } from "../helpers/engineV2Fixtures";

// hybrid.v2 uçtan uca (sahte sağlayıcılar; ağ yok): ortanca → harman → kalibrasyon → potansiyel → açıklama → rapor →
// denetim → kart kart bölümler; kilit kuralları present.ts ile; satıra giden hiçbir şeyde görsel/landmark yok.

const CTX: ScoreV2Context = { ageBand: "25_34", presentation: "male", headCoveringDeclared: false, faceShapeOverride: null };
const ENV = { ANTHROPIC_API_KEY: "test", STRUCTURAL_SOURCE: "blend" };

async function run(outs = [scoreOutput(), scoreOutput(), scoreOutput()], ctx = CTX, env: Record<string, string> = ENV, audit: FakeAudit | null = null) {
  const sections: { section: SectionKey; patch: SectionPatchV2 }[] = [];
  const provider = new FakeScoringV2(outs.map((o) => okRun(o)));
  const scored = await scoreV2({ images: IMAGES, geometry: GEO, context: ctx }, { provider, auditProvider: audit, env, onSection: (section, patch) => void sections.push({ section, patch }) });
  return { scored, sections, provider };
}

describe("scoreV2: çalışılmış tipik örnek", () => {
  it("her alt skor 5,5 ve bant içi geometri → genel 5,5, yüzdelik 50, aralık 5,3–5,7; potansiyel 5,8 plan adımlarına bağlı", async () => {
    const { scored, provider } = await run();
    expect(provider.calls).toBe(3);
    expect(provider.imageCounts).toEqual([2, 2, 2]);
    expect(scored.overall).toBe(5.5);
    expect(scored.percentile).toBe(50);
    expect(scored.scoreRange.overall).toEqual([5.3, 5.7]);
    for (const k of SUB_KEYS_V2) expect(scored.subscores[k]).toBe(5.5);
    expect(scored.potential).toBe(5.8);
    expect(scored.gains.skin).toBe(0.8);
    expect(scored.signals.improveFirst.map((i) => i.stepId)).toEqual(["st_spf", "st_hair_conditioner", "st_lip_balm"]);
    expect(scored.engineVersion).toBe("hybrid.v2");
    expect(scored.calibrationVersion).toBe("h2");
    expect(scored.promptVersion).toBe("score.v2");
    expect(scored.model).toBe("claude-opus-5-5");
    expect(scored.runs).toHaveLength(3);
    expect(scored.runs[0]).toHaveLength(7);
    expect(scored.aiUsage.input).toBe(15000);
    expect(scored.aiUsage.calls).toBe(3);
    expect(scored.aiUsage.estUsd).toBeGreaterThan(0);
  });
  it("yapısal harman: Claude 7,5 + geometri 5,5 → ham 6,5 (blend); geometry kaynağında 5,5; claude kaynağında 7,5", async () => {
    const outs = [scoreOutput({ harmony: 7.5 }), scoreOutput({ harmony: 7.5 }), scoreOutput({ harmony: 7.5 })];
    expect((await run(outs)).scored.subscores.harmony).toBe(6.5);
    expect((await run(outs, CTX, { ...ENV, STRUCTURAL_SOURCE: "geometry" })).scored.subscores.harmony).toBe(5.5);
    expect((await run(outs, CTX, { ...ENV, STRUCTURAL_SOURCE: "claude" })).scored.subscores.harmony).toBe(7.5);
    const s = (await run(outs)).scored.signals;
    expect(s.structuralUsed.harmony).toBe("blend");
    expect(s.claudeStructural.harmony).toBe(7.5);
    expect(s.geometryStructural.harmony).toBe(5.5);
  });
  it("ortanca: 3 çalıştırma (6 / 6,2 / 7) → cilt 6,2; metin ortancaya en yakın çalıştırmadan; yayılım > 0,5 → 4. çalıştırma", async () => {
    const a = scoreOutput({ skin: 6 });
    const b = scoreOutput({ skin: 6.2 });
    b.report.letter = "ORTANCA MEKTUP. En güçlü yanın cilt. Fırsat saç.";
    const c = scoreOutput({ skin: 7 });
    const d = scoreOutput({ skin: 6.3 });
    const { scored, provider } = await run([a, b, c, d]);
    expect(provider.calls).toBe(4);
    expect(scored.signals.runs.extraRun).toBe("done");
    expect(scored.subscores.skin).toBe(6.3); // dördün ortancası (6,2 + 6,3) / 2 = 6,25 → 6,3
    expect(scored.signals.runs.maxSpread).toBe(1);
  });
  it("kalibrasyon env'den (merkez 6): tipik profil 6,0", async () => {
    const { scored } = await run(undefined, CTX, { ...ENV, CALIBRATION_H2_CENTER: "6" });
    expect(scored.overall).toBe(6.0);
    expect(scored.signals.calibration).toEqual({ version: "h2", center: 6, sd: 1.5 });
  });
});

describe("scoreV2: bölümler, sinyaller ve rapor", () => {
  it("kart kart sıra; sayısal bölümler denetimden önce, metinler sonra; rapor son", async () => {
    const { sections } = await run();
    expect(sections.map((s) => s.section)).toEqual(["overall", "subscores", "potential", "faceShape", "explanations", "improveFirst", "report"]);
    expect(sections[0].patch.overall).toBe(5.5);
    expect(sections[0].patch.signals?.explanations).toEqual({});
    expect(Object.keys(sections[4].patch.signals?.explanations ?? {})).toHaveLength(7);
    expect(sections[6].patch.report?.version).toBe("report.v3");
  });
  it("signals istemci sözleşmesine uyar; rapor dokuz bölge, ölçüler bantlı oranlar, kapanış 'Tıbbi tavsiye değildir.'", async () => {
    const { scored } = await run();
    expect(ClientSignalsV2.safeParse(scored.signals).success).toBe(true);
    expect(ReportV3.safeParse(scored.report).success).toBe(true);
    expect(scored.report.regions.map((r) => r.key)).toEqual([...REGION_KEYS]);
    expect(scored.report.measures.map((m) => m.key)).toEqual(["canthalTiltDeg", "jawRatio"]);
    expect(scored.report.measures[1]).toEqual({ key: "jawRatio", value: 0.85, balancedRange: [0.75, 0.95] });
    expect(scored.report.closing.endsWith("Tıbbi tavsiye değildir.")).toBe(true);
    expect(scored.signals.faceShapeDetailed).toEqual({ shape: "oval", reason: "Yan profilde çene yumuşak geçişli." });
    expect(scored.signals.viewsUsed).toEqual(["front", "profile_left"]);
    expect(scored.signals.explanations.skin?.confidenceNote).toBe("İki açı kullanıldı; ışık dengeli; güven yüksek.");
    expect(scored.signals.explanations.harmony?.raise[0].step).toBe("Dokulu kısa kesim");
  });
  it("denetim: yeniden yazım uygulanır; takılan Claude cümlesi şablona düşer; seeProfessional yalnız 'olabilir' kalıbıyla kapanışa girer", async () => {
    const o = scoreOutput();
    o.report.regions[2] = { key: "nose", strength: "Burun profili dengeli.", seen: "Basık burun yapısı var.", improvements: [] };
    o.subscores.skin = assessment(5.5, { lowered: ["Puanın 6,1 çünkü parlama var."] });
    o.seeProfessional = { text: "Yanaklardaki yaygın kızarıklık için bir dermatoloğa göstermek faydalı olabilir." };
    const audit = new FakeAudit({ rewrites: [{ path: "regions.nose.seen", text: "Burun yapısal bir özellik; bakım planının konusu değil." }], notes: [] });
    const { scored } = await run([o, o, o], CTX, ENV, audit);
    expect(audit.calls).toBe(1);
    expect(scored.report.regions[2].seen).toBe("Burun yapısal bir özellik; bakım planının konusu değil.");
    expect(scored.signals.explanations.skin?.lowered).toEqual([]);
    expect(scored.signals.audit).toMatchObject({ audited: true, rewrites: 1, fallbacks: 1, flags: ["score_in_text"] });
    expect(scored.report.closing).toContain("dermatoloğa göstermek faydalı olabilir");
    expect(scored.observations.seeProfessional).toContain("olabilir");
    expect(scored.aiUsage.attempts).toBe(4);
    const noPattern = scoreOutput({}, { seeProfessional: { text: "Rozasea var." } });
    expect((await run([noPattern, noPattern, noPattern])).scored.observations.seeProfessional).toBeNull();
  });
  it("başörtüsü (beyan ya da tespit) → saç hariç: ağırlık 0, alt skor null, notAssessed excluded, öncelikte saç yok, istemde saç adımı yok", async () => {
    const { scored, provider } = await run(undefined, { ...CTX, headCoveringDeclared: true });
    expect(scored.subscores.hair).toBeNull();
    expect(scored.signals.weights.hair).toBe(0);
    expect(scored.signals.notAssessed).toEqual([{ sub: "hair", reason: "excluded" }]);
    expect(scored.signals.improveFirst.some((i) => i.sub === "hair")).toBe(false);
    expect(scored.signals.explanations).not.toHaveProperty("hair");
    expect(provider.texts[0]).toContain("hair: (adım yok; raise boş)");
    const detected = scoreOutput({}, { headCoveringDetected: true });
    expect((await run([detected, detected, detected])).scored.subscores.hair).toBeNull();
  });
  it("satıra giden hiçbir şeyde görsel verisi veya landmark yok", async () => {
    const { scored } = await run();
    expect(JSON.stringify(scored)).not.toMatch(/AAAA|BBBB|landmarks|"x":/);
  });
});

describe("scoreV2: kilit kuralları (present.ts ile)", () => {
  it("hak yok → cihaz dışında her şey kilitli, gerçek değer JSON'da yok; hak var → değer + aralık; yüzdelik yalnız bayrakla", async () => {
    const { scored } = await run([scoreOutput({ skin: 6.9 }), scoreOutput({ skin: 6.9 }), scoreOutput({ skin: 6.9 })]);
    const row: AnalysisRowV2 = {
      id: "a1",
      status: "completed",
      created_at: "2026-11-04T10:00:00Z",
      face_shape: scored.faceShape,
      overall: scored.overall,
      potential: scored.potential,
      subscores: scored.subscores as Record<string, number>,
      gains: scored.gains,
      observations: scored.observations,
      geometry: GEO,
      calibration_version: "h2",
      engine_version: "hybrid.v2",
      signals: scored.signals,
      device_result: deviceResultFromGeometry(GEO),
      score_range: scored.scoreRange,
      percentile: scored.percentile,
      sections_ready: ["device", "overall", "subscores", "potential", "faceShape", "explanations", "improveFirst", "report"],
      report: scored.report,
    };
    const locked = toClientAnalysisV2(row, { entitled: false, referralUnlock: false, percentile: true });
    expect(locked.overall).toEqual({ value: null, locked: true });
    expect(locked.subscores.skin).toEqual({ value: null, locked: true });
    expect(locked.report).toEqual({ value: null, locked: true });
    expect(locked.sectionsReady).toEqual(["device"]);
    expect(locked.device?.ratios.jawRatio).toBe(0.85);
    expect(JSON.stringify(locked)).not.toMatch(/6\.9|"range":\[|st_spf|Tıbbi|claudeStructural|runs/);
    const open = toClientAnalysisV2(row, { entitled: true, referralUnlock: false, percentile: false });
    expect(open.subscores.skin).toEqual({ value: { value: 6.9, range: [6.7, 7.1] }, locked: false });
    expect(open.overall.value?.percentile).toBeNull();
    expect(open.report.value?.regions).toHaveLength(9);
    expect(open.faceShape?.agree).toBe(true);
    expect(JSON.stringify(open)).not.toMatch(/claudeStructural|"runs"|rawOverall/);
    expect(toClientAnalysisV2(row, { entitled: true, referralUnlock: false, percentile: true }).overall.value?.percentile).toBeGreaterThan(50);
  });
});

describe("scoreV2: hatalar (hak düşmez; rota failed yazar)", () => {
  it("iki ret → AI_SAFETY_BLOCKED; hepsi zaman aşımı → AI_TIMEOUT; tek yüz değil → NO_FACE; kullanım hataya iliştirilir", async () => {
    const ctx = CTX;
    const blocked = new FakeScoringV2([failRun("refusal"), failRun("refusal"), okRun(scoreOutput())]);
    const e1 = await scoreV2({ images: IMAGES, geometry: GEO, context: ctx }, { provider: blocked, auditProvider: null, env: ENV }).catch((e: unknown) => e);
    expect(e1).toBeInstanceOf(ApiError);
    expect((e1 as ApiError).code).toBe("AI_SAFETY_BLOCKED");
    expect((e1 as { aiUsage?: { attempts: number } }).aiUsage?.attempts).toBe(3);

    const timeouts = new FakeScoringV2([failRun("timeout")]);
    const e2 = await scoreV2({ images: IMAGES, geometry: GEO, context: ctx }, { provider: timeouts, auditProvider: null, env: ENV }).catch((e: unknown) => e);
    expect((e2 as ApiError).code).toBe("AI_TIMEOUT");

    const none = scoreOutput({}, { photo: { faceCount: "none", viewsUsable: [], lighting: "even", retouch: "none", skinVisibility: "clear" } });
    const noFace = new FakeScoringV2([okRun(none), okRun(none), okRun(scoreOutput())]);
    const e3 = await scoreV2({ images: IMAGES, geometry: GEO, context: ctx }, { provider: noFace, auditProvider: null, env: ENV }).catch((e: unknown) => e);
    expect((e3 as ApiError).code).toBe("NO_FACE");

    const fatal = new FakeScoringV2([failRun("fatal", 1, { status: 400 })]);
    const e4 = await scoreV2({ images: IMAGES, geometry: GEO, context: ctx }, { provider: fatal, auditProvider: null, env: ENV }).catch((e: unknown) => e);
    expect((e4 as ApiError).code).toBe("AI_FAILED");
  });
});
