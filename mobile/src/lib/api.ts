import type { AnalysisInputRaw, ImageItem } from "@/lib/api/analysesInput";
import type { ApiErrorBody } from "@/lib/api/errors";
import { isApiErrorBody } from "@/lib/api/errors";
import type { TryonInput, TryonInputV2Raw } from "@/lib/api/tryonInput";
import type { OfferResponse } from "@/lib/billing/offer";
import type { DoctorLayerState, PlanViewV2, StepCard } from "@/lib/coach/planTypes";
import type { BodyImageScreenQuestion, BodyImageScreenResult } from "@/lib/config/plan";
import type { FaceShape } from "@/lib/face/types";
import type { AgeBand } from "@/lib/onboarding/age";
import type { PRESENTATIONS } from "@/lib/questionnaire";
import type { QuestionnaireV2 } from "@/lib/questionnaireV2";
import type { AnalysisStage, FaceShapeKey } from "@/lib/score/contract";
import type { ClientAnalysis, ClientAnalysisSummary, ClientAnalysisV2 } from "@/lib/score/present";
import type { TryonResultV2 } from "@/lib/tryon/types";
import type { z } from "zod";
import { env } from "./env";

export class ApiClientError extends Error {
  readonly code: ApiErrorBody["error"]["code"] | "NETWORK";
  readonly status: number;
  readonly retryAt?: string;
  constructor(status: number, body: ApiErrorBody | null) {
    super(body?.error.message ?? "Ağ hatası");
    this.code = body?.error.code ?? "NETWORK";
    this.status = status;
    this.retryAt = body?.error.retryAt;
  }
}

export type TokenSource = () => Promise<string | null>;

/** Mobil API istemcisi: her isteğe Authorization: Bearer <access_token> (SPEC-MOBILE M2). Saf; fetch ve token enjekte edilir. */
export function createApiClient(getToken: TokenSource, fetchImpl: typeof fetch = fetch, baseUrl = env.apiUrl) {
  async function request<T>(method: "GET" | "POST" | "PATCH" | "DELETE", path: string, body?: unknown): Promise<T | null> {
    const token = await getToken();
    const headers: Record<string, string> = { accept: "application/json" };
    if (token) headers.authorization = `Bearer ${token}`;
    if (body !== undefined) headers["content-type"] = "application/json";
    const res = await fetchImpl(`${baseUrl}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    if (res.status === 204) return null;
    const data: unknown = await res.json().catch(() => null);
    if (!res.ok) throw new ApiClientError(res.status, isApiErrorBody(data) ? data : null);
    return data as T;
  }
  return {
    get: <T>(path: string) => request<T>("GET", path),
    post: <T>(path: string, body: unknown) => request<T>("POST", path, body),
    patch: <T>(path: string, body: unknown) => request<T>("PATCH", path, body),
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;

// ── v2 uç nokta sözleşmeleri (CONTRACTS_V2.md Sprint 3 S3.2). Sunucu rotaları: app/api/**. Yalnız tipler ve yollar;
// görsel yalnız analyses.run ve tryon.run gövdesinde (CLAUDE.md). Her fonksiyon ApiClientError fırlatır (kod + durum).

export type Presentation = (typeof PRESENTATIONS)[number];

/** GET /api/billing/status[?analysis=] (app/api/billing/status/route.ts). analysisEntitled yalnız UX; kilidi sunucu açar. */
export type BillingStatusDto = {
  premium: boolean;
  plan: string | null;
  periodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  status: string | null;
  analysisEntitled: boolean | null;
};

/** POST /api/billing/sync → sunucu RevenueCat'ten çeker; istemci sonucu gönderilmez (SPEC-MOBILE M6). */
export type BillingSyncDto = { premium: boolean; plan: string | null; periodEnd: string | null };

/** GET /api/referral; POST /api/referral { code } → 204 (davet kodu girişi = claim; ayrı /claim rotası yok). */
export type ReferralDto = { code: string; progress: { done: number; total: number; pending: number }; unlocked: boolean };

/** GET /api/tryon/status (SPEC-MOBILE M5). */
export type TryonStatusDto = {
  premium: boolean;
  hasConsent: boolean;
  consentVersion: string;
  recommended: string[];
  quota: { used: number; limit: number; nextAt: string | null } | null;
  presentation: Presentation;
};

/** POST /api/analyses/[id]/run gövdesi: ödeme sonrası set (ön + ≥1 profil); görseller yalnız bu istekte. */
export type AnalysisRunInput = { images: ImageItem[]; sourceHashes?: string[] };

/** POST /api/plan yanıtı; GET /api/plan/[analysisId] yalnız { view, hairLossSignal }. */
export type PlanDto = { view: PlanViewV2; created?: boolean; fallback?: boolean; hairLossSignal: unknown };

/** GET /api/doctor?analysisId= ; POST /api/doctor/screen { answers, analysisId? } (cevaplar saklanmaz). */
export type DoctorDto = { state: DoctorLayerState; steps: StepCard[]; disclosure: true; reviewedAt?: string | null };
export type DoctorScreenInput = { answers: Record<BodyImageScreenQuestion, boolean>; analysisId?: string };
export type DoctorScreenDto = { result: BodyImageScreenResult; retakeAt?: string };

export type FaceShapeOverride = z.infer<typeof FaceShapeKey> | null;

const q = (params: Record<string, string | undefined>) => {
  const s = Object.entries(params)
    .filter((e): e is [string, string] => typeof e[1] === "string" && e[1].length > 0)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
  return s ? `?${s}` : "";
};

/**
 * Tipli v2 istemcisi (T2; iki mobil iz de bunu kullanır, api.ts'e dokunmaz). Yollar web rotalarıyla birebir;
 * eski takma adlar (image, presetId) bir sürüm daha sunucuda kalır ama yeni ekranlar v2 gövdesini kullanır.
 */
export function createAuraApi(client: ApiClient) {
  return {
    onboarding: {
      /** { ageBand } → { isAdult, ageBand }; under_18 bandı FEATURE_UNDER_18 kapalıyken FEATURE_DISABLED ("yakında"). */
      age: (ageBand: AgeBand) => client.post<{ isAdult: boolean; ageBand: AgeBand }>("/api/onboarding/age", { ageBand }),
      /** profiles.presentation (tek kaynak); 204. */
      profile: (presentation: Presentation) => client.post<null>("/api/onboarding/profile", { presentation }),
      /** Rızalar + sunum sonrası onboarding_completed_at; 204. BAD_INPUT presentation_missing. */
      complete: () => client.post<null>("/api/onboarding/complete", {}),
    },
    analyses: {
      list: () => client.get<ClientAnalysisSummary[]>("/api/analyses"),
      /** Ödeme öncesi: görsel YOK; sunucu LLM çağırmaz, kota saymaz → 200 ClientAnalysisV2 (stage device_only). */
      deviceOnly: (input: { clientRequestId: string; geometry: AnalysisInputRaw["geometry"]; sourceHashes?: string[] }) =>
        client.post<ClientAnalysisV2>("/api/analyses", { ...input, mode: "device_only" }),
      /** Ödeme sonrası set: images[] (ön + ≥1 profil) → 202 queued; kota burada sayılır; failed/takılı iş yeniden başlar. */
      run: (id: string, input: AnalysisRunInput) => client.post<ClientAnalysisV2>(`/api/analyses/${id}/run`, input),
      /** Yoklama: stage + sectionsReady ile kart kart açılış; kilitli değer gelmez. */
      get: (id: string) => client.get<ClientAnalysisV2>(`/api/analyses/${id}`),
      /** Eski motor satırı (hybrid.v1/legacy) için v1 sunum; yalnız geçiş dönemi. */
      getLegacy: (id: string) => client.get<ClientAnalysis>(`/api/analyses/${id}`),
    },
    billing: {
      status: (analysisId?: string) => client.get<BillingStatusDto>(`/api/billing/status${q({ analysis: analysisId })}`),
      /** Süreli teklif sunucuda; sıfırlanmaz. prices yer tutucu olabilir (placeholder:true → satış yok). */
      offer: () => client.get<OfferResponse>("/api/billing/offer"),
      /** Mağaza satın alma/geri yükleme sonrası; sunucu RevenueCat'ten doğrular. RATE_LIMITED: dakikada 6. */
      sync: () => client.post<BillingSyncDto>("/api/billing/sync", {}),
    },
    questionnaire: {
      /** Anket v2 (skoru değiştirmez); 204. requireAdult. */
      submit: (input: QuestionnaireV2) => client.post<null>("/api/questionnaire", input),
    },
    plan: {
      /** Saklı plan; yoksa NOT_FOUND (404); hak yoksa PREMIUM_REQUIRED. */
      get: (analysisId: string) => client.get<PlanDto>(`/api/plan/${analysisId}`),
      /** İlk üretim ya da yeniden üretim (yalnız anket plandan yeniyse; aksi QUOTA_EXCEEDED). */
      create: (analysisId: string, regenerate = false) => client.post<PlanDto>("/api/plan", { analysisId, regenerate }),
    },
    doctor: {
      get: (analysisId: string) => client.get<DoctorDto>(`/api/doctor${q({ analysisId })}`),
      screen: (input: DoctorScreenInput) => client.post<DoctorScreenDto>("/api/doctor/screen", input),
    },
    me: {
      /** Yüz şekli düzeltmesi (Ç8 "Bence değil"); null kaldırır. */
      faceShape: (faceShape: FaceShapeOverride) => client.patch<{ override: FaceShape | null }>("/api/me/face-shape", { faceShape }),
    },
    tryon: {
      status: () => client.get<TryonStatusDto>("/api/tryon/status"),
      /** v2 gövde: presets{hair,beard,color} | mode glow_up + analysisId; görsel yalnız burada. QC geçmezse TRYON_QC_FAILED (hak düşmez). */
      run: (input: TryonInputV2Raw) => client.post<TryonResultV2>("/api/tryon", input),
      /** Eski tek stil gövdesi (presetId); sunucu bir sürüm daha kabul eder (M9). */
      runLegacy: (input: TryonInput) => client.post<TryonResultV2>("/api/tryon", input),
      /** Cihaz kompozitinde sapma → kota iadesi; 204. */
      drift: (eventId: string) => client.post<null>(`/api/tryon/${eventId}/drift`, {}),
      /** "Bozuk görünüyor" (yalnız kendi success satırı, idempotent); 204. */
      flag: (eventId: string) => client.post<null>(`/api/tryon/${eventId}/flag`, {}),
    },
    referral: {
      /** FEATURE_REFERRAL_UNLOCK kapalıyken FEATURE_DISABLED (404). */
      get: () => client.get<ReferralDto>("/api/referral"),
      /** Davet kodu girişi; 204. BAD_INPUT mesajı: unknown_code | self | already_claimed | cihaz doğrulama nedeni. */
      claim: (code: string) => client.post<null>("/api/referral", { code }),
    },
  };
}

export type AuraApi = ReturnType<typeof createAuraApi>;

/** Yoklama: tamamlandı/başarısız → durur. Kart kart açılış için her yanıt onUpdate ile verilir (W7b RevealSequence). */
export const ANALYSIS_POLL = { intervalMs: 2500, maxIntervalMs: 6000, timeoutMs: 15 * 60_000 } as const;

export function isAnalysisSettled(stage: AnalysisStage): boolean {
  return stage === "completed" || stage === "failed";
}

/** Artan aralık: 2,5 sn → 6 sn (10 denemeden sonra). Saf; test edilebilir. */
export function nextPollDelayMs(attempt: number, cfg: { intervalMs: number; maxIntervalMs: number } = ANALYSIS_POLL): number {
  return Math.min(cfg.maxIntervalMs, cfg.intervalMs + attempt * 350);
}

export async function waitForAnalysis(
  api: Pick<AuraApi, "analyses">,
  id: string,
  opts: { onUpdate?: (a: ClientAnalysisV2) => void; signal?: AbortSignal; sleep?: (ms: number) => Promise<void>; timeoutMs?: number } = {},
): Promise<ClientAnalysisV2 | null> {
  const sleep = opts.sleep ?? ((ms) => new Promise<void>((r) => setTimeout(r, ms)));
  const deadline = Date.now() + (opts.timeoutMs ?? ANALYSIS_POLL.timeoutMs);
  let attempt = 0;
  while (!opts.signal?.aborted) {
    const a = await api.analyses.get(id);
    if (!a) return null;
    opts.onUpdate?.(a);
    if (isAnalysisSettled(a.stage)) return a;
    if (Date.now() >= deadline) return a;
    await sleep(nextPollDelayMs(attempt++));
  }
  return null;
}
