"use client";

import { RotateCcw } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { SignOutButton } from "@/components/auth/SignOutButton";
import { Button } from "@/components/ui/button";
import { postJson } from "@/lib/api/client";

type Props = { requestedAt: string; purgeAt: string };

/** /silme: 7 gün içinde "Silme talebini iptal et" (SPEC Faz 13 madde 4). */
export function CancelDeletionCard({ requestedAt, purgeAt }: Props) {
  const t = useTranslations("deletion");
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const fmt = (iso: string) => new Date(iso).toLocaleDateString("tr-TR", { day: "numeric", month: "long", year: "numeric" });

  async function cancel() {
    setBusy(true);
    try {
      await postJson("/api/me/delete/cancel", {});
      toast.success(t("canceled"));
      router.push("/hesap");
      router.refresh();
    } catch {
      toast.error(t("error"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="flex flex-col items-center gap-4 rounded-2xl border bg-card bg-hero-glow px-5 py-7 text-center shadow-card">
      <span className="grid size-14 place-items-center rounded-2xl bg-brand-soft text-brand" aria-hidden="true">
        <RotateCcw className="size-6" />
      </span>
      <div className="space-y-1.5">
        <h1 className="text-xl font-bold tracking-tight">{t("title")}</h1>
        <p className="text-[13px] leading-relaxed text-muted-foreground">{t("body", { requested: fmt(requestedAt), purge: fmt(purgeAt) })}</p>
      </div>
      <div className="grid w-full gap-2">
        <Button size="lg" disabled={busy} onClick={cancel}>
          {t("cancelButton")}
        </Button>
        <p className="text-[11px] text-muted-foreground">{t("keepHint")}</p>
        <SignOutButton />
      </div>
    </section>
  );
}
