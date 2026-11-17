import { getTranslations } from "next-intl/server";
import { ChevronRight, FileText, UserRound } from "lucide-react";
import Link from "next/link";
import { ConsentSettings } from "@/components/account/ConsentSettings";
import { DataExportButton } from "@/components/account/DataExportButton";
import { DeleteAccountDialog } from "@/components/account/DeleteAccountDialog";
import { LinkAccount } from "@/components/auth/LinkAccount";
import { SignOutButton } from "@/components/auth/SignOutButton";
import { SubscriptionCard } from "@/components/billing/SubscriptionCard";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { isFeatureEnabled } from "@/lib/config/flags";
import { MANAGEABLE_CONSENTS, type ManageableConsent } from "@/lib/account/consents";
import { getConsentState } from "@/lib/api/guard";
import { getPremiumStatus } from "@/lib/api/premium";
import { CONSENT_DOC, LEGAL_SLUGS } from "@/lib/consent";
import { createClient } from "@/lib/db/server";
import { getLegalVersion } from "@/lib/legal/docs";

/** F15: e-posta, plan ve iptal, rıza anahtarları (geri alma etkileriyle), verimi indir, hesabımı sil, çıkış. */
export default async function AccountPage({ searchParams }: PageProps<"/hesap">) {
  const t = await getTranslations("account");
  const tl = await getTranslations("legal");
  const { auth_error } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const isAnonymous = user?.is_anonymous ?? true;
  const sub = user ? await getPremiumStatus(supabase, user.id) : { premium: false, plan: null, periodEnd: null };
  const { data: subRow } = user ? await supabase.from("subscriptions").select("cancel_at_period_end").eq("user_id", user.id).maybeSingle() : { data: null };
  const consentState = user ? await getConsentState(supabase) : {};
  const versions = Object.fromEntries(
    await Promise.all(MANAGEABLE_CONSENTS.map(async (k) => [k, await getLegalVersion(CONSENT_DOC[k])] as const)),
  ) as Record<ManageableConsent, string>;

  return (
    <div className="mx-auto w-full max-w-lg space-y-3 px-4 py-6">
      <h1 className="pb-2 text-2xl font-bold tracking-tight">{t("title")}</h1>

      {auth_error ? (
        <p role="alert" className="rounded-2xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm">
          {t("authError")}
        </p>
      ) : null}

      <section className="flex items-center gap-4 rounded-2xl border bg-card bg-hero-glow p-5 shadow-card">
        <span className="grid size-14 shrink-0 place-items-center rounded-full bg-brand-gradient text-white shadow-glow" aria-hidden="true">
          <UserRound className="size-6" />
        </span>
        <div className="min-w-0 space-y-1">
          <h2 className="truncate text-lg font-semibold tracking-tight">{isAnonymous ? t("anonymous") : (user?.email ?? t("emailLabel"))}</h2>
          {isAnonymous ? (
            <p className="text-[13px] text-muted-foreground">{t("anonymousHint")}</p>
          ) : (
            <p className="inline-flex h-6 items-center gap-1.5 rounded-full bg-muted px-2.5 text-[11px] font-medium">
              <span className="size-1.5 rounded-full bg-success" aria-hidden="true" />
              {t("emailLabel")}
            </p>
          )}
        </div>
      </section>

      {isAnonymous ? <LinkAccount returnPath="/hesap" /> : null}

      <SubscriptionCard premium={sub.premium} plan={sub.plan} periodEnd={sub.periodEnd} cancelAtPeriodEnd={Boolean(subRow?.cancel_at_period_end)} />

      <ConsentSettings initial={consentState} versions={versions} expertNetwork={isFeatureEnabled("expertNetwork")} />

      <DataExportButton />

      <Card>
        <CardHeader>
          <h2 className="flex items-center gap-2.5 text-lg font-semibold tracking-tight">
            <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand" aria-hidden="true">
              <FileText className="size-4" />
            </span>
            {t("legalTitle")}
          </h2>
        </CardHeader>
        <CardContent>
          <ul className="divide-y divide-border/60 overflow-hidden rounded-xl bg-muted/40">
            {LEGAL_SLUGS.map((s) => (
              <li key={s}>
                <Link className="flex min-h-11 items-center justify-between gap-3 px-3 py-2 text-sm font-medium transition-colors hover:bg-accent" href={`/yasal/${s}`}>
                  {tl(`links.${s}`)}
                  <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <DeleteAccountDialog />

      <div className="pt-2">
        <SignOutButton />
      </div>
    </div>
  );
}
