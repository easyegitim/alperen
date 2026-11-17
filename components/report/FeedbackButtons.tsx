"use client";

import { Flag, ThumbsDown, ThumbsUp } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { track } from "@/lib/analytics";
import { postJson } from "@/lib/api/client";
import { cn } from "@/lib/utils";

type Props = { targetType: "score" | "report" | "tryon" | "exercise"; targetId?: string; section?: string; compact?: boolean };

/** F18: faydalı / faydasız ve "uygunsuz içerik bildir". */
export function FeedbackButtons({ targetType, targetId, section, compact }: Props) {
  const t = useTranslations("feedback");
  const [sent, setSent] = useState<1 | -1 | null>(null);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");

  async function rate(rating: 1 | -1) {
    try {
      await postJson("/api/feedback", { targetType, targetId, rating, reason: section ? `section:${section}` : undefined });
      setSent(rating);
      track("feedback_sent", { targetType, rating });
    } catch {
      toast.error(t("error"));
    }
  }
  async function report() {
    try {
      await postJson("/api/feedback", { targetType, targetId, isAbuseReport: true, reason: `${section ? `section:${section} ` : ""}${reason}`.trim() || undefined });
      setOpen(false);
      toast.success(t("reported"));
      track("feedback_sent", { targetType, rating: null });
    } catch {
      toast.error(t("error"));
    }
  }

  return (
    <div className={compact ? "flex items-center gap-0.5" : "flex items-center gap-1 pt-1"}>
      <span className="mr-1 text-xs text-muted-foreground">{sent ? t("thanks") : t("helpful")}</span>
      <Button size="icon" variant="ghost" className={cn("rounded-full text-muted-foreground", sent === 1 && "bg-brand-soft text-brand disabled:opacity-100")} aria-label={t("yes")} aria-pressed={sent === 1} onClick={() => rate(1)} disabled={sent !== null}><ThumbsUp /></Button>
      <Button size="icon" variant="ghost" className={cn("rounded-full text-muted-foreground", sent === -1 && "bg-brand-soft text-brand disabled:opacity-100")} aria-label={t("no")} aria-pressed={sent === -1} onClick={() => rate(-1)} disabled={sent !== null}><ThumbsDown /></Button>
      <Button size="icon" variant="ghost" className="ml-auto rounded-full text-muted-foreground" aria-label={t("report")} onClick={() => setOpen(true)}><Flag /></Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("reportTitle")}</DialogTitle>
            <DialogDescription>{t("reportBody")}</DialogDescription>
          </DialogHeader>
          <textarea className="min-h-24 w-full rounded-xl border border-input bg-background p-3 text-sm" maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t("reportPlaceholder")} />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>{t("cancel")}</Button>
            <Button onClick={report}>{t("send")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
