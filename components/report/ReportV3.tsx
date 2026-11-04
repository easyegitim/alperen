"use client";

import { ChevronDown, FileText, Ruler, Sparkles, Wand2 } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useState } from "react";
import { barPosition } from "@/components/analysis/result/MeasuresCard";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { STRUCTURAL_REGIONS } from "@/lib/coach/planTypes";
import type { MeasureKey, ReportV3 as ReportV3Type } from "@/lib/score/contract";
import { cn } from "@/lib/utils";

type Props = {
  report: ReportV3Type | null;
  analysisId: string;
  /** Kaç açı kullanıldı (güven notu). */
  viewsUsed?: number;
  /** Plan kartı: bu sayfada plan aşağıdaysa bağlantı yerine #section-plan. */
  planHref?: string;
  glowUpEnabled?: boolean;
  expertNetworkEnabled?: boolean;
  /** Sunucudan gelen "… için bir dermatoloğa göstermek faydalı olabilir" cümlesi (K11); yoksa gösterilmez. */
  seeProfessional?: string | null;
};

const LABEL_KEY: Record<MeasureKey, "canthalTilt" | "jawRatio" | "fwhr" | "thirds"> = { canthalTiltDeg: "canthalTilt", jawRatio: "jawRatio", fwhr: "fwhr", thirds: "thirds" };
const fmtMeasure = (key: MeasureKey, v: number) =>
  key === "canthalTiltDeg" ? `${v.toLocaleString("tr-TR", { maximumFractionDigits: 1 })}°` : key === "thirds" ? `%${Math.round(v * 100)}` : v.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * Rapor v3 iskeleti (KB §5; PLAN 4a): açılış mektubu · 9 bölge (güçlü yan → görülen → ≤ 2 fırsat; "değişiklik gerekmez") ·
 * ölçüler (açılır; dengeli aralık çubuğu; kıyas yalnız aralık ve kendi geçmişi) · plan · "iyileşmiş halin" · kapanış
 * ("Tıbbi tavsiye değildir"). Yapısal bölgelerde (göz, burun, elmacık, çene) tarif + algı notu; yargı yok.
 */
export function ReportV3({ report, analysisId, viewsUsed = 0, planHref, glowUpEnabled = true, expertNetworkEnabled = false, seeProfessional = null }: Props) {
  const t = useTranslations("report.v2");
  const tg = useTranslations("geometry");
  const [measuresOpen, setMeasuresOpen] = useState(false);
  if (!report) {
    return (
      <Card>
        <CardContent>
          <p className="text-sm text-muted-foreground">{t("missing")}</p>
        </CardContent>
      </Card>
    );
  }
  const structural = new Set<string>(STRUCTURAL_REGIONS);
  return (
    <div className="space-y-3">
      <Card className="border-brand-gradient bg-hero-glow">
        <CardHeader>
          <h2 className="flex items-center gap-2.5 text-lg font-semibold tracking-tight">
            <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand" aria-hidden="true">
              <Sparkles className="size-4" />
            </span>
            {t("letterTitle")}
          </h2>
        </CardHeader>
        <CardContent className="space-y-2">
          <p className="text-[15px] leading-relaxed font-medium">{report.letter}</p>
          {viewsUsed > 0 ? <p className="text-[11px] text-muted-foreground">{t("confidence", { n: viewsUsed })}</p> : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <h2 className="flex items-center gap-2.5 text-lg font-semibold tracking-tight">
            <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand" aria-hidden="true">
              <FileText className="size-4" />
            </span>
            {t("regionsTitle")}
          </h2>
        </CardHeader>
        <CardContent>
          <ul className="space-y-2">
            {report.regions.map((r) => (
              <li key={r.key} className="space-y-1 rounded-xl bg-muted/40 p-3 text-[13px] leading-relaxed">
                <p className="font-semibold">{t(`regions.${r.key}`)}</p>
                <p>
                  <span className="text-muted-foreground">{t("strength")}: </span>
                  {r.strength}
                </p>
                <p>
                  <span className="text-muted-foreground">{t("seen")}: </span>
                  {r.seen}
                </p>
                {r.improvements.length ? (
                  <div>
                    <span className="text-muted-foreground">{t("improvements")}: </span>
                    <ul className="list-disc pl-4">
                      {r.improvements.map((s, i) => (
                        <li key={i}>{s}</li>
                      ))}
                    </ul>
                  </div>
                ) : (
                  <p className="text-muted-foreground">{t("noChange")}</p>
                )}
                {structural.has(r.key) ? <p className="text-[11px] text-muted-foreground">{t("structuralNote")}</p> : null}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      {report.measures.length ? (
        <Card>
          <CardHeader>
            <button type="button" onClick={() => setMeasuresOpen((o) => !o)} aria-expanded={measuresOpen} className="flex min-h-11 w-full items-center gap-2.5 text-left text-lg font-semibold tracking-tight">
              <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand" aria-hidden="true">
                <Ruler className="size-4" />
              </span>
              <span className="flex-1">{t("measures.title")}</span>
              <span className="text-xs font-medium text-muted-foreground">{measuresOpen ? t("measures.close") : t("measures.open")}</span>
              <ChevronDown className={cn("size-4 text-muted-foreground transition-transform", measuresOpen && "rotate-180")} aria-hidden="true" />
            </button>
          </CardHeader>
          {measuresOpen ? (
            <CardContent className="space-y-3">
              <ul className="space-y-3">
                {report.measures.map((m) => {
                  const pos = barPosition(m.value, m.balancedRange);
                  const name = tg(LABEL_KEY[m.key]);
                  return (
                    <li key={m.key} className="space-y-1.5">
                      <div className="flex items-baseline justify-between gap-2 text-[13px]">
                        <span className="font-medium">{name}</span>
                        <span className="num text-muted-foreground">{fmtMeasure(m.key, m.value)}</span>
                      </div>
                      <div role="img" aria-label={`${name}: ${t("measures.yourValue")} ${fmtMeasure(m.key, m.value)}; ${t("measures.balancedRange")} ${fmtMeasure(m.key, m.balancedRange[0])}–${fmtMeasure(m.key, m.balancedRange[1])}`} className="relative h-3 rounded-full bg-track">
                        <span className="absolute inset-y-0 rounded-full bg-brand-soft ring-1 ring-brand/30" style={{ left: `${pos.lo}%`, width: `${pos.hi - pos.lo}%` }} />
                        <span className="absolute top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-brand-gradient shadow-glow ring-2 ring-card" style={{ left: `${pos.at}%` }} />
                      </div>
                      <div className="num flex justify-between text-[10px] text-muted-foreground" aria-hidden="true">
                        <span>
                          {t("measures.balancedRange")}: {fmtMeasure(m.key, m.balancedRange[0])}–{fmtMeasure(m.key, m.balancedRange[1])}
                        </span>
                        <span>{t("measures.yourValue")}</span>
                      </div>
                    </li>
                  );
                })}
              </ul>
              <p className="text-[11px] leading-relaxed text-muted-foreground">{t("measures.hint")}</p>
            </CardContent>
          ) : null}
        </Card>
      ) : null}

      <div className="grid gap-2 sm:grid-cols-2">
        <Card>
          <CardContent className="space-y-2">
            <p className="text-sm font-semibold">{t("planTitle")}</p>
            <p className="text-xs text-muted-foreground">{t("planBody")}</p>
            <Button asChild variant="outline" className="w-full">
              <Link href={planHref ?? `/plan/${analysisId}`}>{t("planLink")}</Link>
            </Button>
          </CardContent>
        </Card>
        {glowUpEnabled ? (
          <Card>
            <CardContent className="space-y-2">
              <p className="flex items-center gap-1.5 text-sm font-semibold">
                <Wand2 className="size-4 text-brand" aria-hidden="true" />
                {t("glowUpTitle")}
              </p>
              <p className="text-xs text-muted-foreground">{t("glowUpBody")}</p>
              <Button asChild variant="outline" className="w-full">
                <Link href={`/dene?mode=glow_up&analysis=${analysisId}`}>{t("glowUpLink")}</Link>
              </Button>
            </CardContent>
          </Card>
        ) : null}
      </div>

      {seeProfessional ? (
        <section className="space-y-2 rounded-2xl border border-dashed p-4">
          <h2 className="text-[15px] font-semibold">{t("seeProfessionalTitle")}</h2>
          <p className="text-[13px] leading-relaxed text-muted-foreground">{seeProfessional}</p>
          {expertNetworkEnabled ? (
            <Button asChild variant="outline" className="w-full">
              <Link href="/uzman?alan=dermatoloji">{t("expertLink")}</Link>
            </Button>
          ) : null}
        </section>
      ) : null}

      <Card>
        <CardHeader>
          <h2 className="text-lg font-semibold tracking-tight">{t("closingTitle")}</h2>
        </CardHeader>
        <CardContent className="space-y-2">
          <p className="text-[13px] leading-relaxed text-muted-foreground">{report.closing}</p>
          <p className="text-[11px] text-muted-foreground">{t("cosmeticNote")}</p>
          <p className="text-[11px] font-medium">{t("notMedicalAdvice")}</p>
        </CardContent>
      </Card>
    </div>
  );
}
