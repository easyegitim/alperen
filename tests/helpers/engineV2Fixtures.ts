// hybrid.v2 motor testleri için sahte sağlayıcılar, depo ve cetvel çıktısı (ağ yok, ücretli çağrı yok, görsel yok).
import type { AuditOutput, AuditProvider, AuditResult } from "@/lib/ai/audit";
import { abortReason } from "@/lib/ai/anthropic";
import { SampleError } from "@/lib/ai/observeProvider";
import type { LabeledImage, ScoreSampleV2, ScoringProviderV2 } from "@/lib/ai/provider";
import type { ScoreOutputV2, SubAssessment } from "@/lib/ai/scoreSchema.v2";
import { ZERO_USAGE, type TokenUsage } from "@/lib/config/ai.server";
import { SUB_KEYS_V2, type SubKey } from "@/lib/config/teaser";
import { REGION_KEYS } from "@/lib/score/contract";
import type { AnalysisRepo, ReportRow } from "@/lib/score/engine/repo";
import type { CachedSetRow } from "@/lib/score/engine/setCache";

export const USAGE_V2: TokenUsage = { input: 5000, output: 2500, cacheRead: 3000, cacheWrite5m: 0, cacheWrite1h: 0 };

const RAISE: Record<SubKey, SubAssessment["raise"]> = {
  harmony: [{ stepId: "textured_crop", effect: "Üstte hacim yüz bölümlerini dengeler.", gain: 0 }],
  eyes: [{ stepId: "lv_brow_tidy", effect: "Düzenli kaş çizgisi göz bölgesini açar.", gain: 0 }],
  jawline: [{ stepId: "stubble_light", effect: "Hafif sakal çene hattını netleştirir.", gain: 0 }],
  skin: [
    { stepId: "st_spf", effect: "Ton eşitliği belirgin artar.", gain: 0.5 },
    { stepId: "st_moisturizer_light", effect: "Parlama azalır.", gain: 0.3 },
  ],
  hair: [{ stepId: "st_hair_conditioner", effect: "Uçlar daha düzenli durur.", gain: 0.4 }],
  grooming: [{ stepId: "st_lip_balm", effect: "Dudak yüzeyi düzelir.", gain: 0.3 }],
  brows: [{ stepId: "lv_brow_tidy", effect: "Çizgi dışı kıllar azalır.", gain: 0.3 }],
};

export function assessment(score: number, over: Partial<SubAssessment> = {}, sub: SubKey = "skin"): SubAssessment {
  return {
    score,
    confidence: "high",
    lookedAt: ["Alın ve yanak dokusu", "T bölgesi parlaması"],
    held: ["Düzenli doku"],
    lowered: ["T bölgesinde hafif parlama"],
    raise: RAISE[sub],
    ...over,
  };
}

/** Tipik profil: her alt skor 5,5 (çapa 3). */
export function scoreOutput(scores: Partial<Record<SubKey, number>> = {}, over: Partial<ScoreOutputV2> = {}): ScoreOutputV2 {
  return {
    photo: { faceCount: "one", viewsUsable: ["front", "profile_left"], lighting: "even", retouch: "none", skinVisibility: "clear" },
    subscores: Object.fromEntries(SUB_KEYS_V2.map((k) => [k, assessment(scores[k] ?? 5.5, {}, k)])) as ScoreOutputV2["subscores"],
    notAssessed: [],
    observations: { facialHair: "none_visible", oilyHair: false, photoCare: "casual", skinSurface: "Cilt yüzeyi dengeli, T bölgesinde hafif parlama.", other: ["Çekim özeni orta."] },
    faceShapeOpinion: { shape: "oval", secondary: null, reason: "Yan profilde çene yumuşak geçişli." },
    glassesDetected: false,
    headCoveringDetected: false,
    hairLossSignal: "not_visible",
    report: {
      letter: "En güçlü yanın cilt dokun. En büyük fırsat saç şekli. Plan bunlara göre hazırlandı.",
      regions: REGION_KEYS.map((key) => ({ key, strength: `${key} bölgesinde dengeli görünüm.`, seen: `${key} bölgesinde fotoğrafta belirgin bir ayrıntı yok.`, improvements: key === "skin" ? ["Matlaştırıcı nemlendirici dene."] : [] })),
      closing: "Değişim haftalar sürer; ışık ve açı sonucu etkiler. Tıbbi tavsiye değildir.",
    },
    seeProfessional: null,
    ...over,
  };
}

type Step = (signal: AbortSignal, call: number) => Promise<ScoreSampleV2>;

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new SampleError(abortReason(signal)));
    const t = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        reject(new SampleError(abortReason(signal)));
      },
      { once: true },
    );
  });
}

export const okRun =
  (out: ScoreOutputV2, ms = 5, extra: Partial<ScoreSampleV2> = {}): Step =>
  async (signal) => {
    await delay(ms, signal);
    return { out, model: "claude-opus-5-5", fallbackServed: false, usage: USAGE_V2, ...extra };
  };

export const failRun =
  (reason: ConstructorParameters<typeof SampleError>[0], ms = 5, extra: ConstructorParameters<typeof SampleError>[1] = {}): Step =>
  async (signal) => {
    await delay(ms, signal);
    throw new SampleError(reason, extra);
  };

/** Sıradaki çağrıya sıradaki adımı verir; adım bitince son adım tekrarlanır. */
export class FakeScoringV2 implements ScoringProviderV2 {
  readonly model = "claude-opus-5-5";
  calls = 0;
  readonly texts: string[] = [];
  readonly imageCounts: number[] = [];
  constructor(private readonly steps: Step[]) {}
  scoreOnce(images: readonly LabeledImage[], userText: string, signal: AbortSignal): Promise<ScoreSampleV2> {
    const i = this.calls++;
    this.texts.push(userText);
    this.imageCounts.push(images.length);
    return this.steps[Math.min(i, this.steps.length - 1)](signal, i);
  }
}

export class FakeAudit implements AuditProvider {
  readonly model = "claude-opus-5-5";
  calls = 0;
  lastItems: { path: string; text: string }[] = [];
  constructor(private readonly out: AuditOutput | null, private readonly reason = "schema") {}
  async audit(args: { items: readonly { path: string; text: string }[] }): Promise<AuditResult> {
    this.calls++;
    this.lastItems = [...args.items];
    return { out: this.out, usage: this.out ? { input: 800, output: 200, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0 } : ZERO_USAGE, usageByModel: [], model: this.model, estUsd: 0.01, fallbackServed: false, ...(this.out ? {} : { reason: this.reason }) };
  }
}

export class FakeRepo implements AnalysisRepo {
  readonly updates: { id: string; patch: Record<string, unknown> }[] = [];
  readonly reports: ReportRow[] = [];
  readonly sets = new Map<string, CachedSetRow>();
  failUpdates = false;
  async updateAnalysis(id: string, patch: Record<string, unknown>): Promise<void> {
    if (this.failUpdates) throw new Error("db down");
    this.updates.push({ id, patch: structuredClone(patch) });
  }
  async insertReport(row: ReportRow): Promise<void> {
    this.reports.push(structuredClone(row));
  }
  async lookupSet(setKey: string, nowIso: string): Promise<CachedSetRow | null> {
    const r = this.sets.get(setKey);
    return r && r.expires_at > nowIso ? r : null;
  }
  async storeSet(row: Pick<CachedSetRow, "set_key" | "user_id" | "scores" | "model" | "prompt_version" | "calibration_version">): Promise<void> {
    if (!this.sets.has(row.set_key)) this.sets.set(row.set_key, { ...structuredClone(row), created_at: "2026-11-04T10:00:00.000Z", expires_at: "2027-11-04T10:00:00.000Z" });
  }
  /** Satırın son hâli (yamaların birleşimi). */
  row(): Record<string, unknown> {
    return this.updates.reduce((acc, u) => ({ ...acc, ...u.patch }), {} as Record<string, unknown>);
  }
}

export const IMAGES: LabeledImage[] = [
  { view: "front", data: "AAAA" },
  { view: "profile_left", data: "BBBB" },
];
