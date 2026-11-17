import { ApiError } from "@/lib/api/errors";
import { noContent, withGuard } from "@/lib/api/guard";
import { REQUIRED_ANALYSIS_CONSENTS } from "@/lib/consent";
import { createAdminClient } from "@/lib/db/admin";
import { readPresentation } from "@/lib/onboarding/presentation";

export const runtime = "nodejs";

/**
 * v2: anket ödeme sonrasına taşındığı için (KB R2-C13) onboarding, rızalar verilince biter. Sıra withGuard'da:
 * oturum → 18+ → üç zorunlu rıza; sonra cinsiyet seçimi (profiles.presentation) → onboarding_completed_at.
 * Tarayıcı bu sütunu yazamaz (RLS, SPEC 13.2); yalnız bu uç yazar.
 */
export const POST = withGuard({ requireAdult: true, requireConsents: REQUIRED_ANALYSIS_CONSENTS }, async ({ user }) => {
  const admin = createAdminClient();
  const presentation = await readPresentation(admin, user.id);
  if (!presentation) throw new ApiError("BAD_INPUT", "presentation_missing");
  const { data: profile } = await admin.from("profiles").select("onboarding_completed_at").eq("id", user.id).maybeSingle();
  const now = new Date().toISOString();
  const { error } = await admin
    .from("profiles")
    .update({ onboarding_completed_at: profile?.onboarding_completed_at ?? now, updated_at: now })
    .eq("id", user.id);
  if (error) throw new Error("profil güncellenemedi");
  return noContent();
});
