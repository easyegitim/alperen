"use client";

import { Users } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { track } from "@/lib/analytics";
import { referralRatio } from "@/lib/referral/claim";
import { ReferralClaimForm } from "./ReferralClaimForm";

export type ReferralState = { code: string; progress: { done: number; total: number; pending: number }; unlocked: boolean };

/**
 * Davet kilidi (KB P#15/Ç12, FEATURE_REFERRAL_UNLOCK): paywall sayfa 1'de ve kilitli sonuçta davet kodu, ilerleme (n / 5)
 * ve neyin açılacağı (yalnız genel skor). GET /api/referral bayrak kapalıyken 404 döner → blok hiç çizilmez. Kod ve sayılar
 * dışında hiçbir şey (skor, e-posta) tutulmaz; paylaşım metni yalnız kodu taşır. Faz 6: davet edilen kişi için kod girişi
 * (ReferralClaimForm) bloğun altında; cihaz doğrulaması yer tutucu (§11.15 AÇIK).
 * `initial`: fikstür/önizleme (ağ yok).
 */
export function ReferralBlock({ initial = null }: { initial?: ReferralState | null }) {
  const t = useTranslations("paywall.v2.referral");
  const [state, setState] = useState<ReferralState | null>(initial);

  useEffect(() => {
    if (initial) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/referral", { credentials: "same-origin", cache: "no-store" });
        if (!res.ok) return;
        const json = (await res.json()) as Partial<ReferralState>;
        if (cancelled || typeof json.code !== "string" || !json.progress) return;
        setState({ code: json.code, progress: json.progress, unlocked: json.unlocked === true });
        track("referral_code_viewed");
      } catch {
        // ağ hatası: blok gösterilmez
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [initial]);

  if (!state) return null;

  async function share() {
    if (!state) return;
    const text = `${t("shareText", { code: state.code })}`;
    try {
      if (typeof navigator.share === "function") {
        await navigator.share({ text });
        return;
      }
      await navigator.clipboard.writeText(text);
      toast.success(t("copied"));
    } catch {
      // kullanıcı paylaşımı iptal etti ya da pano kapalı
    }
  }

  const ratio = referralRatio(state.progress.done, state.progress.total);
  return (
    <section aria-labelledby="paywall-referral" className="space-y-2.5 rounded-xl border bg-card p-3.5">
      <h3 id="paywall-referral" className="flex items-center gap-2 text-sm font-semibold">
        <Users aria-hidden="true" className="size-4 text-brand" />
        {t("title")}
      </h3>
      <p className="text-[12px] leading-relaxed text-muted-foreground">{t("body")}</p>
      <div className="space-y-1">
        <p className="num flex items-center justify-between text-[12px] font-medium" role="status">
          <span>{t("progress", { done: state.progress.done, total: state.progress.total })}</span>
          {state.progress.pending > 0 ? <span className="text-muted-foreground">{t("pending", { n: state.progress.pending })}</span> : null}
        </p>
        <div className="h-2 w-full overflow-hidden rounded-full bg-track" aria-hidden="true">
          <div className="h-full rounded-full bg-cta-gradient transition-[width]" style={{ width: `${Math.round(ratio * 100)}%` }} />
        </div>
        <p className="text-[11px] leading-relaxed text-muted-foreground">{state.unlocked ? t("unlockedNote") : t("unlocks")}</p>
      </div>
      <div className="flex items-center justify-between gap-3 rounded-lg bg-muted/50 px-3 py-2">
        <span className="min-w-0">
          <span className="eyebrow block">{t("code")}</span>
          <code className="num text-base font-bold tracking-wider">{state.code}</code>
        </span>
        <Button type="button" variant="outline" size="sm" className="min-h-11" onClick={() => void share()}>
          {t("share")}
        </Button>
      </div>
      <ReferralClaimForm enabled />
    </section>
  );
}
