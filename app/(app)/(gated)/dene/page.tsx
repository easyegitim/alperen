import { ScanFace, Scissors } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { z } from "zod";
import { LockedFeature } from "@/components/app/LockedFeature";
import { TryonScreen } from "@/components/tryon/TryonScreen";
import type { PlanStepLite } from "@/components/tryon/stepTitles";
import { getConsentState } from "@/lib/api/guard";
import { getPremiumStatus } from "@/lib/api/premium";
import { PlanV2 } from "@/lib/coach/planTypes";
import { isFeatureEnabled } from "@/lib/config/flags";
import { CONSENT_DOC } from "@/lib/consent";
import { createAdminClient } from "@/lib/db/admin";
import { createClient } from "@/lib/db/server";
import { getLegalVersion } from "@/lib/legal/docs";
import { tryonPresentation, tryonRecommended } from "@/lib/tryon/context";
import { loadTryonReport, resolveTryonAnalysisId } from "@/lib/tryon/context.server";
import { tryonUsage } from "@/lib/tryon/quota";
import { TRYON_MODES, type TryonMode } from "@/lib/tryon/types";
import { loadProfile } from "@/app/api/analyses/v2";

const LOCKED_PERKS = [
  { k: "styles", icon: Scissors },
  { k: "face", icon: ScanFace },
] as const;

/**
 * /dene (F11 v2): premium; ilk kullanımda tryon_generation rızası. Derin bağlantılar (Sprint 2 entegrasyonu):
 * `?preset=<id>` adım kartındaki "Dene" (tek stil), `?mode=glow_up&analysis=<id>` rapor/plan "İyileşmiş halin" kartı.
 * "Sana önerilen" plan v2 adımlarının tryonPresetId'lerinden (v1 rapor yedek); glow-up adımları o analizin planından.
 */
export default async function TryonPage({ searchParams }: PageProps<"/dene">) {
  const { preset, mode, analysis } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/");
  const [t, { premium }] = await Promise.all([getTranslations("tryon"), getPremiumStatus(supabase, user.id)]);

  if (!premium) {
    return (
      <div className="mx-auto w-full max-w-lg px-4 py-6">
        <LockedFeature
          title={t("lockedTitle")}
          href="/premium?from=tryon"
          perks={LOCKED_PERKS.map(({ k, icon: Icon }) => ({ icon: <Icon className="size-4" />, label: t(`lockedPerks.${k}`) }))}
        />
      </div>
    );
  }

  const admin = createAdminClient();
  const requestedAnalysis = typeof analysis === "string" && z.uuid().safeParse(analysis).success ? analysis : null;
  const [state, consentVersion, usage, profile, analysisId] = await Promise.all([
    getConsentState(supabase),
    getLegalVersion(CONSENT_DOC.tryon_generation),
    tryonUsage(user.id),
    loadProfile(admin, user.id),
    resolveTryonAnalysisId(admin, user.id, requestedAnalysis),
  ]);
  const report = await loadTryonReport(admin, user.id, analysisId);
  const c = state.tryon_generation;
  const hasConsent = Boolean(c?.granted && c.textVersion === consentVersion);
  // Sunum ve öneriler: GET /api/tryon/status (mobil) ile aynı saf kural (lib/tryon/context).
  const presentation = tryonPresentation(profile);
  const plan = PlanV2.safeParse(report?.plan_v2);
  const planSteps: PlanStepLite[] = plan.success ? plan.data.steps.filter((s) => s.tier !== "doctor").map((s) => ({ id: s.id, title: s.title, area: s.area })) : [];
  const recommended = tryonRecommended(report?.plan_v2, report?.report);
  const initialMode = TRYON_MODES.find((m): m is TryonMode => m === mode);

  return (
    <div className="mx-auto w-full max-w-lg space-y-4 px-4 py-6">
      <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
      <TryonScreen
        consentVersion={consentVersion}
        hasConsent={hasConsent}
        recommended={recommended}
        quota={{ used: usage.used, limit: usage.limit, nextAt: usage.nextAt }}
        initialPreset={typeof preset === "string" ? preset : undefined}
        initialMode={initialMode}
        presentation={presentation}
        analysisId={analysisId}
        planSteps={planSteps}
        flags={{ combo: isFeatureEnabled("tryonCombo"), glowUp: isFeatureEnabled("glowUp") }}
      />
    </div>
  );
}
