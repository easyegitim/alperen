import { z } from "zod";
import { base64Bytes } from "@/lib/api/analysesInput";
import { ApiError } from "@/lib/api/errors";
import { withGuard } from "@/lib/api/guard";
import { getAiEnv } from "@/lib/config/ai.server";
import { REQUIRED_ANALYSIS_CONSENTS } from "@/lib/consent";
import { createAdminClient } from "@/lib/db/admin";
import { FRONT_MAX_BYTES, TOTAL_IMAGE_MAX_BYTES, VIEW_BY_KEY, VIEW_KEYS, checkViewSet } from "@/lib/face/views";
import { canConsumePurchaseFor } from "@/lib/billing/entitlement";
import { getAccessV2 } from "@/lib/billing/purchases";
import { JOB_STALE_MS, isJobStale } from "@/lib/score/engine/jobs";
import { prepareScoringV2 } from "@/lib/score/service";
import { isV2Row, loadRowById, presentV2, promoteAndStart, quotaWindow, validateImages } from "../../v2";

export const runtime = "nodejs";
/** İş bu çağrının içinde (after) koşar; Vercel Pro sınırı (PLAN_V2 3a). */
export const maxDuration = 300;

const b64Max = (bytes: number) => Math.ceil((bytes * 4) / 3) + 4;

/**
 * Yeniden çalıştırma gövdesi (retry-on-stale, KB P#22 notu): görseller saklanmadığı için istemci aynı seti yeniden
 * gönderir. Geometri satırdaki (ödeme öncesi) değerdir; cihaz oranları ve ön yüz şekli değişmez (Ç8).
 */
const RunInput = z
  .object({
    images: z.array(z.object({ view: z.enum(VIEW_KEYS), data: z.string().min(100).max(b64Max(FRONT_MAX_BYTES)) })).min(1).max(VIEW_KEYS.length),
    sourceHashes: z.array(z.string().regex(/^[0-9a-f]{64}$/)).max(VIEW_KEYS.length).optional(),
  })
  .superRefine((v, ctx) => {
    const set = checkViewSet(
      v.images.map((i) => i.view),
      "full",
    );
    if (!set.ok) ctx.addIssue({ code: "custom", message: `view_set_${set.reason}`, path: ["images"] });
    let total = 0;
    v.images.forEach((img, i) => {
      const bytes = base64Bytes(img.data);
      total += bytes;
      if (bytes > VIEW_BY_KEY[img.view].maxBytes) ctx.addIssue({ code: "custom", message: `image_too_large_${img.view}`, path: ["images", i, "data"] });
    });
    if (total > TOTAL_IMAGE_MAX_BYTES) ctx.addIssue({ code: "custom", message: "images_total_too_large", path: ["images"] });
    if (v.sourceHashes && v.sourceHashes.length !== v.images.length) ctx.addIssue({ code: "custom", message: "sourceHashes sayısı images ile aynı olmalı", path: ["sourceHashes"] });
  });

/**
 * POST /api/analyses/[id]/run { images[], sourceHashes? } → 202 ClientAnalysisV2.
 * Yalnız hybrid.v2 satırları:
 *  - device_only (ödeme sonrası görsel gönderimi; görseller sunucuda yoktur, çekim ekranı yeniden yollar): hak → kota
 *    (promote_analysis) → iş. clientRequestId gerekmez; satır kimliği yeter.
 *  - failed (retryable) ya da takılı (10 dk ilerleme yok) queued/running: kota yeniden sayılmaz (satır zaten sayıldı).
 * Hak her çağrıda yeniden kontrol edilir; zaten ilerleyen iş yeniden başlatılmaz; completed olduğu gibi döner.
 */
export const POST = withGuard({ schema: RunInput, requireAdult: true, requireConsents: REQUIRED_ANALYSIS_CONSENTS }, async ({ req, user, input }) => {
  if (getAiEnv().scoreEngine !== "hybrid.v2") throw new ApiError("FEATURE_DISABLED", "Bulunamadı.");
  const parts = new URL(req.url).pathname.split("/");
  const id = parts[parts.length - 2] ?? "";
  if (!z.uuid().safeParse(id).success) return notFound();
  const admin = createAdminClient();
  const row = await loadRowById(admin, user.id, id);
  if (!row || !isV2Row(row) || !row.geometry) return notFound();
  const access = await getAccessV2(admin, user.id, row.id);
  // Bağlanmamış satın alma yalnız device_only/queued/failed satıra bağlanarak kullanılır (promoteAndStart bağlar).
  if (!canConsumePurchaseFor(access, row.status)) throw new ApiError("PREMIUM_REQUIRED", "Tam analiz için ödeme gerekiyor.");
  if (row.status === "completed") return Response.json(await presentV2(admin, user.id, row, access));
  if (row.status !== "device_only" && row.status !== "failed" && !isJobStale(row, Date.now(), JOB_STALE_MS)) return Response.json(await presentV2(admin, user.id, row, access), { status: 202 });
  const geometry = prepareScoringV2(row.geometry).geometry;
  validateImages(input.images);
  const quota = await quotaWindow(admin, user.id, access.subscriptionActive);
  return promoteAndStart({ admin, userId: user.id, row, access, quota, images: input.images, sourceHashes: input.sourceHashes ?? null, geometry });
});

function notFound(): Response {
  return Response.json({ error: { code: "NOT_FOUND", message: "Analiz bulunamadı." } }, { status: 404 });
}
