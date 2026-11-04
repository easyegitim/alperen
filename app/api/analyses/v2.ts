import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { after } from "next/server";
import type { LabeledImage } from "@/lib/ai/provider";
import type { AnalysisInput, ImageItem } from "@/lib/api/analysesInput";
import { decodeImages } from "@/lib/api/analysesInput";
import { ApiError } from "@/lib/api/errors";
import { isUnlimitedQuota } from "@/lib/api/quota";
import { canConsumePurchaseFor, effectiveLimit } from "@/lib/billing/entitlement";
import type { AccessDetail } from "@/lib/billing/entitlement";
import { bindOneTimePurchase, getAccessV2 } from "@/lib/billing/purchases";
import { ENGINE_H2, SET_CACHE_SECRET_ENV } from "@/lib/config/engine.h2.server";
import { isFeatureEnabled } from "@/lib/config/flags";
import { ENTITLEMENTS } from "@/lib/config/plans";
import type { GeometryResult } from "@/lib/face/types";
import { checkServerCapture, withServerFaceShape } from "@/lib/score/engine/captureGate";
import { JOB_STALE_MS, isJobStale, runAnalysisJob } from "@/lib/score/engine/jobs";
import { createAnalysisRepo } from "@/lib/score/engine/repo";
import { deviceResultFromGeometry, toClientAnalysisV2, type AnalysisRowV2, type ClientAnalysisV2 } from "@/lib/score/present";
import { ANALYSIS_ROW_COLUMNS_V2, isMissingColumnError, selectAnalysisRows } from "@/lib/score/rowColumns";
import { analysisContextV2, prepareScoringV2 } from "@/lib/score/service";
import { computeSetKey } from "@/lib/score/setKey";

// hybrid.v2 rota yardımcıları (CONTRACTS_V2 §2.3; PLAN_V2 3a). Rota dosyaları ince kalır; burada: satır okuma, hak
// (AccessV2), kota (reserve/promote RPC), iş başlatma (after(): görseller yalnız bu çağrının belleğinde) ve sunum.
// Fotoğraf ve landmark hiçbir log veya sütuna yazılmaz.

type Admin = SupabaseClient;

export type RowV2 = AnalysisRowV2 & { client_request_id?: string };

export const V2_STATUSES = new Set(["device_only", "queued", "running"]);

/** Satır v2 sunumuyla mı gösterilir? Eski motor satırları (legacy, hybrid.v1) v1 sunumunda kalır. */
export function isV2Row(row: { engine_version?: string | null; status: string }): boolean {
  return row.engine_version === ENGINE_H2.version || V2_STATUSES.has(row.status);
}

/** 0010 sütunlarıyla okur; sütun yoksa (migration uygulanmamış) eski listeye düşer. */
export async function loadRow(admin: Admin, filter: (q: ReturnType<Admin["from"]>, cols: string) => PromiseLike<{ data: unknown; error: { code?: string } | null }>): Promise<RowV2 | null> {
  const full = await filter(admin.from("analyses"), `${ANALYSIS_ROW_COLUMNS_V2}, client_request_id`);
  if (!isMissingColumnError(full.error)) return (full.data as RowV2 | null) ?? null;
  const legacy = await selectAnalysisRows((cols) => filter(admin.from("analyses"), cols));
  return (legacy.data as RowV2 | null) ?? null;
}

export async function loadRowById(admin: Admin, userId: string, id: string): Promise<RowV2 | null> {
  return loadRow(admin, (q, cols) => q.select(cols).eq("id", id).eq("user_id", userId).maybeSingle());
}

export async function loadRowByRequest(admin: Admin, userId: string, clientRequestId: string): Promise<RowV2 | null> {
  return loadRow(admin, (q, cols) => q.select(cols).eq("user_id", userId).eq("client_request_id", clientRequestId).maybeSingle());
}

type ProfileV2 = { age_band?: string | null; presentation?: string | null; questionnaire?: unknown; face_shape_override?: string | null };

export async function loadProfile(admin: Admin, userId: string): Promise<ProfileV2 | null> {
  const full = await admin.from("profiles").select("age_band, presentation, questionnaire, face_shape_override").eq("id", userId).maybeSingle();
  if (!isMissingColumnError(full.error)) return (full.data as ProfileV2 | null) ?? null;
  const old = await admin.from("profiles").select("questionnaire").eq("id", userId).maybeSingle();
  return (old.data as ProfileV2 | null) ?? null;
}

/** En son v3 raporu (yalnız hak varken okunur; kilitli kullanıcı için hiç seçilmez). */
export async function loadReportV3(admin: Admin, userId: string, analysisId: string): Promise<unknown> {
  const { data } = await admin.from("coach_reports").select("report").eq("user_id", userId).eq("analysis_id", analysisId).eq("prompt_version", "report.v3").order("created_at", { ascending: false }).limit(1).maybeSingle();
  return data?.report ?? undefined;
}

export async function presentV2(admin: Admin, userId: string, row: RowV2, access: AccessDetail, profile?: ProfileV2 | null): Promise<ClientAnalysisV2> {
  const p = profile === undefined ? await loadProfile(admin, userId) : profile;
  const report = access.entitled && row.status === "completed" ? await loadReportV3(admin, userId, row.id) : undefined;
  const failure = row.status === "failed" ? readFailure(row.signals) : null;
  return toClientAnalysisV2({ ...row, report, face_shape_override: p?.face_shape_override ?? null, failure }, access);
}

function readFailure(signals: unknown): AnalysisRowV2["failure"] {
  if (typeof signals !== "object" || signals === null || !("failure" in signals)) return null;
  const f = (signals as { failure?: { code?: unknown; retryable?: unknown } }).failure;
  if (!f || typeof f.code !== "string") return null;
  const code = f.code;
  if (code !== "AI_FAILED" && code !== "AI_TIMEOUT" && code !== "AI_SAFETY_BLOCKED" && code !== "NO_FACE" && code !== "CAPTURE_QUALITY") return null;
  return { code, retryable: f.retryable !== false };
}

/** Ödeme öncesi cihaz alanları (herkese açık, P#12); yalnız boşsa yazılır (ön değerlendirme sessizce değişmez, Ç8). */
export function deviceColumns(geometry: GeometryResult, setKey: string | null) {
  return {
    geometry,
    face_shape: geometry.faceShape.primary,
    device_result: deviceResultFromGeometry(geometry),
    sections_ready: ["device"],
    engine_version: ENGINE_H2.version,
    ...(setKey ? { set_key: setKey } : {}),
  };
}

/** reserve_analysis / promote_analysis'in kotaya saydığı durumlar (0010). */
const QUOTA_STATUSES = ["queued", "running", "processing", "completed"] as const;

/**
 * Kota penceresi: abonelik → kayan pencere; tek seferlik → ödenmiş rapor sayısı kadar YENİ analiz. SQL fonksiyonları
 * kullanıcının tüm ücretli-yol satırlarını (eski ücretsiz v1, süresi dolmuş abonelik dönemi) saydığından, bir satın
 * almaya bağlı olmayan satırlar limite eklenir: kalan hak = ödenmiş − bağlı (tüketilmiş) satın alma.
 */
export async function quotaWindow(admin: Admin, userId: string, subscriptionActive: boolean): Promise<{ limit: number; since: string; retryAfterDays: number | null }> {
  const unlimited = await isUnlimitedQuota(admin, userId);
  if (subscriptionActive) {
    const w = ENTITLEMENTS.premium;
    return { limit: effectiveLimit(w.analysesPerWindow, unlimited), since: new Date(Date.now() - w.windowDays * 86_400_000).toISOString(), retryAfterDays: w.windowDays };
  }
  const { data: paidRows } = await admin.from("purchases").select("analysis_id").eq("user_id", userId).eq("status", "paid").eq("product", "one_time_report");
  const paid = paidRows ?? [];
  const boundIds = paid.map((p) => (p.analysis_id ? String(p.analysis_id) : null)).filter((id): id is string => id !== null);
  const { count: usedTotal } = await admin.from("analyses").select("id", { count: "exact", head: true }).eq("user_id", userId).in("status", [...QUOTA_STATUSES]);
  const { count: boundUsed } = boundIds.length
    ? await admin.from("analyses").select("id", { count: "exact", head: true }).eq("user_id", userId).in("status", [...QUOTA_STATUSES]).in("id", boundIds)
    : { count: 0 };
  const unboundRows = Math.max(0, (usedTotal ?? 0) - (boundUsed ?? 0));
  return { limit: effectiveLimit(Math.max(1, paid.length + unboundRows), unlimited), since: "-infinity", retryAfterDays: null };
}

export function toLabeled(images: readonly ImageItem[]): LabeledImage[] {
  return images.map((i) => ({ view: i.view, data: i.data }));
}

/** Görselleri doğrular (imza, görünüm ve toplam tavanlar); yalnız bellekte. */
export function validateImages(images: readonly ImageItem[]): void {
  const decoded = decodeImages(images);
  if ("error" in decoded) throw new ApiError(decoded.error, decoded.error === "IMAGE_TOO_LARGE" ? `Görsel tavanı aşıldı (${decoded.view}).` : `Görsel JPEG değil (${decoded.view}).`);
}

export type StartJobArgs = {
  admin: Admin;
  userId: string;
  row: RowV2;
  images: readonly ImageItem[];
  sourceHashes: readonly string[] | null;
  geometry: GeometryResult;
  access: AccessDetail;
};

/** İşi aynı çağrının içinde (after) başlatır: yanıt 202 döner, görseller bu invocation'ın belleğinde kalır. Hak çağıranda doğrulandı. */
export async function startJob(a: StartJobArgs): Promise<void> {
  const profile = await loadProfile(a.admin, a.userId);
  const context = analysisContextV2(profile);
  const repo = createAnalysisRepo(a.admin);
  const images = toLabeled(a.images);
  await repo.updateAnalysis(a.row.id, { status: "running", signals: { engine: "hybrid.v2", v: 2, progressAt: new Date().toISOString() } });
  after(async () => {
    await runAnalysisJob({ repo, analysisId: a.row.id, userId: a.userId, images, sourceHashes: a.sourceHashes, geometry: a.geometry, context });
  });
}

/** Ödeme sonrası POST (mode full): hak → kota (promote/reserve) → iş. Aynı clientRequestId ile tekrar çağrı idempotent. */
export async function handleFull(admin: Admin, userId: string, input: AnalysisInput): Promise<Response> {
  const prepared = prepareScoringV2(input.geometry);
  validateImages(input.images);
  const existing = await loadRowByRequest(admin, userId, input.clientRequestId);
  const access = await getAccessV2(admin, userId, existing?.id ?? null);
  // Hak: abonelik ya da bu satıra bağlı rapor; bağlanmamış satın alma yalnız yeni/başlamamış satıra bağlanarak (promoteAndStart).
  if (!canConsumePurchaseFor(access, existing?.status ?? "queued")) throw new ApiError("PREMIUM_REQUIRED", "Tam analiz için ödeme gerekiyor.");
  const q = await quotaWindow(admin, userId, access.subscriptionActive);

  const { data: reservedId, error: rpcError } = await admin.rpc("reserve_analysis", { p_user: userId, p_client_request_id: input.clientRequestId, p_limit: q.limit, p_since: q.since, p_status: "queued" });
  if (rpcError) throw new Error("reserve_analysis failed");
  if (!reservedId) throw quotaError(q.retryAfterDays);
  const row = await loadRowById(admin, userId, String(reservedId));
  if (!row) throw new Error("analysis row missing");
  return promoteAndStart({ admin, userId, row, access, quota: q, images: input.images, sourceHashes: input.sourceHashes, geometry: prepared.geometry });
}

export type PromoteArgs = {
  admin: Admin;
  userId: string;
  row: RowV2;
  access: AccessDetail;
  quota: Awaited<ReturnType<typeof quotaWindow>>;
  images: readonly ImageItem[];
  sourceHashes: readonly string[] | null;
  /** Sunucu yüz şekliyle hazırlanmış geometri; satırda geometri varsa o kullanılır (cihaz oranları ödeme sonrası değişmez, KB §4.2/7). */
  geometry: GeometryResult;
};

/**
 * device_only (ya da yeni queued) satırı kotaya sayar (promote_analysis) ve işi başlatır; 202. Tamamlanmış satır olduğu
 * gibi döner (idempotent). İlerleyen (takılı olmayan) iş yeniden başlatılmaz. Ortak yol: POST /api/analyses (full) ve
 * POST /api/analyses/[id]/run (ödeme sonrası yeniden gönderim; görseller sunucuda yok).
 */
export async function promoteAndStart(a: PromoteArgs): Promise<Response> {
  const { admin, userId } = a;
  let access = a.access;
  let row = a.row;
  if (row.status === "completed") return Response.json(await presentV2(admin, userId, row, access));
  // Bağlanmamış satın alma: işten ve kotadan ÖNCE bu satıra bağlanır (tüketilir); bağlanamazsa (yarış, tekil indeks) iş yok.
  if (!access.entitled) {
    if (!canConsumePurchaseFor(access, row.status) || !access.unconsumedOneTimeId) throw new ApiError("PREMIUM_REQUIRED", "Tam analiz için ödeme gerekiyor.");
    const bound = await bindOneTimePurchase(admin, access.unconsumedOneTimeId, row.id);
    if (!bound) throw new ApiError("PREMIUM_REQUIRED", "Tam analiz için ödeme gerekiyor.");
    access = { ...access, entitled: true, unconsumedOneTimeId: null };
  }
  if (row.status === "device_only" || row.status === "queued") {
    const { data: promoted, error: promoteError } = await admin.rpc("promote_analysis", { p_user: userId, p_analysis_id: row.id, p_limit: a.quota.limit, p_since: a.quota.since });
    if (promoteError) throw new Error("promote_analysis failed");
    if (promoted === false) throw quotaError(a.quota.retryAfterDays);
    row = (await loadRowById(admin, userId, row.id)) ?? row;
  }
  // Zaten çalışan ve ilerleyen iş: yeniden başlatılmaz (idempotent 202). Takılı (stale) ya da failed/queued → başlat.
  if (row.status === "running" && !isJobStale(row, Date.now(), JOB_STALE_MS)) return Response.json(await presentV2(admin, userId, row, access), { status: 202 });
  const setKey = computeSetKey(process.env[SET_CACHE_SECRET_ENV], a.sourceHashes);
  if (!row.device_result) await admin.from("analyses").update(deviceColumns(a.geometry, setKey)).eq("id", row.id);
  const geometry = row.geometry ?? a.geometry;
  await startJob({ admin, userId, row, images: a.images, sourceHashes: a.sourceHashes, geometry, access });
  const fresh = (await loadRowById(admin, userId, row.id)) ?? row;
  return Response.json(await presentV2(admin, userId, fresh, access), { status: 202 });
}

function quotaError(retryAfterDays: number | null): ApiError {
  const retryAt = retryAfterDays ? new Date(Date.now() + retryAfterDays * 86_400_000).toISOString() : undefined;
  return new ApiError("QUOTA_EXCEEDED", "Yeni analiz hakkın henüz açılmadı.", retryAt);
}

/**
 * Ödeme öncesi POST (mode device_only): kota sayılmaz, LLM yok, API anahtarı gerekmez; yalnız cihaz alanları (P§1).
 * Sunucu çekim kapısı yalnız "yüz yok" (PLAN 1d) → NO_FACE; yüz şekli sunucuda fs-v2 ile yeniden hesaplanır (tek kaynak).
 */
export async function handleDeviceOnly(admin: Admin, userId: string, input: AnalysisInput): Promise<Response> {
  const gate = checkServerCapture(input.geometry);
  if (!gate.ok) throw new ApiError("NO_FACE", "Fotoğrafta tek bir yüz bulunamadı; yeniden çek.");
  const geometry = withServerFaceShape(input.geometry, gate.faceShape);
  const { data: reservedId, error } = await admin.rpc("reserve_analysis", { p_user: userId, p_client_request_id: input.clientRequestId, p_limit: 1, p_since: "-infinity", p_status: "device_only" });
  if (error || !reservedId) throw new Error("reserve_analysis failed");
  const id = String(reservedId);
  const row = await loadRowById(admin, userId, id);
  if (!row) throw new Error("analysis row missing");
  const setKey = computeSetKey(process.env[SET_CACHE_SECRET_ENV], input.sourceHashes);
  if (!row.device_result) {
    const { error: upErr } = await admin.from("analyses").update(deviceColumns(geometry, setKey)).eq("id", id);
    if (upErr) throw new Error("analysis update failed");
    // Davet kilidi (KB Ç12, FEATURE_REFERRAL_UNLOCK): davet edilen ilk cihaz analizini yolladı → referrals.photo_submitted_at (bir kez).
    if (isFeatureEnabled("referralUnlock")) {
      await admin.from("referrals").update({ photo_submitted_at: new Date().toISOString() }).eq("referee_id", userId).is("photo_submitted_at", null);
    }
  }
  const fresh = (await loadRowById(admin, userId, id)) ?? row;
  const access = await getAccessV2(admin, userId, id);
  return Response.json(await presentV2(admin, userId, fresh, access));
}
