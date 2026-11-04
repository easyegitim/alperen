import { ApiError } from "@/lib/api/errors";
import { withGuard } from "@/lib/api/guard";
import { AnalysisInputSchema, decodeJpeg } from "@/lib/api/analysesInput";
import { getPremiumStatus } from "@/lib/api/premium";
import { isUnlimitedQuota } from "@/lib/api/quota";
import { effectiveLimit } from "@/lib/billing/entitlement";
import { ENTITLEMENTS } from "@/lib/config/plans";
import { getTeaserConfig } from "@/lib/config/teaser";
import { REQUIRED_ANALYSIS_CONSENTS } from "@/lib/consent";
import { createAdminClient } from "@/lib/db/admin";
import { toClientAnalysis, toClientSummary, type AnalysisRow } from "@/lib/score/present";
import { selectAnalysisRows } from "@/lib/score/rowColumns";
import { analysisContextFromQuestionnaire, prepareScoring, scoreAnalysis, type AiUsage } from "@/lib/score/service";

export const runtime = "nodejs";
// hybrid.v1: gözlem son tarihi 40 s (engine spec §2.5) + DB; legacy Gemini bütçesi de bunun içinde (engine spec §10).
export const maxDuration = 60;

/**
 * SPEC 14: POST /api/analyses { clientRequestId, geometry, image } → ClientAnalysis.
 * Sıra: oturum → Zod → 18+ → 3 rıza → JPEG imza/boyut → motor ön kontrolü (hybrid.v1: üretim koruması, sağlayıcı
 * anahtarı, sunucu çekim kapısı → CAPTURE_QUALITY; hak düşmez) → reserve_analysis (kota + idempotency) → skorlama → satır.
 * Görsel bellekte işlenir, AI sağlayıcısına iletilir, hiçbir yere yazılmaz/loglanmaz.
 */
export const POST = withGuard(
  { schema: AnalysisInputSchema, requireAdult: true, requireConsents: REQUIRED_ANALYSIS_CONSENTS },
  async ({ user, supabase, input }) => {
    // v2 gövdesi (images[]/mode) şemada kabul edilir (CONTRACTS_V2 §2); motor ve arka plan işi Faz 3'te (F07) bağlanır.
    // O zamana kadar yalnız eski tek selfie yolu çalışır; v2 isteği açık hata alır (sahte başarı yok).
    const front = input.images.find((i) => i.view === "front");
    if (!input.legacy || !front) throw new ApiError("BAD_INPUT", "Çoklu açı analizi henüz açık değil.");
    const decoded = decodeJpeg(front.data);
    if ("error" in decoded) {
      throw new ApiError(decoded.error, decoded.error === "IMAGE_TOO_LARGE" ? "Görsel 600 KB'ı aşıyor." : "Görsel JPEG değil.");
    }

    // Kota harcanmadan önce (engine spec §3.6, UI spec C13). legacy'de geometri aynen kalır.
    const prepared = prepareScoring(input.geometry);

    const admin = createAdminClient();
    const [{ premium }, unlimited] = await Promise.all([getPremiumStatus(supabase, user.id), isUnlimitedQuota(admin, user.id)]);
    const window = premium ? ENTITLEMENTS.premium : null;
    const limit = effectiveLimit(premium ? ENTITLEMENTS.premium.analysesPerWindow : ENTITLEMENTS.free.analysesLifetime, unlimited);
    const since = window ? new Date(Date.now() - window.windowDays * 86_400_000).toISOString() : "-infinity";

    const { data: reservedId, error: rpcError } = await admin.rpc("reserve_analysis", {
      p_user: user.id,
      p_client_request_id: input.clientRequestId,
      p_limit: limit,
      p_since: since,
    });
    if (rpcError) throw new Error("reserve_analysis failed");

    const teaser = getTeaserConfig();
    if (!reservedId) {
      let retryAt: string | undefined;
      if (window) {
        const { data: last } = await admin
          .from("analyses")
          .select("created_at")
          .eq("user_id", user.id)
          .in("status", ["processing", "completed"])
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (last) retryAt = new Date(new Date(String(last.created_at)).getTime() + window.windowDays * 86_400_000).toISOString();
      }
      throw new ApiError("QUOTA_EXCEEDED", premium ? "Yeni analiz hakkın henüz açılmadı." : "Ücretsiz analiz hakkın kullanıldı.", retryAt);
    }

    // Idempotency: aynı clientRequestId ile önceden tamamlanmış satır varsa onu döndür.
    const { data: existingRaw } = await selectAnalysisRows((cols) => admin.from("analyses").select(cols).eq("id", reservedId).single());
    const existing = existingRaw as AnalysisRow | null;
    if (existing && existing.status !== "processing") {
      return Response.json(toClientAnalysis(existing, premium, teaser.mode, teaser.subscore));
    }

    const { data: profile } = await admin.from("profiles").select("questionnaire").eq("id", user.id).maybeSingle();
    const ctx = analysisContextFromQuestionnaire(profile?.questionnaire);

    let aiUsage: AiUsage | null = null;
    try {
      const scored = await scoreAnalysis(front.data, prepared.geometry, ctx, {
        engine: prepared.engine,
        onUsage: (u) => {
          aiUsage = u;
        },
      });
      const update = {
        status: "completed",
        geometry: scored.geometry,
        face_shape: scored.geometry.faceShape.primary,
        subscores: scored.subscores,
        gains: scored.gains,
        observations: scored.observations,
        flags: scored.flags,
        raw_overall: scored.rawOverall,
        overall: scored.overall,
        potential: scored.potential,
        calibration_version: scored.calibrationVersion,
        scoring_model: scored.model,
        prompt_version: scored.promptVersion,
        // Motor sütunları (migration 0009) yalnız hybrid.v1 satırlarına yazılır; legacy güncellemesi değişmedi.
        ...(scored.engineVersion
          ? { engine_version: scored.engineVersion, signals: scored.signals, ai_usage: scored.aiUsage }
          : {}),
        completed_at: new Date().toISOString(),
      };
      // 0009 yoksa select hatası güncellemeyi de geri alır; eski listeyle aynı güncelleme yeniden denenir (idempotent).
      const { data: row, error } = await selectAnalysisRows((cols) => admin.from("analyses").update(update).eq("id", reservedId).select(cols).single());
      if (error || !row) throw new Error("analysis update failed");
      return Response.json(toClientAnalysis(row as AnalysisRow, premium, teaser.mode, teaser.subscore));
    } catch (e) {
      // Başarısız satır kotaya sayılmaz (reserve_analysis yalnız processing/completed sayar). hybrid.v1'de harcanan
      // token yine kaydedilir (engine spec §7.2: ai_usage hatada da yazılır).
      await admin
        .from("analyses")
        .update({ status: "failed", completed_at: new Date().toISOString(), ...(aiUsage ? { ai_usage: aiUsage } : {}) })
        .eq("id", reservedId);
      throw e;
    }
  },
);

/** GET /api/analyses → ClientAnalysisSummary[] (ücretsizde skorlar null). */
export const GET = withGuard({}, async ({ user, supabase }) => {
  const admin = createAdminClient();
  const { premium } = await getPremiumStatus(supabase, user.id);
  const { data } = await selectAnalysisRows((cols) =>
    admin.from("analyses").select(cols).eq("user_id", user.id).neq("status", "failed").order("created_at", { ascending: false }).limit(50),
  );
  return Response.json(((data as AnalysisRow[] | null) ?? []).map((r) => toClientSummary(r, premium)));
});
