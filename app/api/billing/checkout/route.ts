import { z } from "zod";
import { ApiError } from "@/lib/api/errors";
import { withGuard } from "@/lib/api/guard";
import { getPremiumStatus } from "@/lib/api/premium";
import { renderContracts } from "@/lib/billing/contracts";
import { IyzicoError, iyzicoConfigured } from "@/lib/billing/iyzico";
import { effectivePriceTry } from "@/lib/billing/offer";
import { loadOrStartOffer } from "@/lib/billing/offerStore";
import { createPendingPurchase, hasPaidOneTimeFor, markPurchaseFailed } from "@/lib/billing/purchases";
import { initializeOneTimeCheckout, initializeSubscriptionCheckout } from "@/lib/billing/subscriptions";
import { APP_NAME, APP_URL } from "@/lib/config/app";
import { isFeatureEnabled } from "@/lib/config/flags";
import { PLANS, SUBSCRIPTION_PLAN_IDS } from "@/lib/config/plans";
import { createAdminClient } from "@/lib/db/admin";
import { getLegalVersion } from "@/lib/legal/docs";
import { isV2Row } from "@/app/api/analyses/v2";

export const runtime = "nodejs";

const Input = z
  .object({
    /** Abonelikler + week_pass (bayrak) + one_time_report (KB P#21: bir analizin tam sonucu ve raporu). */
    plan: z.enum([...SUBSCRIPTION_PLAN_IDS, "week_pass", "one_time_report"]),
    buyer: z.object({
      name: z.string().trim().min(2).max(60),
      surname: z.string().trim().min(2).max(60),
      gsmNumber: z.string().trim().regex(/^\+?[0-9]{10,15}$/),
      identityNumber: z.string().trim().regex(/^[0-9]{11}$/).optional(),
      city: z.string().trim().min(2).max(60),
      address: z.string().trim().min(10).max(300),
      zipCode: z.string().trim().max(10).optional(),
    }),
    accepted: z.object({ terms: z.literal(true), waiver: z.literal(true) }),
    /** Abonelikte: ödeme sonrası dönülecek analiz (yalnız yönlendirme). one_time_report'ta ZORUNLU: hak bu analize bağlanır. */
    analysisId: z.uuid().optional(),
  })
  .superRefine((v, ctx) => {
    if (v.plan === "one_time_report" && !v.analysisId) ctx.addIssue({ code: "custom", message: "Tek seferlik rapor için analysisId gerekli.", path: ["analysisId"] });
  });

/**
 * SPEC 14 / 15.2: POST /api/billing/checkout → { checkoutFormContent, token }.
 * Kalıcı hesap (anonim değil), 18+, aktif abonelik yok. İki onay consents'e yazılır. Kart bilgisi bize gelmez.
 * one_time_report: fiyat sunucudaki teklif durumuna göre (tanıtım/normal; yer tutucuysa satış yok), bekleyen purchases
 * satırı açılır; paid yalnız callback'te iyzico doğrulamasıyla yazılır.
 */
export const POST = withGuard({ schema: Input, allowAnonymous: false, requireAdult: true }, async ({ user, supabase, input }) => {
  if (input.plan === "week_pass" && !isFeatureEnabled("weekPass")) throw new ApiError("FEATURE_DISABLED", "Bu plan kapalı.");
  if (input.plan === "yearly" && !isFeatureEnabled("yearlyPlan")) throw new ApiError("FEATURE_DISABLED", "Bu plan kapalı.");
  // Sağlayıcı anahtarı yoksa onay, bekleyen satın alma veya abonelik satırı yazılmadan açık bir hata döner (500 değil).
  if (!iyzicoConfigured()) {
    console.warn("[billing] iyzico anahtarları tanımlı değil; ödeme başlatılamaz");
    throw new ApiError("AI_FAILED", "Ödeme sağlayıcısı yapılandırılmamış.");
  }
  const { premium } = await getPremiumStatus(supabase, user.id);
  if (premium) throw new ApiError("ALREADY_SUBSCRIBED", "Zaten aktif bir aboneliğin var.");
  const email = user.email;
  if (!email) throw new ApiError("ANONYMOUS_NOT_ALLOWED", "E-posta gerekli.");
  const admin = createAdminClient();

  // Tek seferlik rapor: analiz bu kullanıcıya ait ve hybrid.v2 satırı olmalı (eski legacy/hybrid.v1 satırını v1 sunumu
  // satın almayla açmaz; müşteri ödeyip kilitli kalırdı); aynı analiz ikinci kez satılmaz.
  let oneTime: { analysisId: string; priceTry: number; promo: boolean } | null = null;
  if (input.plan === "one_time_report") {
    const analysisId = input.analysisId as string;
    const { data: a } = await admin.from("analyses").select("id, status, engine_version").eq("id", analysisId).eq("user_id", user.id).maybeSingle();
    if (!a) throw new ApiError("BAD_INPUT", "Analiz bulunamadı.");
    if (!isV2Row({ status: String(a.status), engine_version: typeof a.engine_version === "string" ? a.engine_version : null })) throw new ApiError("BAD_INPUT", "Bu analiz tek seferlik raporla açılamaz; yeni bir çekim yap.");
    if (await hasPaidOneTimeFor(admin, user.id, analysisId)) throw new ApiError("ALREADY_SUBSCRIBED", "Bu analizin tam sonucu zaten açık.");
    const offer = await loadOrStartOffer(admin, user.id);
    const { priceTry, promo } = effectivePriceTry("one_time_report", offer);
    if (priceTry == null) throw new ApiError("FEATURE_DISABLED", "Bu ürünün fiyatı henüz belirlenmedi.");
    oneTime = { analysisId, priceTry, promo };
  }

  // SPEC 15.2 adım 4: iki zorunlu onay consents'e yazılır (metin sürümleriyle).
  const [saleV, infoV] = await Promise.all([getLegalVersion("mesafeli-satis"), getLegalVersion("on-bilgilendirme")]);
  const { error: cErr } = await supabase.from("consents").insert([
    { user_id: user.id, type: "distance_sales_terms", granted: true, text_version: saleV },
    { user_id: user.id, type: "instant_performance_waiver", granted: true, text_version: infoV },
  ]);
  if (cErr) throw new Error("consent insert failed");

  const conversationId = crypto.randomUUID();
  const callbackUrl = `${APP_URL}/api/billing/callback`;
  const buyer = { ...input.buyer, email };

  try {
    if (input.plan === "one_time_report") {
      if (!oneTime) throw new Error("one_time state missing");
      const purchaseId = await createPendingPurchase(admin, { userId: user.id, product: "one_time_report", provider: "iyzico" });
      let init: Awaited<ReturnType<typeof initializeOneTimeCheckout>>;
      try {
        init = await initializeOneTimeCheckout({
          buyer,
          userId: user.id,
          conversationId,
          callbackUrl,
          priceTry: oneTime.priceTry,
          name: `${APP_NAME} Tek Seferlik Rapor`,
          ip: "0.0.0.0",
          itemId: "one_time_report",
        });
        if (!init.checkoutFormContent || !init.token) throw new ApiError("AI_FAILED", "Ödeme formu alınamadı.");
      } catch (e) {
        // Form açılamadı: bekleyen satır sahipsiz kalmasın (hak yalnız paid satırdan; bu yalnız kayıt düzeni).
        await markPurchaseFailed(admin, purchaseId).catch(() => undefined);
        throw e;
      }
      await admin.from("payment_events").insert({
        provider: "iyzico",
        event_key: `checkout:${init.token}`,
        payload: { conversationId, plan: "one_time_report", userId: user.id, token: init.token, analysisId: oneTime.analysisId, purchaseId, promo: oneTime.promo, priceTry: oneTime.priceTry },
      });
      await renderContracts({ plan: "one_time_report", priceTry: oneTime.priceTry, buyerName: `${buyer.name} ${buyer.surname}`, buyerEmail: email, buyerAddress: `${buyer.address}, ${buyer.city}` });
      return Response.json({ checkoutFormContent: init.checkoutFormContent, token: init.token });
    }

    const init =
      input.plan === "week_pass"
        ? await initializeOneTimeCheckout({
            buyer,
            userId: user.id,
            conversationId,
            callbackUrl,
            priceTry: PLANS.week_pass.priceTry,
            name: `${APP_NAME} 7 Günlük Geçiş`,
            ip: "0.0.0.0",
          })
        : await initializeSubscriptionCheckout({ plan: input.plan, buyer, conversationId, callbackUrl });
    if (!init.checkoutFormContent || !init.token) throw new ApiError("AI_FAILED", "Ödeme formu alınamadı.");

    // Bekleyen satır: token conversationId ile eşleşir; premium YALNIZ iyzico doğrulamasıyla açılır.
    const { error } = await admin.from("subscriptions").upsert(
      { user_id: user.id, provider: "iyzico", plan: input.plan, status: "pending", provider_subscription_ref: null, cancel_at_period_end: false, updated_at: new Date().toISOString() },
      { onConflict: "user_id" },
    );
    if (error) throw new Error("pending subscription upsert failed");
    await admin.from("payment_events").insert({ provider: "iyzico", event_key: `checkout:${init.token}`, payload: { conversationId, plan: input.plan, userId: user.id, token: init.token, ...(input.analysisId ? { analysisId: input.analysisId } : {}) } });

    // Sözleşme + ön bilgilendirme kopyası (Resend) — e-posta gönderimi callback'te başarı sonrası yapılır; burada yalnız hazırlanır.
    await renderContracts({ plan: input.plan, buyerName: `${buyer.name} ${buyer.surname}`, buyerEmail: email, buyerAddress: `${buyer.address}, ${buyer.city}` });

    return Response.json({ checkoutFormContent: init.checkoutFormContent, token: init.token });
  } catch (e) {
    if (e instanceof IyzicoError) throw new ApiError("AI_FAILED", `Ödeme sağlayıcısı: ${e.message}`);
    throw e;
  }
});
