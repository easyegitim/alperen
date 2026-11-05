import { z } from "zod";
import { ApiError } from "@/lib/api/errors";
import { getConsentState, withGuard } from "@/lib/api/guard";
import { CONSENT_DOC } from "@/lib/consent";
import { createAdminClient } from "@/lib/db/admin";
import { sendEmail } from "@/lib/email/resend";
import { expertAnalysisSummary, partnerRequestEmail, type AnalysisSummary, type ExpertSummaryRow } from "@/lib/experts/email";
import { assertExpertNetworkEnabled } from "@/lib/experts/guard";
import { generateRefCode } from "@/lib/experts/refCode";
import { getLegalVersion } from "@/lib/legal/docs";

export const runtime = "nodejs";

const Input = z.object({
  partnerId: z.uuid(),
  name: z.string().trim().min(2).max(80),
  contact: z.string().trim().min(5).max(120), // telefon veya e-posta
  message: z.string().trim().max(600).optional(),
  shareAnalysisId: z.uuid().optional(),
});

/** SPEC 12.3 adım 3–4: referral_requests + partnere Resend e-postası. Günde 5. Fotoğraf asla. */
export const POST = withGuard({ schema: Input, requireAdult: true }, async ({ user, supabase, input }) => {
  assertExpertNetworkEnabled();
  const admin = createAdminClient();

  const since = new Date(Date.now() - 86_400_000).toISOString();
  const { count } = await admin.from("referral_requests").select("id", { count: "exact", head: true }).eq("user_id", user.id).gte("created_at", since);
  if ((count ?? 0) >= 5) throw new ApiError("RATE_LIMITED", "Günlük talep sınırına ulaştın.");

  const { data: partner } = await admin.from("partners").select("id, name, specialties, contact_email").eq("id", input.partnerId).eq("active", true).not("verified_at", "is", null).maybeSingle();
  if (!partner) throw new ApiError("BAD_INPUT", "Partner bulunamadı.");

  let summary: AnalysisSummary | null = null;
  if (input.shareAnalysisId) {
    const state = await getConsentState(supabase);
    const current = await getLegalVersion(CONSENT_DOC.expert_data_sharing);
    const c = state.expert_data_sharing;
    if (!c?.granted || c.textVersion !== current) throw new ApiError("CONSENT_REQUIRED", "Analiz özetini paylaşmak için expert_data_sharing rızası gerekli.");
    // engine_version ve signals ile okunur (değerlendirilmeyen alanı ayıklamak için); migration 0009 uygulanmamış
    // ortamda eski sütunlarla. Özet her satırda izin listesine göre kurulur (engine spec §8, F19).
    const base = "subscores, observations, status";
    const full = await admin.from("analyses").select(`${base}, engine_version, signals`).eq("id", input.shareAnalysisId).eq("user_id", user.id).maybeSingle();
    const missingColumn = full.error?.code === "42703" || full.error?.code === "PGRST204";
    const a = missingColumn ? (await admin.from("analyses").select(base).eq("id", input.shareAnalysisId).eq("user_id", user.id).maybeSingle()).data : full.data;
    if (!a || a.status !== "completed") throw new ApiError("BAD_INPUT", "Analiz bulunamadı.");
    summary = expertAnalysisSummary(a as ExpertSummaryRow);
  }

  const specialty = (partner.specialties as string[])[0] ?? "genel";
  let refCode = generateRefCode();
  let inserted: { id: string } | null = null;
  for (let i = 0; i < 3 && !inserted; i++) {
    const { data, error } = await admin
      .from("referral_requests")
      .insert({ user_id: user.id, partner_id: partner.id, ref_code: refCode, specialty, contact: input.contact, message: input.message ?? null, shared_analysis_id: input.shareAnalysisId ?? null })
      .select("id")
      .single();
    if (!error && data) inserted = { id: String(data.id) };
    else refCode = generateRefCode();
  }
  if (!inserted) throw new Error("referral insert failed");

  const mail = partnerRequestEmail({ partnerName: String(partner.name), refCode, specialty, contact: input.contact, name: input.name, message: input.message ?? null, summary });
  await sendEmail({ to: String(partner.contact_email), subject: mail.subject, html: mail.html }).catch(() => undefined);
  return Response.json({ requestId: inserted.id, refCode });
});
