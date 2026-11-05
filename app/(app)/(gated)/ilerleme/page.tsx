import { getTranslations } from "next-intl/server";
import { Camera, TrendingUp } from "lucide-react";
import { redirect } from "next/navigation";
import { ScoreTrend } from "@/components/analysis/ScoreTrend";
import { LockedFeature } from "@/components/app/LockedFeature";
import { ProgressScreen } from "@/components/progress/ProgressScreen";
import { StateCard, StateCardLink } from "@/components/routine/StateCard";
import { Card, CardContent } from "@/components/ui/card";
import { getPremiumStatus } from "@/lib/api/premium";
import { ENTITLEMENTS } from "@/lib/config/plans";
import { NOISE_BAND } from "@/lib/config/scoring";
import { createAdminClient } from "@/lib/db/admin";
import { createClient } from "@/lib/db/server";

const epochNow = () => Date.now();

/** /ilerleme (F13): cihazdaki fotoğraflar (istemci), skor trendi (premium), 7 gün dolunca "Yeni analiz hakkın açıldı". */
export default async function ProgressPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/");
  const [t, { premium }] = await Promise.all([getTranslations("progress"), getPremiumStatus(supabase, user.id)]);

  let points: { id: string; date: string; overall: number; potential: number; calibrationVersion: string | null }[] = [];
  let newSlot = false;
  let nextSlotAt: Date | null = null;
  if (premium) {
    const admin = createAdminClient();
    const { data } = await admin
      .from("analyses")
      .select("id, created_at, overall, potential, calibration_version, status")
      .eq("user_id", user.id)
      .in("status", ["completed", "processing"])
      .order("created_at", { ascending: false })
      .limit(52);
    const rows = data ?? [];
    points = rows.filter((r) => r.status === "completed" && r.overall !== null && r.potential !== null).map((r) => ({ id: String(r.id), date: String(r.created_at), overall: Number(r.overall), potential: Number(r.potential), calibrationVersion: r.calibration_version ? String(r.calibration_version) : null }));
    const last = rows[0];
    newSlot = !last || epochNow() - new Date(String(last.created_at)).getTime() >= ENTITLEMENTS.premium.windowDays * 86_400_000;
    if (last && !newSlot) nextSlotAt = new Date(new Date(String(last.created_at)).getTime() + ENTITLEMENTS.premium.windowDays * 86_400_000);
  }

  return (
    <div className="mx-auto w-full max-w-lg space-y-5 px-4 py-6">
      <header className="space-y-1">
        <p className="eyebrow">{t("eyebrow")}</p>
        <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
      </header>
      {premium && newSlot && points.length >= 2 ? (
        <StateCard feature icon={<Camera className="size-6" />} title={t("newSlotTitle")} body={t("newSlotBody")}>
          <StateCardLink href="/tara">{t("newAnalysis")}</StateCardLink>
        </StateCard>
      ) : null}
      {premium && points.length >= 2 ? (
        <Card>
          <CardContent>
            <ScoreTrend points={points} band={NOISE_BAND} />
          </CardContent>
        </Card>
      ) : premium ? (
        // Boş trend: süs amaçlı sabit çizgi (veriden türetilmez), tek satır açıklama, hak açıksa "Yeni analiz".
        <StateCard
          feature={newSlot}
          icon={<TrendingUp className="size-6" />}
          title={t("trendEmptyTitle")}
          body={newSlot ? t("trendEmptyBody") : nextSlotAt ? t("trendNextSlot", { date: nextSlotAt.toLocaleDateString("tr-TR", { day: "numeric", month: "long" }) }) : t("trendEmptyBody")}
        >
          <svg viewBox="0 0 240 56" className="h-14 w-full text-brand opacity-40" aria-hidden="true">
            <line x1="0" x2="240" y1="48" y2="48" stroke="currentColor" strokeOpacity={0.3} />
            <path d="M8 40 C 50 38, 70 30, 104 28 S 160 20, 196 14 L 232 10" fill="none" stroke="currentColor" strokeWidth={2.5} strokeDasharray="5 5" strokeLinecap="round" />
            <circle cx="8" cy="40" r="4.5" fill="currentColor" />
            <circle cx="232" cy="10" r="4.5" fill="none" stroke="currentColor" strokeWidth={2} />
          </svg>
          {newSlot ? <StateCardLink href="/tara">{t("newAnalysis")}</StateCardLink> : null}
        </StateCard>
      ) : (
        <LockedFeature title={t("trendLockedTitle")} body={t("trendLockedBody")} href="/premium?from=progress" />
      )}
      <ProgressScreen />
    </div>
  );
}
