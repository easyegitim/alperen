"use client";

import { Check, Ticket } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { track } from "@/lib/analytics";
import { ApiClientError, postJson } from "@/lib/api/client";
import { claimErrorKey, type ClaimErrorKey } from "@/lib/referral/claim";
import { normalizeReferralCode } from "@/lib/referral/code";
import { cn } from "@/lib/utils";

type Props = {
  /** Bayrak durumu biliniyorsa (ReferralBlock içinde) yoklama yapılmaz; verilmezse GET /api/referral 404 ise hiç çizilmez. */
  enabled?: boolean;
  /** Kapalı başlar ("Davet kodun var mı?"), dokununca açılır. */
  collapsible?: boolean;
  onClaimed?: () => void;
  className?: string;
};

/**
 * Davet kodu girişi (KB P#15/Ç12; S3.3.5): davet edilen kişi DV-XXXX-XXXX kodunu ilk cihaz analizinden ÖNCE girer; fotoğraf
 * yolladığında davet tamamlanır. Tek rota: POST /api/referral { code } → 204 (Turnstile değil, oturum: anonim oturum yok).
 * Gövdede yalnız kod; e-posta, cihaz, skor yok. Cihaz doğrulaması sunucuda yer tutucu (lib/referral/verify.ts).
 */
export function ReferralClaimForm({ enabled, collapsible = true, onClaimed, className }: Props) {
  const t = useTranslations("referral.claim");
  const [available, setAvailable] = useState<boolean | null>(enabled ?? null);
  const [open, setOpen] = useState(!collapsible);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ClaimErrorKey | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (enabled !== undefined) return;
    let cancelled = false;
    fetch("/api/referral", { credentials: "same-origin", cache: "no-store" })
      .then((r) => {
        if (!cancelled) setAvailable(r.ok);
      })
      .catch(() => {
        if (!cancelled) setAvailable(false);
      });
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  if (!available) return null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const normalized = normalizeReferralCode(code);
    if (!normalized) {
      setError("format");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await postJson("/api/referral", { code: normalized });
      track("referral_claimed", { ok: true });
      setDone(true);
      onClaimed?.();
    } catch (err) {
      track("referral_claimed", { ok: false });
      setError(err instanceof ApiClientError ? claimErrorKey(err.code, err.message) : "generic");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <p role="status" className={cn("flex items-center gap-2 rounded-xl border bg-brand-soft/40 px-3 py-2.5 text-[13px] font-medium", className)}>
        <Check className="size-4 text-success" aria-hidden="true" />
        {t("success")}
      </p>
    );
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className={cn("flex min-h-11 w-full items-center gap-2 rounded-xl border border-dashed bg-muted/40 px-3 text-left text-[13px] font-semibold text-brand hover:bg-accent", className)}>
        <Ticket className="size-4" aria-hidden="true" />
        {t("title")}
      </button>
    );
  }

  return (
    <form onSubmit={(e) => void submit(e)} className={cn("space-y-2 rounded-xl border bg-card p-3.5", className)} aria-labelledby="referral-claim-title">
      <p id="referral-claim-title" className="flex items-center gap-2 text-sm font-semibold">
        <Ticket className="size-4 text-brand" aria-hidden="true" />
        {t("title")}
      </p>
      <p className="text-[12px] leading-relaxed text-muted-foreground">{t("body")}</p>
      <label htmlFor="referral-code" className="eyebrow block">
        {t("label")}
      </label>
      <Input
        id="referral-code"
        value={code}
        onChange={(e) => {
          setCode(e.target.value.toUpperCase());
          setError(null);
        }}
        placeholder={t("placeholder")}
        autoCapitalize="characters"
        autoComplete="off"
        spellCheck={false}
        inputMode="text"
        maxLength={14}
        className="num h-11 tracking-wider"
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? "referral-claim-error" : undefined}
      />
      {error ? (
        <p id="referral-claim-error" role="alert" className="text-[12px] text-destructive">
          {t(`errors.${error}`)}
        </p>
      ) : null}
      <div className="flex gap-2">
        {collapsible ? (
          <Button type="button" variant="ghost" className="flex-1" onClick={() => setOpen(false)}>
            {t("skip")}
          </Button>
        ) : null}
        <Button type="submit" className="flex-[1.4]" disabled={busy || code.replace(/[^A-Za-z0-9]/g, "").length < 8}>
          {t("submit")}
        </Button>
      </div>
    </form>
  );
}
