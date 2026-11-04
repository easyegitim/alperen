"use client";

import { FileText } from "lucide-react";
import { useTranslations } from "next-intl";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import type { ReportV3 } from "@/lib/score/contract";

/** Rapor v3 iskeleti (KB §5): mektup, bölge bölge (güçlü yan → görülen → ≤2 fırsat; "değişiklik gerekmez"), kapanış. */
export function ReportCard({ report }: { report: ReportV3 | null }) {
  const tr = useTranslations("analysis.result.report");
  const trr = useTranslations("analysis.result");
  const tc = useTranslations("common");
  const treg = useTranslations("analysis.result.region");
  return (
    <Card>
      <CardHeader>
        <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight">
          <FileText aria-hidden="true" className="size-4 text-brand" />
          {tr("title")}
        </h2>
      </CardHeader>
      <CardContent className="space-y-4">
        {!report ? (
          <p className="text-sm text-muted-foreground">{trr("missing")}</p>
        ) : (
          <>
            <p className="text-[14px] leading-relaxed">{report.letter}</p>
            {report.regions.length ? (
              <section className="space-y-2">
                <h3 className="eyebrow">{tr("regionsTitle")}</h3>
                <ul className="space-y-2">
                  {report.regions.map((r) => (
                    <li key={r.key} className="space-y-1 rounded-xl bg-muted/40 p-3 text-[13px] leading-relaxed">
                      <p className="font-semibold">{treg(r.key)}</p>
                      <p>
                        <span className="text-muted-foreground">{tr("strength")}: </span>
                        {r.strength}
                      </p>
                      <p>
                        <span className="text-muted-foreground">{tr("seen")}: </span>
                        {r.seen}
                      </p>
                      {r.improvements.length ? (
                        <div>
                          <span className="text-muted-foreground">{tr("improvements")}: </span>
                          <ul className="list-disc pl-4">
                            {r.improvements.map((s, i) => (
                              <li key={i}>{s}</li>
                            ))}
                          </ul>
                        </div>
                      ) : (
                        <p className="text-muted-foreground">{tr("noChange")}</p>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
            <section className="space-y-1">
              <h3 className="eyebrow">{tr("closingTitle")}</h3>
              <p className="text-[13px] leading-relaxed text-muted-foreground">{report.closing}</p>
              <p className="text-[11px] text-muted-foreground">{tc("notMedicalAdvice")}</p>
            </section>
          </>
        )}
      </CardContent>
    </Card>
  );
}
