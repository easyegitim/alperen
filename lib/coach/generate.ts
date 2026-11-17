import "server-only";

import { FACE_SHAPES } from "@/content/face-shapes";
import { buildFallbackReport, contourTips } from "@/content/fallback-report";
import { ALL_PRESETS } from "@/content/presets";
import { DEADLINE_ABORT_REASON } from "@/lib/ai/anthropic";
import { COACH, getReportProvider, type ReportProvider, type ReportUsageCallback } from "@/lib/ai/provider";
import {
  REPORT_PROMPT_VERSION,
  buildReportSystemPromptV2,
  buildReportUserMessageV2,
  safetyRetryNote,
  type PromptPriority,
  type PromptQuestionnaire,
} from "@/lib/ai/prompts/report.v2";
import { CoachReport } from "@/lib/ai/reportSchema";
import { scanReport, stripViolations, type SafetyRule } from "@/lib/ai/safety";
import type { TokenUsage } from "@/lib/config/ai.server";
import type { FaceShape, GeometryResult } from "@/lib/face/types";
import { deriveContext, type Questionnaire } from "@/lib/questionnaire";
import { MOD_SUBS, type ModSub, type NotAssessed } from "@/lib/score/contract";
import { bodyRules, type BodyRules } from "./bodyRules";
import { allowedCatalog, catalogForPrompt, type AllowedCatalog } from "./catalog";
import { exerciseEligible, hairAdviceAllowed } from "./eligibility";
import { fitReportLengths } from "./fitLengths";

/** Raporun "önce odaklan" listesi: motorun improveFirst'ü + etiket + katalog kimlikleri (reportsStore, LEVERS). */
export type PriorityItem = PromptPriority;

export type ReportInput = {
  /** Yalnız yedek rapor içindir; modele gitmez (engine spec §9.6). */
  overall: number;
  /** Yalnız yedek rapor içindir; modele gitmez. */
  potential: number;
  /** Saklanan altı alt skor. Modele yalnız değerlendirilmiş skin/hair/grooming gider. */
  subscores: Record<string, number>;
  gains: Record<"skin" | "hair" | "grooming" | "jawline", { value: number; lever: string }>;
  /** Modele yalnız skin, hair, brows, facialHair anahtarları gider. */
  observations: Record<string, string>;
  flags: { visibleSkinConcern: boolean; skinConcernNote: string | null };
  faceShape: GeometryResult["faceShape"];
  /** Kullanılmaz: report.v2 oran göndermez (geometrySummary kaldırıldı). Eski çağıranlar için isteğe bağlı. */
  metrics?: GeometryResult["metrics"] | null;
  questionnaire: Questionnaire;
  /** hybrid.v1: değerlendirilmeyen alanlar (eski satırlarda yok). */
  notAssessed?: NotAssessed[];
  /** hybrid.v1: öncelikler (eski satırlarda boş). */
  priorities?: PriorityItem[];
};

/** coach_reports.ai_usage (engine spec §7.1, §9.6): her denemenin toplamı; estUsd ops.daily_ai_cost'a gider. */
export type CoachAiUsage = {
  attempts: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  /** Fiyatı bilinmeyen sağlayıcı (Gemini) denemesi varsa null; görünüm rapor başına sabit tahmine düşer. */
  estUsd: number | null;
  servedModels: string[];
};

export type GeneratedReport = {
  report: CoachReport;
  isFallback: boolean;
  safetyFlags: SafetyRule[];
  model: string;
  promptVersion: string;
  /** Bütün denemelerin girdi toplamı (önbellek okuma/yazma dahil); deneme yoksa null. */
  inputTokens: number | null;
  outputTokens: number | null;
  aiUsage: CoachAiUsage;
};

export type GenerateOptions = {
  /** Mutlak son tarih (ms). Varsayılan: şimdi + COACH.deadlineMs. */
  deadlineAt?: number;
  now?: () => number;
  /** Deneme başına kullanım (toplayıcıya ek olarak). */
  onUsage?: ReportUsageCallback;
};

const OBS_KEYS = ["skin", "hair", "brows", "facialHair"] as const;
const ALLOWED_SPECIALTIES = ["dermatoloji", "sac_sagligi", "dis_ortodonti", "diyetisyen", "psikolog"];

/** Kodda uygulanan sınırlar (SPEC 9.4, 9.8 kural 6–8): model ne derse desin. Yüz hatları ipuçları kodla yazılır. */
export function enforceRules(report: CoachReport, q: Questionnaire, body: BodyRules, catalog: AllowedCatalog): CoachReport {
  const r = structuredClone(report);
  const allowed = new Set([...catalog.hair, ...catalog.beard, ...catalog.color].map((p) => p.id));
  const exIds = new Set(catalog.exercises.map((e) => e.id));
  const stepIds = new Set(catalog.skinSteps.map((s) => s.id));
  const habitIds = new Set(catalog.habits.map((h) => h.id));
  r.hair = hairAdviceAllowed(q) ? r.hair.filter((p) => allowed.has(p.presetId)) : [];
  r.beard = r.beard.filter((p) => allowed.has(p.presetId));
  r.hairColor = hairAdviceAllowed(q) && r.hairColor && allowed.has(r.hairColor.presetId) ? r.hairColor : null;
  r.exercises = exerciseEligible(q) ? r.exercises.filter((e) => exIds.has(e.id)) : [];
  r.habits = r.habits.filter((h) => habitIds.has(h.id));
  for (const slot of ["morning", "evening", "weekly"] as const) r.skincare[slot] = r.skincare[slot].filter((s) => stepIds.has(s.stepType));
  // report.v2 kural 6: model kilo/beden metni yazmaz; ipuçları kodla (contourTips) doldurulur.
  r.faceContours = body.faceContoursEnabled ? { enabled: true, tips: contourTips(body) } : { enabled: false, tips: [] };
  const known = new Set([...allowed, ...exIds, ...stepIds, ...habitIds]);
  for (const k of ["skin", "hair", "grooming", "jawline"] as const) r.linkedActions[k] = r.linkedActions[k].filter((id) => known.has(id));
  if (r.seeProfessional && !ALLOWED_SPECIALTIES.includes(r.seeProfessional.specialty)) r.seeProfessional = null;
  return r;
}

/** Geçerli presetId var mı (şema sonrası kimlik doğrulaması)? Bilinmeyen id'ler şema hatası sayılır → tekrar. */
function hasUnknownIds(report: CoachReport): boolean {
  const ids = new Set(ALL_PRESETS.map((p) => p.id));
  const picks = [...report.hair, ...report.beard, ...(report.hairColor ? [report.hairColor] : [])];
  return picks.some((p) => !ids.has(p.presetId));
}

/** Uzunluk onarımı → şema → bilinmeyen id. Başarısızsa null. */
function validate(raw: unknown): CoachReport | null {
  if (raw === null || raw === undefined) return null;
  const r = CoachReport.safeParse(fitReportLengths(raw));
  return r.success && !hasUnknownIds(r.data) ? r.data : null;
}

/** Modele giden en az veri (engine spec §9.6). Saf; birim testi var. */
export function buildReportPromptInput(input: ReportInput, catalog: AllowedCatalog, body: BodyRules) {
  const q = input.questionnaire;
  const notAssessed = input.notAssessed ?? [];
  const skipped = new Set(notAssessed.map((n) => n.sub));
  const subscores: Partial<Record<ModSub, number>> = {};
  for (const k of MOD_SUBS) {
    const v = input.subscores[k];
    if (!skipped.has(k) && typeof v === "number" && Number.isFinite(v)) subscores[k] = v;
  }
  const observations: Partial<Record<(typeof OBS_KEYS)[number], string>> = {};
  for (const k of OBS_KEYS) {
    const v = input.observations[k];
    if (typeof v === "string" && v.trim()) observations[k] = v;
  }
  // Katalog kimlikleri kullanıcının izinli kataloğuyla kesişir; değerlendirilmeyen alanın önceliği gönderilmez.
  const known = new Set([...catalog.skinSteps.map((s) => s.id), ...catalog.habits.map((h) => h.id)]);
  const priorities = (input.priorities ?? [])
    .filter((p) => !skipped.has(p.sub))
    .map((p) => ({ ...p, catalogIds: p.catalogIds.filter((id) => known.has(id)) }));
  // İzin listesi: boy/kilo/aktivite, çene sağlığı ve not modele gitmez; ankete eklenen yeni alan da kendiliğinden gitmez.
  const questionnaire: PromptQuestionnaire = {
    goals: q.goals,
    presentation: q.presentation,
    hairType: q.hairType,
    hairLength: q.hairLength,
    beardPreference: q.beardPreference,
    beardGrowth: q.beardGrowth,
    skinType: q.skinType,
    budget: q.budget,
    minutesPerDay: q.minutesPerDay,
    glasses: q.glasses,
    headCovering: q.headCovering,
  };
  const shape = FACE_SHAPES[input.faceShape.primary as FaceShape];
  return buildReportUserMessageV2({
    subscores,
    notAssessed,
    priorities,
    observations,
    flags: input.flags,
    faceShape: { primary: input.faceShape.primary, secondary: input.faceShape.secondary, nameTr: shape.nameTr, descriptionTr: shape.descriptionTr },
    questionnaire,
    faceContoursEnabled: body.faceContoursEnabled,
    exerciseEligible: exerciseEligible(q),
    note: q.note ?? null,
    headCovering: q.headCovering,
    presentation: q.presentation,
    beardPreference: q.beardPreference,
    catalog: catalogForPrompt(catalog),
  });
}

/** Deneme kullanımlarını toplar (şema hataları, fırlatılan denemeler ve güvenlik tekrarı dahil). */
function usageAccumulator(extra?: ReportUsageCallback) {
  const total: CoachAiUsage = { attempts: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, estUsd: 0, servedModels: [] };
  const onUsage: ReportUsageCallback = (u: TokenUsage, info) => {
    total.attempts += 1;
    total.input += u.input;
    total.output += u.output;
    total.cacheRead += u.cacheRead;
    total.cacheWrite += u.cacheWrite5m + u.cacheWrite1h;
    total.estUsd = total.estUsd === null || info.estUsd === null ? null : Math.round((total.estUsd + info.estUsd) * 1e6) / 1e6;
    if (!total.servedModels.includes(info.model)) total.servedModels.push(info.model);
    extra?.(u, info);
  };
  return { total, onUsage };
}

/**
 * SPEC 9.7/9.9 akışı (engine spec §9.6): üret → uzunluk onarımı → şema (hata → 1 tekrar → fallback) → kurallar →
 * güvenlik (ihlal → uyarıyla 1 tekrar → öğeyi çıkar → summary ihlalliyse fallback). Tekrarlar yalnız son tarihe en az
 * COACH.minRemainingForRetryMs kaldıysa yapılır. Her denemenin kullanımı toplanır ve döndürülür.
 */
export async function generateCoachReport(input: ReportInput, provider: ReportProvider = getReportProvider(), opts: GenerateOptions = {}): Promise<GeneratedReport> {
  const now = opts.now ?? Date.now;
  const deadlineAt = opts.deadlineAt ?? now() + COACH.deadlineMs;
  const q = input.questionnaire;
  const ctx = deriveContext(q);
  const body = bodyRules({ bmi: ctx.bmi, note: q.note });
  const catalog = allowedCatalog({ faceShape: input.faceShape.primary, questionnaire: q, body });
  const system = buildReportSystemPromptV2({ faceContoursEnabled: body.faceContoursEnabled, exerciseEligible: exerciseEligible(q) });
  const user = buildReportPromptInput(input, catalog, body);
  const acc = usageAccumulator(opts.onUsage);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(DEADLINE_ABORT_REASON), Math.max(0, deadlineAt - now()));
  const remaining = () => deadlineAt - now();
  const canRetry = () => remaining() >= COACH.minRemainingForRetryMs;
  const call = (sys: string) =>
    provider.generateReport(sys, user, controller.signal, { timeoutMs: Math.min(COACH.attemptTimeoutMs, remaining() - 5_000), onUsage: acc.onUsage });

  const tokens = () =>
    acc.total.attempts === 0
      ? { inputTokens: null, outputTokens: null }
      : { inputTokens: acc.total.input + acc.total.cacheRead + acc.total.cacheWrite, outputTokens: acc.total.output };
  const fallback = (flags: SafetyRule[]): GeneratedReport => ({
    report: buildFallbackReport({ overall: input.overall, potential: input.potential, faceShape: input.faceShape.primary, questionnaire: q, catalog, body, flags: input.flags, gains: input.gains }),
    isFallback: true,
    safetyFlags: flags,
    model: provider.model,
    promptVersion: REPORT_PROMPT_VERSION,
    ...tokens(),
    aiUsage: acc.total,
  });

  try {
    // 1) Şema: en çok 2 deneme (ikincisi yalnız süre yetiyorsa)
    let parsed: CoachReport | null = null;
    for (let attempt = 0; attempt < 2 && !parsed; attempt++) {
      if (attempt > 0 && !canRetry()) break;
      try {
        parsed = validate((await call(system)).report);
      } catch {
        // ağ/zaman aşımı/ret: kullanım sayıldı; süre yetiyorsa tekrar
      }
    }
    if (!parsed) return fallback([]);

    // 2) Güvenlik: ihlal → uyarıyla 1 tekrar → öğeyi çıkar → summary ihlalliyse fallback
    let report = enforceRules(parsed, q, body, catalog);
    let violations = scanReport(report, { faceContoursEnabled: body.faceContoursEnabled });
    const flags = new Set<SafetyRule>(violations.map((v) => v.rule));
    if (violations.length > 0) {
      if (canRetry()) {
        try {
          const candidateRaw = validate((await call(system + safetyRetryNote([...flags]))).report);
          if (candidateRaw) {
            const candidate = enforceRules(candidateRaw, q, body, catalog);
            const v2 = scanReport(candidate, { faceContoursEnabled: body.faceContoursEnabled });
            if (v2.length <= violations.length) {
              report = candidate;
              violations = v2;
            }
          }
        } catch {
          // tekrar başarısız; öğe çıkarma ile devam
        }
      }
      if (violations.length > 0) {
        violations.forEach((v) => flags.add(v.rule));
        const stripped = stripViolations(report, violations);
        if (!stripped) return fallback([...flags]);
        report = stripped;
        if (scanReport(report, { faceContoursEnabled: body.faceContoursEnabled }).length > 0) return fallback([...flags]);
      }
    }

    return { report, isFallback: false, safetyFlags: [...flags], model: provider.model, promptVersion: REPORT_PROMPT_VERSION, ...tokens(), aiUsage: acc.total };
  } finally {
    clearTimeout(timer);
  }
}
