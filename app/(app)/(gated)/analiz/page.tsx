import { getTranslations } from "next-intl/server";
import { ChevronRight, Lock, Plus, ScanFace } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ScoreTrend } from "@/components/analysis/ScoreTrend";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getPremiumStatus } from "@/lib/api/premium";
import { createAdminClient } from "@/lib/db/admin";
import { createClient } from "@/lib/db/server";
import { toClientSummary, type AnalysisRow } from "@/lib/score/present";
import { selectAnalysisRows } from "@/lib/score/rowColumns";

/** /analiz: geçmiş listesi (trend grafiği Faz 7). */
export default async function AnalysesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/");
  const [t, tg, { premium }] = await Promise.all([getTranslations("analysis"), getTranslations("geometry"), getPremiumStatus(supabase, user.id)]);
  const admin = createAdminClient();
  const { data } = await selectAnalysisRows((cols) =>
    admin.from("analyses").select(cols).eq("user_id", user.id).neq("status", "failed").order("created_at", { ascending: false }).limit(50),
  );
  const items = ((data as AnalysisRow[] | null) ?? []).map((r) => toClientSummary(r, premium));
  const fmt = (n: number | null) => (n === null ? "●,●" : n.toLocaleString("tr-TR", { minimumFractionDigits: 1 }));

  return (
    <div className="mx-auto w-full max-w-lg space-y-4 px-4 py-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">{t("listTitle")}</h1>
        <Button asChild size="sm">
          <Link href="/tara">
            <Plus aria-hidden="true" />
            {t("newAnalysis")}
          </Link>
        </Button>
      </div>
      {premium && items.filter((i) => i.status === "completed").length >= 2 ? (
        <Card>
          <CardContent className="pt-4">
            <ScoreTrend
              points={items
                .filter((i) => i.status === "completed" && i.overall !== null && i.potential !== null)
                .map((i) => ({ id: i.id, date: i.createdAt, overall: i.overall!, potential: i.potential!, calibrationVersion: i.calibrationVersion }))}
            />
          </CardContent>
        </Card>
      ) : null}
      {items.length === 0 ? (
        <Card className="bg-hero-glow items-center text-center">
          <span className="grid size-14 place-items-center rounded-2xl bg-brand-soft text-brand" aria-hidden="true">
            <ScanFace className="size-7" />
          </span>
          <CardHeader className="w-full justify-items-center">
            <CardTitle>{t("emptyTitle")}</CardTitle>
            <CardDescription>{t("emptyBody")}</CardDescription>
          </CardHeader>
          <CardContent className="w-full">
            <Button asChild className="w-full">
              <Link href="/tara">{t("newAnalysis")}</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <ul className="space-y-2">
          {items.map((a) => (
            <li key={a.id}>
              <Link
                href={`/analiz/${a.id}`}
                className="flex min-h-16 items-center gap-3 rounded-2xl border bg-card px-4 py-3 shadow-card transition-colors hover:bg-accent"
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold">
                    {new Date(a.createdAt).toLocaleDateString("tr-TR", { day: "numeric", month: "long", year: "numeric" })}
                  </span>
                  <span className="block text-xs text-muted-foreground">{a.faceShape ? tg(`shapes.${a.faceShape}`) : a.status}</span>
                </span>
                {a.status === "completed" && a.overall === null ? (
                  <span className="num inline-flex items-center gap-1 text-lg font-bold text-muted-foreground">
                    <span aria-hidden="true">{fmt(null)}</span>
                    <Lock className="size-3.5" aria-hidden="true" />
                    <span className="sr-only">{t("scoreLocked")}</span>
                  </span>
                ) : (
                  <span className="num text-brand-gradient text-2xl font-bold">{a.status === "completed" ? fmt(a.overall) : "…"}</span>
                )}
                <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
