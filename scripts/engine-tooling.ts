/**
 * hybrid.v1 araç betiklerinin ortak, saf yardımcıları (engine spec §12 SPEC 8.6/8.8, §13 iz F).
 * refit-engine.ts, compare-observers.ts ve fairness-report.ts kullanır; birim testi tests/unit/engineTooling.test.ts.
 *
 * Gizlilik: buradaki hiçbir fonksiyon görsel, landmark dizisi veya serbest metin almaz; yalnız sayı, enum ve boolean.
 * Motor modülleri (lib/config/engine.server.ts, lib/score/engine/*; iz C) çalışma anında yüklenir ve şekli doğrulanır;
 * motor dalı birleşmeden önce de betikler derlenir ve --help ağsız/anahtarsız çalışır. Birleşmeden sonra statik içe
 * aktarmaya çevrilebilir (açık madde).
 */
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { ObservationOutput, type Observation } from "../lib/ai/observationSchema";
import { SUB_KEYS, type SubKeyV1 } from "../lib/config/teaser";
import type { GeometryResult } from "../lib/face/types";

// ---------------------------------------------------------------------------------------------------------------------
// Çalıştırma

/** Dosya doğrudan çalıştırıldıysa true (test içe aktarınca false). */
export function isMain(metaUrl: string): boolean {
  const entry = process.argv[1];
  return entry !== undefined && metaUrl === pathToFileURL(entry).href;
}

export function argValue(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

// ---------------------------------------------------------------------------------------------------------------------
// İstatistik

export function mean(v: number[]): number {
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : NaN;
}

export function sd(v: number[]): number {
  if (v.length < 2) return 0;
  const m = mean(v);
  return Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / (v.length - 1));
}

/** Doğrusal ara değerli kuantil (p ∈ [0,1]). */
export function quantile(values: number[], p: number): number {
  if (!values.length) return NaN;
  const s = [...values].sort((a, b) => a - b);
  const pos = (s.length - 1) * Math.min(1, Math.max(0, p));
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}

/** Cohen κ (iki değerlendirici, nominal). Tek kategoride tam uyum → 1. */
export function cohenKappa(a: readonly string[], b: readonly string[]): number {
  const n = Math.min(a.length, b.length);
  if (n === 0) return NaN;
  let agree = 0;
  const ca = new Map<string, number>();
  const cb = new Map<string, number>();
  for (let i = 0; i < n; i++) {
    if (a[i] === b[i]) agree++;
    ca.set(a[i], (ca.get(a[i]) ?? 0) + 1);
    cb.set(b[i], (cb.get(b[i]) ?? 0) + 1);
  }
  const po = agree / n;
  let pe = 0;
  for (const [k, v] of ca) pe += (v / n) * ((cb.get(k) ?? 0) / n);
  return pe === 1 ? 1 : (po - pe) / (1 - pe);
}

export type GroupStat = { name: string; n: number; value: number };
export type GapResult = { dimension: string; groups: GroupStat[]; gap: number; limit: number; pass: boolean };

/**
 * Alt grup başına bir ölçütün (ortalama, oran, κ …) en büyük farkı. minN altındaki gruplar karşılaştırmaya girmez.
 * value(rows) grubun satırlarından tek sayı üretir.
 */
export function gapBy<T>(rows: T[], dimension: string, groupOf: (r: T) => string | undefined, value: (rows: T[]) => number, limit: number, minN = 3): GapResult {
  const by = new Map<string, T[]>();
  for (const r of rows) {
    const g = groupOf(r);
    if (g) by.set(g, [...(by.get(g) ?? []), r]);
  }
  const groups = [...by.entries()]
    .filter(([, v]) => v.length >= minN)
    .map(([name, v]) => ({ name, n: v.length, value: value(v) }))
    .filter((g) => Number.isFinite(g.value))
    .sort((a, b) => a.name.localeCompare(b.name, "tr"));
  const vals = groups.map((g) => g.value);
  const gap = vals.length > 1 ? Math.max(...vals) - Math.min(...vals) : 0;
  return { dimension, groups, gap, limit, pass: gap <= limit + 1e-9 };
}

/** SPEC 8.8 motor kapısı (engine spec §12): mutlak düzey değil, alt gruplar arası fark. */
export const ENGINE_FAIRNESS_GATE = {
  /** (a) Yapısal bileşen başına bant içi pay farkı, puan (yüzde). */
  componentShareGapPts: 10,
  /** (b) Alt skor ortalama farkı. */
  subMeanGap: 0.1,
  /** (c) Genel skor ortalama farkı (eski motorda FAIRNESS_MAX_GAP 0,5 sert sınırdır). */
  overallMeanGap: 0.15,
  /** (d) Alan başına κ farkı (iki değerlendiriciye karşı). */
  kappaGap: 0.1,
  /** (e) Çekim oranları farkı, puan. */
  captureRateGapPts: 5,
} as const;

/** SPEC 8.6 tekrar ölçütleri (engine spec §5.3). */
export const REPEAT_TARGETS = { samePhotoMaxDiff: 0.2, samePhotoShare: 0.95, fivePhotoMaxSd: 0.4, fivePhotoShare: 0.9 } as const;

// ---------------------------------------------------------------------------------------------------------------------
// Gözlem alanları

/** Gözlemin bütün enum/boolean alanları "grup.alan" yoluyla (κ ve değişim oranı için). */
export function flattenObservation(o: Observation): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [g, fields] of Object.entries(o)) {
    for (const [k, v] of Object.entries(fields)) out[`${g}.${k}`] = String(v);
  }
  return out;
}

/** Aynı fotoğrafın tekrar örneklerinde alan başına "en az bir örnek farklı" oranı (aynı foto değişim oranı). */
export function flipRates(perPhotoSamples: Observation[][]): Record<string, number> {
  const counts = new Map<string, { flips: number; n: number }>();
  for (const samples of perPhotoSamples) {
    if (samples.length < 2) continue;
    const flat = samples.map(flattenObservation);
    for (const key of Object.keys(flat[0])) {
      const vals = new Set(flat.map((f) => f[key]));
      const c = counts.get(key) ?? { flips: 0, n: 0 };
      c.n += 1;
      if (vals.size > 1) c.flips += 1;
      counts.set(key, c);
    }
  }
  return Object.fromEntries([...counts.entries()].map(([k, c]) => [k, c.n ? c.flips / c.n : NaN]));
}

/** İki gözlem dizisi arasında alan başına κ (aynı sırayla aynı fotoğraflar). */
export function fieldKappas(a: Observation[], b: Observation[]): Record<string, number> {
  const fa = a.map(flattenObservation);
  const fb = b.map(flattenObservation);
  if (!fa.length) return {};
  return Object.fromEntries(Object.keys(fa[0]).map((k) => [k, cohenKappa(fa.map((f) => f[k]), fb.map((f) => f[k]))]));
}

// ---------------------------------------------------------------------------------------------------------------------
// MOD_GAIN ile çevrimdışı yeniden puanlama (engine spec §5.3)

/**
 * Bakım alt skorları referans etrafında MOD_GAIN ile doğrusaldır (§4.1: sub = 5,5 + I + κ(D − I), D ve I ∝ MOD_GAIN).
 * Saklanan ham alt skorlar ve satır ağırlıklarıyla yeni g için genel skor; yapısal alt skorlar değişmez.
 */
export function rescoreAtModGain(raw: Record<SubKeyV1, number>, weights: Record<SubKeyV1, number>, g: number, current = 1, reference = 5.5): number {
  const scale = g / current;
  const mod = new Set<SubKeyV1>(["skin", "hair", "grooming"]);
  const overall = SUB_KEYS.reduce((s, k) => s + weights[k] * (mod.has(k) ? reference + scale * (raw[k] - reference) : raw[k]), 0);
  return Math.round(Math.min(9.8, Math.max(1, overall)) * 10) / 10;
}

// ---------------------------------------------------------------------------------------------------------------------
// Bant yeniden uydurma (engine spec §3.5, §12; yalnız genişletir)

export type Band = { kind: "twoSided"; c: number; h: number; r: number } | { kind: "oneSided"; h: number; r: number };

/** Sıfır-ceza bölgesi [lo, hi]. */
export function zone(b: Band): { lo: number; hi: number } {
  return b.kind === "twoSided" ? { lo: b.c - b.h, hi: b.c + b.h } : { lo: -Infinity, hi: b.h };
}

export function inBand(v: number, b: Band): boolean {
  const z = zone(b);
  return v >= z.lo - 1e-12 && v <= z.hi + 1e-12;
}

export function inBandShare(values: number[], b: Band): number {
  return values.length ? values.filter((v) => inBand(v, b)).length / values.length : NaN;
}

/**
 * Bir bileşenin önerilen bandı: her alt grubun merkez (lo..hi kuantil) aralığının birleşimi, önsel bandla birleştirilir.
 * Önsel bandın altına asla daralmaz; rampa (r) değişmez. Yetersiz örnekte önsel aynen kalır.
 */
export function widenBand(prior: Band, valuesByGroup: Map<string, number[]>, opts: { lo?: number; hi?: number; minN?: number } = {}): { band: Band; changed: boolean; insufficient: boolean } {
  const lo = opts.lo ?? 0.025;
  const hi = opts.hi ?? 0.975;
  const minN = opts.minN ?? 20;
  const groups = [...valuesByGroup.values()].filter((v) => v.length >= minN);
  if (!groups.length) return { band: prior, changed: false, insufficient: true };
  const r6 = (x: number) => Math.round(x * 1e6) / 1e6;
  if (prior.kind === "oneSided") {
    const h = Math.max(prior.h, ...groups.map((v) => quantile(v, hi)));
    return { band: { ...prior, h: r6(h) }, changed: h > prior.h + 1e-12, insufficient: false };
  }
  const z = zone(prior);
  const newLo = Math.min(z.lo, ...groups.map((v) => quantile(v, lo)));
  const newHi = Math.max(z.hi, ...groups.map((v) => quantile(v, hi)));
  const band: Band = { kind: "twoSided", c: r6((newLo + newHi) / 2), h: r6((newHi - newLo) / 2), r: prior.r };
  return { band, changed: newLo < z.lo - 1e-12 || newHi > z.hi + 1e-12, insufficient: false };
}

/** Bir yeniden uydurma kabul edilebilir mi: hiçbir alt grubun bant içi payı düşmez ve bant önselin altına daralmaz. */
export function refitAcceptable(prior: Band, next: Band, valuesByGroup: Map<string, number[]>): { ok: boolean; reasons: string[] } {
  const reasons: string[] = [];
  const zp = zone(prior);
  const zn = zone(next);
  if (zn.lo > zp.lo + 1e-12 || zn.hi < zp.hi - 1e-12) reasons.push("narrows_prior_band");
  for (const [g, v] of valuesByGroup) {
    if (inBandShare(v, next) < inBandShare(v, prior) - 1e-12) reasons.push(`lowers_in_band_share:${g}`);
  }
  return { ok: reasons.length === 0, reasons };
}

// ---------------------------------------------------------------------------------------------------------------------
// Bileşen → metrik (engine spec §3.1, §3.5). Yalnız sayısal GeometryResult alanları.

/** Bileşenlerin okuduğu ölçüler (GeometryResult.metrics bunu karşılar; çevrimdışı kayıtta alanlar eksik olabilir). */
export type MetricsLike = {
  lowerToMiddle?: number;
  canthalTiltDeg?: number;
  jawRatio?: number;
  ipdRatio?: number | null;
  eyeMouthRatio?: number | null;
  symmetry?: { face: number; eyes: number; lower: number } | null;
};

export const COMPONENT_METRIC: Record<string, (m: MetricsLike) => number | null | undefined> = {
  symFace: (m) => m.symmetry?.face,
  vertical: (m) => m.lowerToMiddle,
  eyeMouth: (m) => m.eyeMouthRatio,
  spacing: (m) => m.ipdRatio,
  symEyes: (m) => m.symmetry?.eyes,
  tilt: (m) => m.canthalTiltDeg,
  jawWidth: (m) => m.jawRatio,
  symLower: (m) => m.symmetry?.lower,
};

/**
 * Girdi gizlilik koruması: kayıt landmark dizisi, görsel (base64 JPEG) veya uzun sayı dizisi taşıyorsa reddedilir.
 * Betiklere yalnız sayılar, enumlar ve insan etiketleri girer.
 */
export function assertNumbersOnly(value: unknown, at = "$"): void {
  if (typeof value === "string") {
    if (value.startsWith("/9j/") || value.startsWith("data:image") || value.length > 200) throw new Error(`${at}: görsel veya serbest metin kabul edilmez`);
    return;
  }
  if (Array.isArray(value)) {
    if (value.length > 64) throw new Error(`${at}: uzun dizi (landmark?) kabul edilmez`);
    value.forEach((v, i) => assertNumbersOnly(v, `${at}[${i}]`));
    return;
  }
  if (typeof value === "object" && value !== null) {
    for (const [k, v] of Object.entries(value)) {
      if (/landmark|image|photo_b64|base64/i.test(k)) throw new Error(`${at}.${k}: görsel/landmark alanı kabul edilmez`);
      assertNumbersOnly(v, `${at}.${k}`);
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Motorun çalışma anında yüklenmesi (iz C). Şekil doğrulanır; sözleşme C4 / engine spec §1.1.

export const BandSchema = z.union([
  z.object({ kind: z.literal("twoSided"), c: z.number(), h: z.number(), r: z.number() }),
  z.object({ kind: z.literal("oneSided"), h: z.number(), r: z.number() }),
]);
const EngineConfigSchema = z.object({
  BANDS: z.record(z.string(), z.object({ sub: z.enum(["harmony", "eyes", "jawline"]), w: z.number(), band: BandSchema, gate: z.string() })),
  CATEGORY_DELTAS: z.record(z.string(), z.record(z.string(), z.number())),
  ITEM_FIELDS: z.record(z.string(), z.object({ sub: z.string(), group: z.string(), field: z.string() })),
  REF_CATEGORY: z.record(z.string(), z.string()),
  IMPUTE_DELTA: z.record(z.string(), z.number()),
  MOD_GAIN: z.number(),
  MISSING_PEN: z.literal(0),
});
export type EngineConfig = z.infer<typeof EngineConfigSchema>;

const SubRecord = z.object({ harmony: z.number(), eyes: z.number(), jawline: z.number(), skin: z.number(), hair: z.number(), grooming: z.number() });
const VotedSchema = z.object({ final: ObservationOutput, agreement: z.number() });
const FromVotesSchema = z.object({
  overall: z.number(),
  potential: z.number(),
  rawRounded: SubRecord,
  subscores: SubRecord,
  weights: SubRecord,
  notAssessed: z.array(z.object({ sub: z.enum(["skin", "hair", "grooming"]), reason: z.enum(["excluded", "not_visible"]) })),
  components: z.array(z.object({ key: z.string(), sub: z.string(), pen: z.number(), gate: z.number(), status: z.enum(["measured", "not_measured"]) })),
});
export type FromVotes = z.infer<typeof FromVotesSchema>;
export type HybridContextInput = { headCovering: boolean; presentation: "male" | "female" | "unspecified"; beardPreference: "none" | "stubble" | "short" | "medium" | "long" | "any" };

export type EngineModule = {
  config: EngineConfig;
  aggregateObservations(samples: Observation[]): z.infer<typeof VotedSchema>;
  scoreFromVotes(geometry: GeometryResult, ctx: HybridContextInput, final: Observation): FromVotes;
  /** C4: scoreHybrid(imageBase64, geometry, ctx, provider?, opts?). Sonuç doğrulanmadan döner; çağıran ayrıştırır. */
  scoreHybrid(imageBase64: string, geometry: GeometryResult, ctx: HybridContextInput, provider: unknown): Promise<unknown>;
};

async function importOptional(rel: string): Promise<Record<string, unknown> | null> {
  try {
    const mod: unknown = await import(new URL(rel, import.meta.url).href);
    return typeof mod === "object" && mod !== null ? (mod as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

type Callable = (...args: unknown[]) => unknown;
const isCallable = (v: unknown): v is Callable => typeof v === "function";

function fn(mod: Record<string, unknown> | null, name: string): Callable | null {
  const f = mod?.[name];
  return isCallable(f) ? f : null;
}

/**
 * Motoru yükler. Yoksa veya şekli sözleşmeye uymuyorsa null döner; çağıran betik ücretli veya ücretsiz hiçbir işe
 * başlamadan çıkar. Fonksiyon çıktıları zod ile doğrulanır.
 */
export async function loadEngine(): Promise<EngineModule | null> {
  const [cfgMod, idxMod, aggMod] = await Promise.all([
    importOptional("../lib/config/engine.server.ts"),
    importOptional("../lib/score/engine/index.ts"),
    importOptional("../lib/score/engine/aggregate.ts"),
  ]);
  const cfg = EngineConfigSchema.safeParse(cfgMod);
  const agg = fn(aggMod, "aggregateObservations");
  const fromVotes = fn(idxMod, "scoreFromVotes");
  const hybrid = fn(idxMod, "scoreHybrid");
  if (!cfg.success || !agg || !fromVotes || !hybrid) return null;
  return {
    config: cfg.data,
    aggregateObservations: (samples) => VotedSchema.parse(agg(samples)),
    scoreFromVotes: (geometry, ctx, final) => FromVotesSchema.parse(fromVotes(geometry, ctx, final)),
    scoreHybrid: async (imageBase64, geometry, ctx, provider): Promise<unknown> => {
      const out: unknown = await hybrid(imageBase64, geometry, ctx, provider);
      return out;
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// SPEC 8.6 tekrar ölçütleri

/** Aynı fotoğrafın tekrar skorlarında tüm çiftlerden farkı ≤ maxDiff olanların payı. */
export function samePhotoShare(overallsPerPhoto: number[][], maxDiff: number = REPEAT_TARGETS.samePhotoMaxDiff): number {
  let ok = 0;
  let n = 0;
  for (const v of overallsPerPhoto) {
    for (let i = 0; i < v.length; i++) {
      for (let j = i + 1; j < v.length; j++) {
        n++;
        if (Math.abs(v[i] - v[j]) <= maxDiff + 1e-9) ok++;
      }
    }
  }
  return n ? ok / n : NaN;
}

/** Kişi başına (≥ 2 fotoğraf) genel skor SS'si ≤ maxSd olan kişilerin payı. */
export function fivePhotoShare(overallsPerPerson: number[][], maxSd: number = REPEAT_TARGETS.fivePhotoMaxSd): number {
  const people = overallsPerPerson.filter((v) => v.length >= 2);
  return people.length ? people.filter((v) => sd(v) <= maxSd + 1e-9).length / people.length : NaN;
}

/** CSV hücresi (yalnız sayı ve enum yazılır; yine de ayırıcı ve tırnak kaçışı yapılır). */
export function csvCell(v: string | number | boolean | null | undefined): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(header: string[], rows: (string | number | boolean | null | undefined)[][]): string {
  return [header.map(csvCell).join(","), ...rows.map((r) => r.map(csvCell).join(","))].join("\n") + "\n";
}

/** Değer alan bayrakları atlayarak ilk konumsal argüman. */
export function positional(args: string[], valueFlags: readonly string[]): string | undefined {
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (valueFlags.includes(a)) {
      i++;
      continue;
    }
    if (!a.startsWith("-")) return a;
  }
  return undefined;
}
