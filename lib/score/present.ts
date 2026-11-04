// SPEC 14.1 teaser kırpması. Kilitli değerler JSON'a hiç girmez (null + locked:true).
// hybrid.v1 eklemeleri ve kilit kuralları: UI spec §1.2, engine spec §8.
import { SUB_KIND, SUB_KIND_HYBRID } from "@/lib/config/scoring";
import { SUB_KEYS_V2, type SubKey, type TeaserMode } from "@/lib/config/teaser";
import type { FaceShape, GeometryResult } from "@/lib/face/types";
import {
  ClientSignals,
  ClientSignalsV2,
  DeviceResult,
  ReportV3,
  type AnalysisFailure,
  type AnalysisStage,
  type AnalysisStatus,
  type CaptureHint,
  type EngineName,
  type ExplainItem,
  type ExplanationV2,
  type FaceShapeV2,
  type ImproveItem,
  type ImproveItemV2,
  type NotAssessed,
  type NotAssessedReason,
  type OverallV2,
  type PotentialV2,
  type ScoreRange,
  type ScoreV2,
  type SectionKey,
  type SubKind,
} from "@/lib/score/contract";

/**
 * Kilit sözleşmesi: { value, locked:false } açık; { value:null, locked:true } kilitli yer tutucu (gerçek değerden
 * türemez); { value:null, locked:false } "yok / değerlendirilmedi / henüz hazır değil" (satılacak bir şey yok).
 */
export type Locked<T> = { value: T; locked: false } | { value: null; locked: true };

export type AnalysisRow = {
  id: string;
  /** 0010 öncesi satırlar yalnız processing/completed/failed taşır. */
  status: AnalysisStatus;
  created_at: string;
  face_shape: string | null;
  overall: number | null;
  potential: number | null;
  subscores: Partial<Record<SubKey, number>> | null;
  gains: unknown;
  observations: unknown;
  geometry: GeometryResult | null;
  calibration_version: string | null;
  /** Migration 0009 sütunları; eski select listelerinde yok (undefined = eski satır). */
  prompt_version?: string | null;
  engine_version?: string | null;
  /** SignalsV1 (server-only); yalnız ClientSignals kısmı ayrıştırılır, kendisi istemciye gönderilmez. */
  signals?: unknown;
};

export type ClientAnalysis = {
  id: string;
  status: AnalysisRow["status"];
  createdAt: string;
  faceShape: FaceShape | string | null;
  faceShapeDetail: GeometryResult["faceShape"] | null;
  overall: Locked<number | null>;
  potential: Locked<number | null>;
  subscores: Record<SubKey, Locked<number | null>>;
  metrics: Locked<GeometryResult["metrics"] | null>;
  observations: Locked<unknown>;
  calibrationVersion: string | null;
  /** Açık: engine_version === "hybrid.v1" ise "hybrid.v1", değilse "legacy". */
  engine: EngineName;
  /** Açık: hybrid satırda SUB_KIND_HYBRID (çene hattı "structural"), eski satırda SUB_KIND. */
  kinds: Record<SubKey, SubKind>;
  /** round1(max(0, potential − overall)); potansiyelle aynı kilit (premium). */
  potentialDelta: Locked<number | null>;
  /** Yalnız premium; eski satır → { value: null, locked: false }. */
  improveFirst: Locked<ImproveItem[] | null>;
  /** Kilit subscores[k]'yı izler; eski satır ve hariç tutulan alt skor → { value: null, locked: false }. */
  explain: Record<SubKey, Locked<ExplainItem[] | null>>;
  /** "excluded" herkese; "not_visible" yalnız alt skor açıksa. */
  notAssessed: NotAssessed[];
  /** lighting/pose her zaman; skin_visibility/retouch yalnız cilt açıksa. */
  captureHints: CaptureHint[];
};

export type ClientAnalysisSummary = {
  id: string;
  status: AnalysisRow["status"];
  createdAt: string;
  faceShape: string | null;
  overall: number | null;
  potential: number | null;
  calibrationVersion: string | null;
  engine: EngineName;
};

export function engineOf(a: Pick<AnalysisRow, "engine_version">): EngineName {
  return a.engine_version === "hybrid.v1" || a.engine_version === "hybrid.v2" ? a.engine_version : "legacy";
}

const round1 = (x: number) => Math.round(x * 10) / 10;

/** Hybrid satırda signals'ın istemci kısmı; eski satırda veya ayrıştırma hatasında null (türetilmiş alanlar varsayılana düşer). */
function readSignals(a: AnalysisRow, engine: EngineName): ClientSignals | null {
  if (engine !== "hybrid.v1") return null;
  const parsed = ClientSignals.safeParse(a.signals);
  if (parsed.success) return parsed.data;
  // Yalnız olay adı ve analiz kimliği; signals içeriği loglanmaz.
  console.warn(`[score] signals_parse_failed analysis=${a.id}`);
  return null;
}

export function toClientAnalysis(a: AnalysisRow, premium: boolean, mode: TeaserMode, teaserSub: SubKey): ClientAnalysis {
  const lock = <T,>(v: T, open: boolean): Locked<T> => (open ? { value: v, locked: false } : { value: null, locked: true });
  const openNull: Locked<null> = { value: null, locked: false };
  const showOverall = premium || mode === "overall_only";
  const subOpen = (k: SubKey) => premium || (mode === "shape_plus_one" && k === teaserSub);

  const engine = engineOf(a);
  const signals = readSignals(a, engine);
  // Hariç tutulan alt skorun değeri yoktur: kilitlenecek veya satılacak bir şey yok, herkese açık "–".
  const excluded = new Set<SubKey>(signals?.notAssessed.filter((n) => n.reason === "excluded").map((n) => n.sub) ?? []);

  const potentialDelta =
    a.potential != null && a.overall != null ? round1(Math.max(0, a.potential - a.overall)) : null;
  // v1 açıklamaları 6 anahtarlıdır; 7 anahtarlı sözlükte brows her zaman eksiktir (değerlendirilmedi).
  const explainV1: Partial<Record<SubKey, ExplainItem[]>> = signals?.explain ?? {};

  return {
    id: a.id,
    status: a.status,
    createdAt: a.created_at,
    faceShape: a.face_shape,
    faceShapeDetail: a.geometry?.faceShape ?? null,
    overall: lock(a.overall, showOverall),
    potential: lock(a.potential, premium),
    // v1 satırlarda brows yoktur: eksik alt skor "değerlendirilmedi" (null, kilitsiz); kilitli yer tutucu üretilmez.
    subscores: Object.fromEntries(
      SUB_KEYS_V2.map((k) => [k, excluded.has(k) || a.subscores?.[k] == null ? openNull : lock(a.subscores[k] ?? null, subOpen(k))]),
    ) as Record<SubKey, Locked<number | null>>,
    metrics: lock(a.geometry?.metrics ?? null, premium),
    observations: lock(a.observations, premium),
    calibrationVersion: a.calibration_version,
    engine,
    kinds: { ...(engine === "hybrid.v1" ? SUB_KIND_HYBRID : SUB_KIND) },
    potentialDelta: lock(potentialDelta, premium),
    // Sözleşme C9: değerlendirilmeyen alt skorun kaldıracı listelenmez (motor zaten yazmaz; burada savunma).
    improveFirst: signals
      ? lock(signals.improveFirst.filter((i) => !signals.notAssessed.some((n) => n.sub === i.sub)), premium)
      : openNull,
    explain: Object.fromEntries(
      SUB_KEYS_V2.map((k) => [k, !signals || excluded.has(k) || !explainV1[k] ? openNull : lock(explainV1[k] ?? null, subOpen(k))]),
    ) as Record<SubKey, Locked<ExplainItem[] | null>>,
    // "Değerlendirilmedi" + bilinen referans değeri kilitli değeri ele verir: not_visible yalnız açık alt skorda.
    notAssessed: signals?.notAssessed.filter((n) => n.reason === "excluded" || subOpen(n.sub)) ?? [],
    captureHints: signals?.captureHints.filter((h) => h === "lighting" || h === "pose" || subOpen("skin")) ?? [],
  };
}

/** Liste görünümü (GET /api/analyses): ücretsizde skorlar null. */
export function toClientSummary(a: AnalysisRow, premium: boolean): ClientAnalysisSummary {
  return {
    id: a.id,
    status: a.status,
    createdAt: a.created_at,
    faceShape: a.face_shape,
    overall: premium ? a.overall : null,
    potential: premium ? a.potential : null,
    calibrationVersion: a.calibration_version,
    engine: engineOf(a),
  };
}

// ─── hybrid.v2 sunumu (CONTRACTS_V2.md §3.4 kilit kuralları) ────────────────────────────────────────────────────────

/** Migration 0010 sütunları (ANALYSIS_ROW_COLUMNS_V2). runs ve ham değerler istemciye hiç gitmez. */
export type AnalysisRowV2 = AnalysisRow & {
  device_result?: unknown;
  score_range?: unknown;
  percentile?: number | string | null;
  sections_ready?: unknown;
  set_key?: string | null;
  /** coach_reports.report (prompt_version "report.v3"); rota ekler, satırda yoktur. */
  report?: unknown;
  /** profiles.face_shape_override; rota ekler. */
  face_shape_override?: string | null;
  failure?: AnalysisFailure | null;
};

/**
 * Erişim (rota hesaplar, present yalnız uygular):
 *  entitled: bu analiz için hak var (tek seferlik rapor satın alımı bu analize bağlı ya da analiz anında aktif abonelik).
 *  referralUnlock: 5 davet tamamlandı (FEATURE_REFERRAL_UNLOCK) → yalnız genel skor değeri (Ç12).
 *  percentile: FEATURE_PERCENTILE açık → genel skorda yüzdelik (Ç6); kapalıyken null.
 */
export type AccessV2 = { entitled: boolean; referralUnlock: boolean; percentile: boolean };

export type ClientAnalysisV2 = {
  id: string;
  engine: "hybrid.v2";
  stage: AnalysisStage;
  createdAt: string;
  calibrationVersion: string | null;
  /** Her zaman açık (P#12): cihaz oranları ve ön yüz şekli; geometriden türetilir, model çıktısı değildir. */
  device: DeviceResult | null;
  overall: Locked<OverallV2 | null>;
  subscores: Record<SubKey, Locked<ScoreV2 | null>>;
  potential: Locked<PotentialV2 | null>;
  explanations: Record<SubKey, Locked<ExplanationV2 | null>>;
  report: Locked<ReportV3 | null>;
  faceShape: FaceShapeV2 | null;
  improveFirst: Locked<ImproveItemV2[] | null>;
  /** Kart kart açılış: hazır bölümler (sıra = açılış sırası). Ödeme öncesi yalnız ["device"]. */
  sectionsReady: SectionKey[];
  /** ±bu kadar fark "değişim yok" (KB §4.2). */
  noiseBand: number;
  /** "excluded" herkese; "not_visible" yalnız açık sonuçta. */
  notAssessed: { sub: SubKey; reason: NotAssessedReason }[];
  captureHints: CaptureHint[];
  /** Güven notu için: kullanılan açı sayısı (fotoğraf yok). */
  viewsUsed: number;
  failure: AnalysisFailure | null;
};

export const NOISE_BAND_CLIENT = 0.3;

const LOCKED: { value: null; locked: true } = { value: null, locked: true };
const OPEN_NULL: { value: null; locked: false } = { value: null, locked: false };

/** Cihaz sonucu geometriden türetilir (tek kaynak, P§1 Claude notu). */
export function deviceResultFromGeometry(g: GeometryResult | null | undefined): DeviceResult | null {
  if (!g) return null;
  return {
    ratios: { canthalTiltDeg: g.metrics.canthalTiltDeg, jawRatio: g.metrics.jawRatio, fwhr: g.metrics.fwhr, thirds: g.metrics.thirds },
    faceShapePrelim: g.faceShape,
  };
}

export function stageOf(status: AnalysisStatus): AnalysisStage {
  return status === "processing" ? "running" : status;
}

type ScoreRanges = { overall?: ScoreRange; potential?: ScoreRange; subscores?: Partial<Record<SubKey, ScoreRange>> };

const isRange = (v: unknown): v is ScoreRange => Array.isArray(v) && v.length === 2 && v.every((n) => typeof n === "number" && Number.isFinite(n));

function readRanges(raw: unknown): ScoreRanges {
  if (!raw || typeof raw !== "object") return {};
  const r = raw as Record<string, unknown>;
  const subs: Partial<Record<SubKey, ScoreRange>> = {};
  const rs = r.subscores;
  if (rs && typeof rs === "object") {
    for (const k of SUB_KEYS_V2) {
      const v = (rs as Record<string, unknown>)[k];
      if (isRange(v)) subs[k] = v;
    }
  }
  return { overall: isRange(r.overall) ? r.overall : undefined, potential: isRange(r.potential) ? r.potential : undefined, subscores: subs };
}

function readSignalsV2(a: AnalysisRowV2): ClientSignalsV2 | null {
  const parsed = ClientSignalsV2.safeParse(a.signals);
  if (parsed.success) return parsed.data;
  if (a.signals != null) console.warn(`[score] signals_v2_parse_failed analysis=${a.id}`);
  return null;
}

function readSections(raw: unknown): SectionKey[] {
  if (!Array.isArray(raw)) return [];
  const allowed = new Set<string>(["device", "overall", "subscores", "potential", "faceShape", "explanations", "improveFirst", "report"]);
  return raw.filter((s): s is SectionKey => typeof s === "string" && allowed.has(s));
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v !== "" && Number.isFinite(Number(v)) ? Number(v) : null);

/**
 * hybrid.v2 kilit kuralları:
 *  - stage device_only (ve queued/running/failed): yalnız cihaz alanları açık; skor, alt skor, potansiyel, açıklama, rapor,
 *    öncelik listesi kilitli yer tutucu (sabit; gerçek değerden türemez).
 *  - entitled: her şey açık; hazır olmayan bölüm { value:null, locked:false } (sectionsReady ile açılır).
 *  - referralUnlock (entitled değil): yalnız overall.value; range ve percentile null; geri kalan kilitli.
 *  - "excluded" alt skor herkese { null, locked:false }; "not_visible" yalnız açık sonuçta listelenir.
 */
export function toClientAnalysisV2(a: AnalysisRowV2, access: AccessV2): ClientAnalysisV2 {
  const stage = stageOf(a.status);
  const signals = readSignalsV2(a);
  const ranges = readRanges(a.score_range);
  const device = DeviceResult.safeParse(a.device_result);
  const deviceResult = device.success ? device.data : deviceResultFromGeometry(a.geometry);
  const scored = stage === "completed";
  const open = scored && access.entitled;
  const excluded = new Set<SubKey>(signals?.notAssessed.filter((n) => n.reason === "excluded").map((n) => n.sub) ?? []);

  const overallValue = num(a.overall);
  let overall: Locked<OverallV2 | null>;
  if (open) {
    overall =
      overallValue == null
        ? OPEN_NULL
        : { value: { value: overallValue, range: ranges.overall ?? null, percentile: access.percentile ? num(a.percentile) : null }, locked: false };
  } else if (scored && access.referralUnlock && overallValue != null) {
    overall = { value: { value: overallValue, range: null, percentile: null }, locked: false };
  } else {
    overall = LOCKED;
  }

  const potentialValue = num(a.potential);
  const potential: Locked<PotentialV2 | null> =
    open && potentialValue != null && overallValue != null && ranges.potential
      ? { value: { value: potentialValue, range: ranges.potential, delta: round1(Math.max(0, potentialValue - overallValue)) }, locked: false }
      : open
        ? OPEN_NULL
        : LOCKED;

  const subscores = Object.fromEntries(
    SUB_KEYS_V2.map((k) => {
      if (excluded.has(k)) return [k, OPEN_NULL];
      if (!open) return [k, LOCKED];
      const v = num(a.subscores?.[k]);
      const r = ranges.subscores?.[k];
      return [k, v == null || !r ? OPEN_NULL : { value: { value: v, range: r }, locked: false }];
    }),
  ) as Record<SubKey, Locked<ScoreV2 | null>>;

  const explanations = Object.fromEntries(
    SUB_KEYS_V2.map((k) => {
      if (excluded.has(k)) return [k, OPEN_NULL];
      if (!open) return [k, LOCKED];
      const e = signals?.explanations[k];
      return [k, e ? { value: e, locked: false } : OPEN_NULL];
    }),
  ) as Record<SubKey, Locked<ExplanationV2 | null>>;

  const reportParsed = open ? ReportV3.safeParse(a.report) : null;
  const report: Locked<ReportV3 | null> = !open ? LOCKED : reportParsed?.success ? { value: reportParsed.data, locked: false } : OPEN_NULL;

  const override = a.face_shape_override && ["oval", "round", "square", "long", "heart", "diamond"].includes(a.face_shape_override) ? (a.face_shape_override as FaceShape) : undefined;
  const detailed = open ? (signals?.faceShapeDetailed ?? null) : null;
  const faceShape: FaceShapeV2 | null = deviceResult
    ? {
        prelim: deviceResult.faceShapePrelim,
        ...(detailed ? { detailed } : {}),
        agree: detailed ? detailed.shape === deviceResult.faceShapePrelim.primary : null,
        ...(override ? { override } : {}),
      }
    : null;

  return {
    id: a.id,
    engine: "hybrid.v2",
    stage,
    createdAt: a.created_at,
    calibrationVersion: a.calibration_version,
    device: deviceResult,
    overall,
    subscores,
    potential,
    explanations,
    report,
    faceShape,
    improveFirst: !open ? LOCKED : signals ? { value: signals.improveFirst.filter((i) => !excluded.has(i.sub)), locked: false } : OPEN_NULL,
    sectionsReady: open ? readSections(a.sections_ready) : deviceResult ? ["device"] : [],
    noiseBand: NOISE_BAND_CLIENT,
    notAssessed: signals?.notAssessed.filter((n) => n.reason === "excluded" || open) ?? [],
    captureHints: signals?.captureHints ?? [],
    viewsUsed: signals?.viewsUsed.length ?? 0,
    failure: stage === "failed" ? (a.failure ?? { code: "AI_FAILED", retryable: true }) : null,
  };
}
