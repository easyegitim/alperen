import { scanTextV2 } from "@/lib/ai/safety";
import { exceedsBudget, exceedsOneTimeBudget } from "@/content/budget";
import { PLAN_PHASES, type PlanArea, type PlanPhase } from "@/lib/config/plan";
import type { RegionKey, ReportV3 } from "@/lib/score/contract";
import { barberSpecFor } from "./barber";
import { COST_BAND_TRY, filterByConstraints, matchesFaceShape, type MethodRecord } from "./knowledge";
import { areasForContext, basisChipsV2, constraintsFromContext, exclusionsV2, isUnder18, type PlanContextV2 } from "./planBasisV2";
import {
  PERCEPTION_AREAS,
  PlanV2,
  STRUCTURAL_REGIONS,
  buildPriorityTable,
  groupLayers,
  groupPhases,
  planIssues,
  type DisclaimerKey,
  type PlanV2 as PlanV2Type,
  type StepCard,
} from "./planTypes";

// Plan kurucu (PLAN 4d/4e; KB §6.1–6.2; CONTRACTS_V2 S2.1). Saf, paylaşılan. Claude yalnız kimlik + gerekçe + faz + bölge
// seçer (lib/ai/reportSchema.v3.ts); burada her seçim koda karşı doğrulanır: kimlik bilgi tabanında mı, kullanıcının
// kısıtlarına (K8/K9/K10/Ç1/Ç17) uyuyor mu, bütçe bandına sığıyor mu, yapısal bölge kuralı (yalnız algı/stil adımı), doktor
// katmanı plana yazılmaz. Metinler safety.ts'ten geçer; takılan gerekçe kayıt özetine düşer. Skor burada yoktur.

export const PLAN_MAX_STEPS = 16;
export const PLAN_MIN_STEPS_FALLBACK = 6;
export const PLAN_FALLBACK_STEPS = 10;

export type PlanSelection = {
  id: string;
  phase?: PlanPhase;
  region?: RegionKey;
  rationale?: string;
};

export type PlanMetaInput = {
  analysisId: string;
  generatedAt: string;
  model: string;
  promptVersion: string;
  knowledgeSource: "catalog" | "methods";
  retrievedIds: readonly string[];
  droppedUnknownIds: number;
  /** Claude seçimi alınamadı, belirlenimci yedek kullanıldı: "yapay zekâ ile hazırlandı" yerine kural tabanlı uyarısı. */
  fallback?: boolean;
};

export type BuildPlanInput = {
  selections: readonly PlanSelection[];
  /** Bilgi tabanı kayıtları (retrieve sonucu ya da get ile bulunanlar); seçim bu kümede yoksa düşer. */
  records: readonly MethodRecord[];
  report: ReportV3 | null;
  ctx: PlanContextV2;
  meta: PlanMetaInput;
  maxSteps?: number;
};

const isStructural = (r: RegionKey) => (STRUCTURAL_REGIONS as readonly string[]).includes(r);
const isPerception = (a: PlanArea) => (PERCEPTION_AREAS as readonly string[]).includes(a);
const isPhase = (v: unknown): v is PlanPhase => typeof v === "string" && (PLAN_PHASES as readonly string[]).includes(v);

/** Varsayılan faz: tek seferlik/uzman adımı hemen; emek 1 → 0–4 hafta, 2 → 1–3 ay, 3 → 3–6 ay. */
export function defaultPhase(r: Pick<MethodRecord, "effort" | "frequency" | "tier">): PlanPhase {
  if (r.frequency.per === "once" || r.tier === "expert") return "weeks_0_4";
  return r.effort === 1 ? "weeks_0_4" : r.effort === 2 ? "months_1_3" : "months_3_6";
}

/**
 * Gözlem bölgesi (saf): algı/stil alanı yapısal bölgeye bağlanabilir (perceptionOnly); diğer alanlar yalnız yapısal olmayan
 * bölgeye. Seçilen bölge kayıtla uyumsuzsa kaydın kendi bölgelerinden ilk uygun olan, o da yoksa "skin".
 */
export function resolveRegion(r: Pick<MethodRecord, "area" | "regions">, requested: RegionKey | undefined): { region: RegionKey; perceptionOnly: boolean } {
  const perception = isPerception(r.area);
  const ok = (k: RegionKey) => perception || !isStructural(k);
  const candidates: RegionKey[] = [...(requested && ok(requested) ? [requested] : []), ...r.regions.filter(ok), ...(perception ? [] : (["skin"] as RegionKey[]))];
  const region = candidates[0] ?? "skin";
  return { region, perceptionOnly: perception && isStructural(region) };
}

/** Güvenlik taramasından geçmeyen metin düşer (undefined); geçen metin kırpılır. */
export function safeText(text: string | undefined, max: number, opts: { allowDigits?: boolean } = {}): string | undefined {
  const t = text?.trim();
  if (!t) return undefined;
  const violations = scanTextV2(t, "plan").filter((v) => !(opts.allowDigits && v.rule === "score_in_text"));
  if (violations.length > 0) return undefined;
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

/** Rapordaki bölgenin ilk fırsatı ya da görüleni; nötr kısa cümle. */
export function observationFor(report: ReportV3 | null, region: RegionKey): string | undefined {
  const r = report?.regions.find((x) => x.key === region);
  if (!r) return undefined;
  return safeText(r.improvements[0] ?? r.seen, 200);
}

/**
 * Kayıt → adım kartı. summary = kaydın "ne yapılacağı" metni (nasıl/ne zaman; KB §6.1), rationale = Claude'un "neden sende"
 * gerekçesi (safety'den geçmezse düşer); ikisi ayrı alanlardır, gerekçe talimatın yerini almaz. Başlık safety'den geçmezse
 * kayıt buildPlanV2'de düşer (stepFromRecord çağrılmaz).
 */
export function stepFromRecord(r: MethodRecord, sel: PlanSelection, report: ReportV3 | null): StepCard {
  const { region, perceptionOnly } = resolveRegion(r, sel.region);
  const observation = observationFor(report, region);
  const summary = safeText(r.summary, 400, { allowDigits: true });
  const rationale = safeText(sel.rationale, 400);
  const barber = r.area === "hair" || r.area === "beard" ? barberSpecFor(r.tryonPresetId ?? r.id) : undefined;
  return {
    id: r.id,
    area: r.area,
    phase: sel.phase && isPhase(sel.phase) ? sel.phase : defaultPhase(r),
    tier: r.tier,
    title: r.title,
    ...(summary ? { summary } : {}),
    ...(rationale ? { rationale } : {}),
    observationRef: { region, ...(observation ? { observation } : {}) },
    costTryRange: r.costTryRange ?? COST_BAND_TRY[r.costBand],
    frequency: r.frequency,
    minutesPerDay: r.minutesPerDay,
    difficulty: r.difficulty,
    impact: r.impact,
    effort: r.effort,
    evidence: { level: r.evidence.level, ...(r.evidence.source ? { source: r.evidence.source } : {}) },
    ...(perceptionOnly ? { perceptionOnly: true } : {}),
    ...(r.tryonPresetId ? { tryonPresetId: r.tryonPresetId } : {}),
    ...(barber ? { barberSpec: barber } : {}),
  };
}

export type DroppedReason = "unknown" | "doctor_tier" | "constraint" | "area" | "face_shape" | "budget" | "safety" | "duplicate" | "limit";

export type BuildPlanResult = { plan: PlanV2Type; dropped: { id: string; reason: DroppedReason }[] };

/**
 * Seçimleri kodla doğrular ve PlanV2 kurar. Hiçbir adım uydurulmaz: her kimlik `records` içinde olmalı; kısıtlar
 * filterByConstraints ile (model görmez); doktor katmanı adımı plana yazılmaz; en çok maxSteps adım.
 */
export function buildPlanV2(input: BuildPlanInput): BuildPlanResult {
  const { ctx, report } = input;
  const max = Math.min(40, input.maxSteps ?? PLAN_MAX_STEPS);
  const byId = new Map(input.records.map((r) => [r.id, r]));
  const constraints = constraintsFromContext(ctx);
  const areas = new Set<PlanArea>(areasForContext(ctx));
  const dropped: BuildPlanResult["dropped"] = [];
  const steps: StepCard[] = [];
  const seen = new Set<string>();

  for (const sel of input.selections) {
    const r = byId.get(sel.id);
    if (!r) {
      dropped.push({ id: sel.id, reason: "unknown" });
      continue;
    }
    if (seen.has(r.id)) {
      dropped.push({ id: r.id, reason: "duplicate" });
      continue;
    }
    seen.add(r.id);
    if (r.tier === "doctor") {
      dropped.push({ id: r.id, reason: "doctor_tier" });
      continue;
    }
    if (!areas.has(r.area)) {
      dropped.push({ id: r.id, reason: "area" });
      continue;
    }
    if (filterByConstraints([r], constraints).length === 0) {
      dropped.push({ id: r.id, reason: "constraint" });
      continue;
    }
    // Saç/sakal kaydı yüz şekline (kullanıcı düzeltmesi dahil) göre süzülür (PLAN §3); şekil bilinmiyorsa süzgeç yok.
    if (!matchesFaceShape(r, ctx.faceShape)) {
      dropped.push({ id: r.id, reason: "face_shape" });
      continue;
    }
    // Bilgi tabanı başlığı da safety.ts'ten geçer (TSV kaydı ilaç/işlem/teşhis adı taşıyamaz; eski JSON sızdırmaz).
    if (!safeText(r.title, 120, { allowDigits: true })) {
      dropped.push({ id: r.id, reason: "safety" });
      continue;
    }
    const cost = r.costTryRange ?? COST_BAND_TRY[r.costBand];
    // Tekrarlı adım aylık banda, tek seferlik (kesim, uzman, klinik) adım tek seferlik banda sığmalı (PLAN §3 bütçe → ₺).
    const overBudget = r.frequency.per === "once" ? exceedsOneTimeBudget(cost, ctx.questionnaire.oneTimeBudget, ctx.questionnaire.budget) : exceedsBudget(cost, ctx.questionnaire.budget);
    if (overBudget) {
      dropped.push({ id: r.id, reason: "budget" });
      continue;
    }
    if (steps.length >= max) {
      dropped.push({ id: r.id, reason: "limit" });
      continue;
    }
    steps.push(stepFromRecord(r, sel, report));
  }

  // Belirlenimci yedekte "yapay zekâ ile hazırlandı" denmez (sahte başarı yok): kural tabanlı seçim uyarısı yazılır.
  const disclaimers: DisclaimerKey[] = ["notMedicalAdvice", input.meta.fallback ? "deterministicFallback" : "aiGenerated", "changeTakesWeeks", "cosmeticProcedures"];
  if (isUnder18(ctx.ageBand)) disclaimers.push("under18Limits");

  const plan: PlanV2Type = {
    version: "plan.v2",
    phases: groupPhases(steps),
    steps,
    priorityTable: buildPriorityTable(steps),
    basisChips: basisChipsV2(ctx),
    layers: groupLayers(steps),
    exclusions: exclusionsV2(ctx),
    disclaimers,
    meta: {
      analysisId: input.meta.analysisId,
      generatedAt: input.meta.generatedAt,
      model: input.meta.model.slice(0, 80),
      promptVersion: input.meta.promptVersion.slice(0, 40),
      knowledgeSource: input.meta.knowledgeSource,
      retrievedIds: input.meta.retrievedIds.slice(0, 40),
      droppedUnknownIds: input.meta.droppedUnknownIds + dropped.filter((d) => d.reason === "unknown").length,
    },
  };
  const issues = planIssues(plan);
  if (issues.length > 0) throw new Error(`plan_invalid: ${issues.join(", ")}`);
  const parsed = PlanV2.safeParse(plan);
  if (!parsed.success) throw new Error(`plan_schema: ${parsed.error.issues[0]?.message ?? "?"}`);
  return { plan: parsed.data, dropped };
}

/**
 * Model yokken ya da seçim boş/yetersizken belirlenimci seçim (rapor asla boş gitmez): retrieve sırasına göre alan başına
 * sırayla (round-robin) en çok n kayıt. Rapor bölgesi kaydın kendi bölgesinden gelir.
 */
export function fallbackSelections(records: readonly MethodRecord[], n = PLAN_FALLBACK_STEPS): PlanSelection[] {
  const byArea = new Map<PlanArea, MethodRecord[]>();
  for (const r of records) {
    if (r.tier === "doctor") continue;
    const list = byArea.get(r.area) ?? [];
    list.push(r);
    byArea.set(r.area, list);
  }
  const out: PlanSelection[] = [];
  let progressed = true;
  while (out.length < n && progressed) {
    progressed = false;
    for (const list of byArea.values()) {
      const r = list.shift();
      if (!r) continue;
      out.push({ id: r.id });
      progressed = true;
      if (out.length >= n) break;
    }
  }
  return out;
}

/** Claude seçimi az geldiyse (ya da hiç gelmediyse) belirlenimci tamamlayıcı. */
export function topUpSelections(selections: readonly PlanSelection[], records: readonly MethodRecord[], min = PLAN_MIN_STEPS_FALLBACK): PlanSelection[] {
  if (selections.length >= min) return [...selections];
  const have = new Set(selections.map((s) => s.id));
  const extra = fallbackSelections(records.filter((r) => !have.has(r.id)), min - selections.length);
  return [...selections, ...extra];
}
