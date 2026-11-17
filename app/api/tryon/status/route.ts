import { getConsentState, withGuard } from "@/lib/api/guard";
import { getPremiumStatus } from "@/lib/api/premium";
import { CONSENT_DOC } from "@/lib/consent";
import { createAdminClient } from "@/lib/db/admin";
import { getLegalVersion } from "@/lib/legal/docs";
import { tryonPresentation, tryonRecommended } from "@/lib/tryon/context";
import { loadTryonReport, resolveTryonAnalysisId } from "@/lib/tryon/context.server";
import { tryonUsage } from "@/lib/tryon/quota";
import { loadProfile } from "@/app/api/analyses/v2";

export const runtime = "nodejs";

/**
 * SPEC-MOBILE M5: GET /api/tryon/status → { premium, hasConsent, consentVersion, recommended, quota, presentation }.
 * Web /dene sayfasının sunucu tarafı veri toplamasının API karşılığı; görsel içermez.
 */
export const GET = withGuard({}, async ({ user, supabase }) => {
  const { premium } = await getPremiumStatus(supabase, user.id);
  const consentVersion = await getLegalVersion(CONSENT_DOC.tryon_generation);
  const state = await getConsentState(supabase);
  const c = state.tryon_generation;
  const hasConsent = Boolean(c?.granted && c.textVersion === consentVersion);
  if (!premium) return Response.json({ premium: false, hasConsent, consentVersion, recommended: [], quota: null, presentation: "unspecified" });

  const admin = createAdminClient();
  // Web /dene ile aynı kaynak: sunum profiles.presentation (v2), öneriler en son tamamlanan analizin plan_v2'si (+ v1 rapor).
  const [usage, profile, analysisId] = await Promise.all([tryonUsage(user.id), loadProfile(admin, user.id), resolveTryonAnalysisId(admin, user.id, null)]);
  const report = await loadTryonReport(admin, user.id, analysisId);
  return Response.json({
    premium: true,
    hasConsent,
    consentVersion,
    recommended: tryonRecommended(report?.plan_v2, report?.report),
    quota: { used: usage.used, limit: usage.limit, nextAt: usage.nextAt },
    presentation: tryonPresentation(profile),
  });
});
