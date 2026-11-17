"use client";

import { ChevronDown, ShieldCheck } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { MANAGEABLE_CONSENTS, offersAnalysisDeletion, revokeEffects, type ManageableConsent } from "@/lib/account/consents";
import { track } from "@/lib/analytics";
import { postJson } from "@/lib/api/client";
import { notifyCookieConsent } from "@/components/legal/CookieBanner";
import { COOKIE_CONSENT_NAME, type ConsentState } from "@/lib/consent";

type Props = {
  initial: ConsentState;
  /** Her rıza türü için güncel metin sürümü (CONSENT_DOC → content/legal). */
  versions: Record<ManageableConsent, string>;
  /** FEATURE_EXPERT_NETWORK: kapalıyken uzman paylaşımı rızası gösterilmez (yalnız önceden verilmişse geri alınabilsin diye kalır). */
  expertNetwork: boolean;
};

/** Çerez banner'ıyla aynı teknik çerez; analytics_cookies rızası buradan da güncellenir. */
function setCookieConsent(value: "granted" | "denied") {
  document.cookie = `${COOKIE_CONSENT_NAME}=${value}; path=/; max-age=${60 * 60 * 24 * 180}; samesite=lax`;
  notifyCookieConsent();
}

/** SPEC 16.2: /hesap rıza anahtarları; geri alma etkileri; biometric_processing için analiz silme sorusu. */
export function ConsentSettings({ initial, versions, expertNetwork }: Props) {
  const t = useTranslations("account.consents");
  const [state, setState] = useState<Record<ManageableConsent, boolean>>(() => {
    const s = {} as Record<ManageableConsent, boolean>;
    for (const k of MANAGEABLE_CONSENTS) {
      const c = initial[k];
      s[k] = Boolean(c?.granted && c.textVersion === versions[k]);
    }
    return s;
  });
  const [shown] = useState<ManageableConsent[]>(() =>
    MANAGEABLE_CONSENTS.filter((k) => k !== "expert_data_sharing" || expertNetwork || Boolean(initial[k]?.granted)),
  );
  const [busy, setBusy] = useState<ManageableConsent | null>(null);
  const [pending, setPending] = useState<ManageableConsent | null>(null); // biometric geri alma onayı
  const [deleteAnalyses, setDeleteAnalyses] = useState(true);

  async function apply(type: ManageableConsent, granted: boolean, withDelete?: boolean) {
    setBusy(type);
    try {
      await postJson("/api/consents", { type, granted, textVersion: versions[type], ...(withDelete !== undefined ? { deleteAnalyses: withDelete } : {}) });
      track("consent_updated", { type, granted });
      setState((s) => ({ ...s, [type]: granted }));
      if (type === "analytics_cookies") setCookieConsent(granted ? "granted" : "denied");
      toast.success(granted ? t("granted") : withDelete ? t("revokedAndDeleted") : t("revoked"));
    } catch {
      toast.error(t("error"));
    } finally {
      setBusy(null);
    }
  }

  function onToggle(type: ManageableConsent, next: boolean) {
    if (offersAnalysisDeletion(type, next)) {
      setDeleteAnalyses(true);
      setPending(type);
      return;
    }
    void apply(type, next);
  }

  return (
    <Card>
      <CardHeader>
        <h2 className="flex items-center gap-2.5 text-lg font-semibold tracking-tight">
          <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand" aria-hidden="true">
            <ShieldCheck className="size-4" />
          </span>
          {t("title")}
        </h2>
        <CardDescription className="text-[13px]">{t("description")}</CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="divide-y divide-border/60 overflow-hidden rounded-xl bg-muted/40">
          {shown.map((k) => (
            <li key={k} className="space-y-1 px-3 py-3">
              <div className="flex items-start justify-between gap-3">
                <label htmlFor={`acct-consent-${k}`} className="min-w-0 space-y-0.5">
                  <span className="block text-sm font-semibold">{t(`items.${k}.title`)}</span>
                  <span className="block text-xs leading-relaxed text-muted-foreground">{t(`items.${k}.body`)}</span>
                </label>
                <Switch id={`acct-consent-${k}`} className="mt-0.5" checked={state[k]} disabled={busy !== null} onCheckedChange={(v) => onToggle(k, v)} />
              </div>
              {state[k] ? (
                <details className="group">
                  <summary className="-mx-1 -mb-2 inline-flex min-h-11 cursor-pointer items-center gap-1 rounded-lg px-1 text-xs font-medium text-muted-foreground hover:text-foreground">
                    {t("ifRevoked")}
                    <ChevronDown className="size-3.5 transition-transform group-open:rotate-180" aria-hidden="true" />
                  </summary>
                  <p className="pb-1 text-xs leading-relaxed text-muted-foreground">{revokeEffects(k).map((e) => t(`effects.${e}`)).join(" ")}</p>
                </details>
              ) : null}
            </li>
          ))}
        </ul>
        <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">{t("historyNote")}</p>
      </CardContent>

      <Dialog open={pending !== null} onOpenChange={(o) => (!o ? setPending(null) : undefined)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("revokeBiometricTitle")}</DialogTitle>
            <DialogDescription>{t("revokeBiometricBody")}</DialogDescription>
          </DialogHeader>
          <label className="flex items-start gap-3 text-sm">
            <Checkbox checked={deleteAnalyses} onCheckedChange={(v) => setDeleteAnalyses(v === true)} aria-label={t("deletePastAnalyses")} />
            <span>
              <span className="block font-medium">{t("deletePastAnalyses")}</span>
              <span className="block text-xs text-muted-foreground">{t("deletePastAnalysesHint")}</span>
            </span>
          </label>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPending(null)}>{t("keep")}</Button>
            <Button
              variant="destructive"
              disabled={busy !== null}
              onClick={async () => {
                const type = pending;
                setPending(null);
                if (type) await apply(type, false, deleteAnalyses);
              }}
            >
              {t("confirmRevoke")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
