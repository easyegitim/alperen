"use client";

import { Download } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { isApiErrorBody } from "@/lib/api/errors";

/** F15 "Verimi indir": GET /api/me/export → JSON dosyası (günde 3). */
export function DataExportButton() {
  const t = useTranslations("account.export");
  const [busy, setBusy] = useState(false);

  async function download() {
    setBusy(true);
    try {
      const res = await fetch("/api/me/export", { credentials: "same-origin" });
      if (!res.ok) {
        const body: unknown = await res.json().catch(() => null);
        toast.error(isApiErrorBody(body) && body.error.code === "RATE_LIMITED" ? t("rateLimited") : t("error"));
        return;
      }
      const blob = await res.blob();
      const name = res.headers.get("content-disposition")?.match(/filename="([^"]+)"/)?.[1] ?? "aura-verilerim.json";
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(t("done"));
    } catch {
      toast.error(t("error"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <h2 className="flex items-center gap-2.5 text-lg font-semibold tracking-tight">
          <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand" aria-hidden="true">
            <Download className="size-4" />
          </span>
          {t("title")}
        </h2>
        <CardDescription className="text-[13px]">{t("description")}</CardDescription>
      </CardHeader>
      <CardContent>
        <Button variant="outline" className="w-full" disabled={busy} onClick={download}>
          {busy ? t("busy") : t("button")}
        </Button>
      </CardContent>
    </Card>
  );
}
