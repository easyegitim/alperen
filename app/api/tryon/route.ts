import messages from "@/messages/tr.json";
import { TRYON_PROMPT_VERSION_V2, buildTryonPromptV2, describeExpectation, type TryonPromptInputV2 } from "@/lib/ai/prompts/tryon.v2";
import { getTryonProvider } from "@/lib/ai/tryonProvider";
import { getQcProvider } from "@/lib/ai/tryonQc";
import { ApiError } from "@/lib/api/errors";
import { withGuard } from "@/lib/api/guard";
import { getPremiumStatus } from "@/lib/api/premium";
import { TRYON_IMAGE_MAX_BYTES, TryonInputV2, decodeJpegLimited } from "@/lib/api/tryonInput";
import { isFeatureEnabled } from "@/lib/config/flags";
import { ENTITLEMENTS } from "@/lib/config/plans";
import { getTryonConfig } from "@/lib/config/tryon";
import { createAdminClient } from "@/lib/db/admin";
import { isUnlimitedQuota } from "@/lib/api/quota";
import { effectiveLimit } from "@/lib/billing/entitlement";
import { legacyPresetId, resolvePresets, selectGlowUpSteps } from "@/lib/tryon/combo";
import { loadGlowUpSteps } from "@/lib/tryon/glowUpPlan.server";
import { generateWithQc } from "@/lib/tryon/pipeline.server";
import { tryonUsage } from "@/lib/tryon/quota";
import type { TryonPresets, TryonResultV2 } from "@/lib/tryon/types";

export const runtime = "nodejs";
/** Üretim (≤ 50 sn) + kalite kontrolü + en çok 2 yeniden üretim; toplam bütçe TOTAL_BUDGET_MS ile sınırlanır. */
export const maxDuration = 120;
const TOTAL_BUDGET_MS = 100_000;

/**
 * SPEC 14 / 10.3 + CONTRACTS_V2 S2.6: POST /api/tryon v2 { clientRequestId, analysisId?, mode, presets | presetId (eski), image, mask?, planStepIds?, layers? }
 * → TryonResultV2. Premium; 18+; tryon_generation + cross_border_transfer; reserve_tryon v2 (ağırlık). Claude kalite
 * kontrolü: geçmeyen görsel gösterilmez, qc_failed = hak iade (Ç10). Sunucu hiçbir görseli yazmaz/loglamaz.
 */
export const POST = withGuard(
  { schema: TryonInputV2, requireAdult: true, requireConsents: ["tryon_generation", "cross_border_transfer"] },
  async ({ user, supabase, input }) => {
    const { premium } = await getPremiumStatus(supabase, user.id);
    if (!premium) throw new ApiError("PREMIUM_REQUIRED", "Sanal deneme premiumda.");
    if (input.mode === "combo" && !isFeatureEnabled("tryonCombo")) throw new ApiError("FEATURE_DISABLED", "Kombin deneme kapalı.");
    if (input.mode === "glow_up" && !isFeatureEnabled("glowUp")) throw new ApiError("FEATURE_DISABLED", "İyileşmiş halin kapalı.");
    const decoded = decodeJpegLimited(input.image, TRYON_IMAGE_MAX_BYTES);
    if ("error" in decoded) throw new ApiError(decoded.error, decoded.error === "IMAGE_TOO_LARGE" ? "Görsel 1,5 MB'ı aşıyor." : "Görsel JPEG değil.");

    const cfg = getTryonConfig();
    const provider = getTryonProvider();
    const qc = getQcProvider(cfg);
    const admin = createAdminClient();

    // Glow-up: parçalar plandan (ya da katalogdan) gelir; kullanıcı yalnız katman seçer. Doktor katmanı asla (selectGlowUpSteps).
    let presets: TryonPresets = input.presets;
    let appliedStepIds: string[] = [];
    let skinStepIds: string[] = [];
    if (input.mode === "glow_up") {
      const { steps } = await loadGlowUpSteps(admin, user.id, input.analysisId as string);
      const sel = selectGlowUpSteps(steps, input.planStepIds, input.layers);
      presets = { ...(sel.hairPresetId ? { hair: sel.hairPresetId } : {}), ...(sel.beardPresetId ? { beard: sel.beardPresetId } : {}), ...(sel.colorPresetId ? { color: sel.colorPresetId } : {}) };
      appliedStepIds = sel.appliedStepIds;
      skinStepIds = sel.skinStepIds;
      if (appliedStepIds.length === 0) throw new ApiError("BAD_INPUT", "Bu analiz için uygulanacak plan adımı yok.");
    }
    const resolved = resolvePresets(presets);
    const promptInput: TryonPromptInputV2 = { mode: input.mode, presets: resolved, glowUp: input.mode === "glow_up" ? { layers: input.layers, skinStepIds } : undefined };
    const prompt = buildTryonPromptV2(promptInput);
    const expectation = describeExpectation(promptInput);

    const { windowDays, tryonsPerWindow } = ENTITLEMENTS.premium;
    const unlimited = await isUnlimitedQuota(admin, user.id);
    const limit = effectiveLimit(tryonsPerWindow, unlimited);
    const since = new Date(Date.now() - windowDays * 86_400_000).toISOString();
    const weight = cfg.weights[input.mode];
    let reserved = await admin.rpc("reserve_tryon", {
      p_user: user.id,
      p_client_request_id: input.clientRequestId,
      p_preset: legacyPresetId(presets),
      p_model: provider.model,
      p_limit: limit,
      p_since: since,
      p_mode: input.mode,
      p_presets: presets,
      p_weight: weight,
      p_analysis_id: input.analysisId,
    });
    if (reserved.error && /function|argument|parameter/i.test(reserved.error.message)) {
      // Migration 0014 bu ortamda henüz yok: eski 6 parametreli imza (mod/parça/ağırlık satıra yazılamaz, kota 1 sayılır).
      console.warn("[tryon] reserve_tryon v2 imzası yok; eski çağrıya düşüldü (0014 uygulanmamış)");
      reserved = await admin.rpc("reserve_tryon", { p_user: user.id, p_client_request_id: input.clientRequestId, p_preset: legacyPresetId(presets), p_model: provider.model, p_limit: limit, p_since: since });
    }
    if (reserved.error) throw new Error("reserve_tryon failed");
    const reservedId = reserved.data;
    if (!reservedId) {
      const u = await tryonUsage(user.id);
      throw new ApiError("QUOTA_EXCEEDED", "Bu haftaki deneme hakkın doldu.", u.nextAt ?? undefined);
    }
    const { data: existing } = await admin.from("tryon_events").select("status").eq("id", reservedId).single();
    if (existing && existing.status !== "pending") {
      // Aynı clientRequestId ile tekrar: görsel saklanmadığı için yeniden üretilemez; istemci yeni id ile dener.
      throw new ApiError("BAD_INPUT", "Bu istek daha önce işlendi; yeni bir deneme başlat.");
    }

    const update = async (patch: Record<string, unknown>) => {
      const r = await admin.from("tryon_events").update(patch).eq("id", reservedId);
      // 0014 öncesi ortamda yeni sütunlar yok: yalnız status yazılır (hak iadesi her durumda korunur).
      if (r.error && "status" in patch && Object.keys(patch).length > 1) await admin.from("tryon_events").update({ status: patch.status }).eq("id", reservedId);
    };

    try {
      const out = await generateWithQc({
        generate: () => provider.generateTryOn({ imageBase64: input.image, maskBase64: input.mask ?? undefined, prompt, mode: input.mode, presets }),
        qc,
        qcRequest: (r) => ({ originalBase64: input.image, originalMime: "image/jpeg", resultBase64: r.imageBase64, resultMime: r.mimeType, mode: input.mode, expectation }),
        maxRegen: cfg.qcMaxRegen,
        budgetMs: TOTAL_BUDGET_MS,
      });
      if (out.outcome === "qc_failed" || !out.result) {
        await update({ status: "qc_failed", qc: out.verdict, regen_count: out.regenCount, plan_step_ids: appliedStepIds }); // hak iade (Ç10)
        throw new ApiError("TRYON_QC_FAILED", messages.tryon.v2.qc.failedTitle);
      }
      await update({ status: "success", qc: out.verdict, regen_count: out.regenCount, plan_step_ids: appliedStepIds });
      const body: TryonResultV2 = {
        eventId: reservedId,
        mode: input.mode,
        presets,
        image: out.result.imageBase64,
        mimeType: out.result.mimeType,
        model: provider.model,
        qc: out.verdict,
        regenCount: out.regenCount,
        appliedStepIds,
        label: messages.common.aiGenerated,
      };
      return Response.json({ ...body, promptVersion: TRYON_PROMPT_VERSION_V2 });
    } catch (e) {
      if (!(e instanceof ApiError && e.code === "TRYON_QC_FAILED")) await update({ status: "failed" }); // kota iade
      throw e;
    }
  },
);
