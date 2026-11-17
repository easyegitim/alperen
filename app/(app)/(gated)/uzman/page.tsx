import { getTranslations } from "next-intl/server";
import { notFound, redirect } from "next/navigation";
import { ExpertDirectory } from "@/components/experts/ExpertDirectory";
import { EXPERT_SPECIALTIES, type ExpertDirectoryGroup } from "@/content/expert-specialties";
import { getConsentState } from "@/lib/api/guard";
import { isFeatureEnabled } from "@/lib/config/flags";
import { CONSENT_DOC } from "@/lib/consent";
import { createAdminClient } from "@/lib/db/admin";
import { createClient } from "@/lib/db/server";
import { getLegalVersion } from "@/lib/legal/docs";

/** /uzman (F19): flag kapalı → 404 (SPEC 4.2). */
export default async function ExpertsPage({ searchParams }: PageProps<"/uzman">) {
  if (!isFeatureEnabled("expertNetwork")) notFound();
  const { alan } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/");
  const [t, state, version, last] = await Promise.all([
    getTranslations("experts"),
    getConsentState(supabase),
    getLegalVersion(CONSENT_DOC.expert_data_sharing),
    createAdminClient().from("analyses").select("id").eq("user_id", user.id).eq("status", "completed").order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  const c = state.expert_data_sharing;
  const groups: ExpertDirectoryGroup[] = ["medical", "grooming", "wellbeing"];
  return (
    <div className="mx-auto w-full max-w-lg space-y-4 px-4 py-6">
      <header className="space-y-1.5">
        <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
        <p className="text-[13px] text-muted-foreground">{t("intro")}</p>
      </header>
      {/* Sponsorsuz uzman dizini (KB Ç4, PLAN 4g): grup → uzmanlık; ücret, komisyon, kampanya, hekim reklamı yok. */}
      <section aria-labelledby="directory-title" className="space-y-2 rounded-2xl border bg-card p-4 shadow-card">
        <h2 id="directory-title" className="text-[15px] font-semibold">{t("directory.title")}</h2>
        <p className="text-xs text-muted-foreground">{t("directory.intro")}</p>
        {groups.map((g) => (
          <div key={g} className="space-y-1">
            <h3 className="eyebrow">{t(`directory.groups.${g}`)}</h3>
            <ul className="divide-y divide-border/60 rounded-xl bg-muted/50">
              {EXPERT_SPECIALTIES.filter((sp) => sp.directory === g).map((sp) => (
                <li key={sp.id} className="px-3 py-2">
                  <span className="block text-sm font-medium">{sp.nameTr}</span>
                  <span className="block text-[12px] text-muted-foreground">{sp.descriptionTr}</span>
                  {sp.kinds.length === 0 ? <span className="block text-[11px] text-muted-foreground">{t("directory.noPartnerKind")}</span> : null}
                </li>
              ))}
            </ul>
          </div>
        ))}
        <p className="text-[11px] text-muted-foreground">{t("directory.note")}</p>
      </section>
      <ExpertDirectory
        initialSpecialty={typeof alan === "string" ? alan : undefined}
        lastAnalysisId={last.data?.id ? String(last.data.id) : null}
        sharingConsent={{ has: Boolean(c?.granted && c.textVersion === version), version }}
      />
    </div>
  );
}
