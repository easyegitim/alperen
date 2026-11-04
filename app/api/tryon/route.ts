import messages from "@/messages/tr.json";
import { TRYON_PROMPT_VERSION_V2, buildTryonPromptV2, describeExpectation, type TryonPromptInputV2 } from "@/lib/ai/prompts/tryon.v2";
import { TRYON_GENERATE_TIMEOUT_MS, getTryonProvider } from "@/lib/ai/tryonProvider";
import { QC_TIMEOUT_MS, getQcProvider } from "@/lib/ai/tryonQc";
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
/** Üretim (≤ 50 sn) + kalite kontrolü + en çok 2 yeniden üretim; toplam süre route son tarihiyle sınırlanır. */
export const maxDuration = 120;
/** Son tarihten bu kadar önce sağlayıcı çağrıları iptal edilir ve satır failed yazılır (Vercel fonksiyonu öldürmeden). */
const DEADLINE_MARGIN_MS = 5_000;
/** Yeniden üretim ancak en kötü durumda da (üretim + kontrol) son tarihten önce bitecekse başlar: 120 − 50 − 25 − 5 = 40 sn. */
const REGEN_BUDGET_MS = maxDuration * 1000 - TRYON_GENERATE_TIMEOUT_MS - QC_TIMEOUT_MS - DEADLINE_MARGIN_MS;

/**
 * SPEC 14 / 10.3 + CONTRACTS_V2 S2.6: POST /api/tryon v2 { clientRequestId, analysisId?, mode, presets | presetId (eski), image, mask?, planStepIds?, layers? }
 * → TryonResultV2. Premium; 18+; tryon_generation + cross_border_transfer; reserve_tryon v2 (ağırlık). Claude kalite
 * kontrolü: geçmeyen görsel gösterilmez, qc_failed = hak iade (Ç10); kontrol yapılamazsa da gösterilmez (failed = hak iade).
 * Glow-up yalnız analizin plan_v2 adımlarından (plan yoksa BAD_INPUT plan_required). Sunucu hiçbir görseli yazmaz/loglamaz.
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

    // analysisId: yalnız kullanıcının tamamlanmış analizi (FK 500'ü ve başka kullanıcının analizine referansı önler).
    if (input.analysisId) {
      const own = await admin.from("analyses").select("id").eq("id", input.analysisId).eq("user_id", user.id).eq("status", "completed").maybeSingle();
      if (!own.data?.id) throw new ApiError("BAD_INPUT", "Tamamlanmış analiz bulunamadı.");
    }

    // Glow-up: parçalar YALNIZ plandan gelir (KB §7.2, Ç9); kullanıcı yalnız katman seçer. Doktor katmanı asla (selectGlowUpSteps).
    let presets: TryonPresets = input.presets;
    let appliedStepIds: string[] = [];
    let skinStepIds: string[] = [];
    if (input.mode === "glow_up") {
      const steps = await loadGlowUpSteps(admin, user.id, input.analysisId as string);
      if (!steps) throw new ApiError("BAD_INPUT", "plan_required");
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
    let weight = cfg.weights[input.mode];
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
      weight = 1;
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

    /**
     * Satır güncelleme; hak iadesi her ortamda korunur: 0014 öncesi yeni sütunlar yoksa yalnız status yazılır; status da
     * (ör. qc_failed, 0001 check kısıtı) yazılamazsa failed yazılır (kota saymaz). DB hatası yutulmaz, kodu loglanır.
     */
    const update = async (patch: Record<string, unknown>) => {
      const r = await admin.from("tryon_events").update(patch).eq("id", reservedId);
      if (!r.error) return;
      console.warn(`[tryon] tryon_events güncellenemedi (${r.error.code ?? "?"}); yalnız durum yazılıyor`);
      if (!("status" in patch)) return;
      const r2 = Object.keys(patch).length > 1 ? await admin.from("tryon_events").update({ status: patch.status }).eq("id", reservedId) : r;
      if (!r2.error || patch.status === "failed") return;
      console.warn(`[tryon] status=${String(patch.status)} yazılamadı (${r2.error.code ?? "?"}); failed yazılıyor (0014 öncesi, hak iade)`);
      const r3 = await admin.from("tryon_events").update({ status: "failed" }).eq("id", reservedId);
      if (r3.error) console.warn(`[tryon] status=failed de yazılamadı (${r3.error.code ?? "?"}); saat başı görev düzeltir`);
    };

    // Route son tarihi: sağlayıcı ve kontrol çağrıları iptal edilir; satır failed yazılır (bekleyen satır kotayı tutmasın).
    const controller = new AbortController();
    const deadline = setTimeout(() => controller.abort("deadline"), maxDuration * 1000 - DEADLINE_MARGIN_MS);
    let finalized = false;
    try {
      const out = await generateWithQc({
        generate: () => provider.generateTryOn({ imageBase64: input.image, maskBase64: input.mask ?? undefined, prompt, mode: input.mode, presets, signal: controller.signal }),
        qc,
        qcRequest: (r) => ({ originalBase64: input.image, originalMime: "image/jpeg", resultBase64: r.imageBase64, resultMime: r.mimeType, mode: input.mode, expectation }),
        maxRegen: cfg.qcMaxRegen,
        budgetMs: REGEN_BUDGET_MS,
        signal: controller.signal,
      });
      if (out.outcome === "qc_unavailable") {
        // Kontrol açık ama yapılamadı: kapı kapalı sayılır; görsel gitmez, hak iade (failed). Neden kodu ops için qc alanında.
        finalized = true;
        await update({ status: "failed", qc: { unavailable: true, reason: (out.qcReason ?? "unknown").slice(0, 40) }, regen_count: out.regenCount, plan_step_ids: appliedStepIds });
        throw new ApiError("AI_FAILED", "Kalite kontrolü yapılamadı; hakkın düşmedi. Tekrar dene.");
      }
      if (out.outcome === "qc_failed" || !out.result) {
        finalized = true;
        await update({ status: "qc_failed", qc: out.verdict, regen_count: out.regenCount, plan_step_ids: appliedStepIds }); // hak iade (Ç10)
        throw new ApiError("TRYON_QC_FAILED", messages.tryon.v2.qc.failedTitle);
      }
      finalized = true;
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
        layers: input.mode === "glow_up" ? [...input.layers] : [],
        weight,
        label: messages.common.aiGenerated,
      };
      return Response.json({ ...body, promptVersion: TRYON_PROMPT_VERSION_V2 });
    } catch (e) {
      if (!finalized) await update({ status: "failed" }); // kota iade
      throw e;
    } finally {
      clearTimeout(deadline);
    }
  },
);
