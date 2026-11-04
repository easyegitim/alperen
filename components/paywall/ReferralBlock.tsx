"use client";

import { Users } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { track } from "@/lib/analytics";

type ReferralState = { code: string; progress: { done: number; total: number; pending: number }; unlocked: boolean };

/**
 * Davet kilidi (KB P#15/Ç12, FEATURE_REFERRAL_UNLOCK): paywall sayfa 1'de davet kodu ve ilerleme. GET /api/referral bayrak
 * kapalıyken 404 döner → blok hiç çizilmez. Kod ve sayılar dışında hiçbir şey (skor, e-posta) tutulmaz; paylaşım metni
 * yalnız kodu taşır. Davetlinin kodu girdiği ekran bu sprintte yok (AÇIK §11.15; cihaz doğrulaması yer tutucu).
 */
export function ReferralBlock() {
  const t = useTranslations("paywall.v2.referral");
  const [state, setState] = useState<ReferralState | null>(null);

  useEffect(() => {
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
  }, []);

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

  return (
    <section aria-labelledby="paywall-referral" className="space-y-2.5 rounded-xl border bg-card p-3.5">
      <h3 id="paywall-referral" className="flex items-center gap-2 text-sm font-semibold">
        <Users aria-hidden="true" className="size-4 text-brand" />
        {t("title")}
      </h3>
      <p className="text-[12px] leading-relaxed text-muted-foreground">{t("body")}</p>
      <p className="text-[12px] font-medium" role="status">
        {t("progress", { done: state.progress.done, total: state.progress.total })}
      </p>
      <div className="flex items-center justify-between gap-3 rounded-lg bg-muted/50 px-3 py-2">
        <span className="min-w-0">
          <span className="eyebrow block">{t("code")}</span>
          <code className="num text-base font-bold tracking-wider">{state.code}</code>
        </span>
        <Button type="button" variant="outline" size="sm" className="min-h-11" onClick={() => void share()}>
          {t("share")}
        </Button>
      </div>
    </section>
  );
}
