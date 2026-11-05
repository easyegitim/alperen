"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { TRYON_BROKEN_RATE_ALERT_DEFAULT } from "@/lib/config/ops";
import { formatRate, summarizeTryonQuality, type TryonQualityRow } from "@/lib/ops/tryonQuality";
import { istanbulDate } from "@/lib/routine/streak";
import { cn } from "@/lib/utils";

type Activity = { day: string; analyses_completed: number; analyses_failed: number; reports: number; fallback_reports: number; tryons_success: number; tryons_identity_drift: number; tryons_failed: number };
type Cost = { day: string; analysis_calls: number; reports: number; tryon_generations: number; est_cost_usd: number };
type Sub = { plan: string; active_count: number; canceling_count: number };
type Funnel = { profiles: number; adults: number; questionnaire_completed: number; analyzed_users: number; ever_checked_out: number; premium_now: number };
type Reported = { id: string; target_type: string; target_id: string | null; reason: string | null; created_at: string };
export type Metrics = {
  days: number;
  dailyActivity: Activity[];
  dailyAiCost: Cost[];
  activeSubscriptions: Sub[];
  funnel: Funnel | null;
  reportedContent: Reported[];
  /** Faz 6 (S3.3.6): ops.daily_tryon_quality; RPC yoksa [] ve available=false. */
  tryonQuality?: TryonQualityRow[];
  tryonQualityAvailable?: boolean;
  tryonBrokenRateAlert?: number;
};

const num = (n: number) => n.toLocaleString("tr-TR");
const pct = (a: number, b: number) => (b > 0 ? `%${Math.round((a / b) * 100)}` : "–");

/**
 * F18 /admin: günlük sayılar, AI maliyeti, huni, abonelikler, bildirilen içerikler (0005_ops), Faz 6 deneme kalitesi
 * ("Bozuk görünüyor" oranı; eşik üstü vurgulanır). Grafik değil tablo. `initial`: fikstür (ağ yok).
 */
export function MetricsPanel({ initial = null }: { initial?: Metrics | null }) {
  const [data, setData] = useState<Metrics | null>(initial);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (initial) return;
    let cancelled = false;
    void fetch("/api/admin/metrics?days=30", { credentials: "same-origin" })
      .then(async (r) => {
        if (!r.ok) throw new Error(String(r.status));
        return (await r.json()) as Metrics;
      })
      .then((m) => {
        if (!cancelled) setData(m);
      })
      .catch(() => {
        if (!cancelled) setError("Metrikler alınamadı.");
      });
    return () => {
      cancelled = true;
    };
  }, [initial]);

  if (error) return <p role="alert" className="text-sm text-destructive">{error}</p>;
  if (!data) return <p className="text-sm text-muted-foreground">Metrikler yükleniyor…</p>;

  const sum = (k: keyof Activity) => data.dailyActivity.reduce((s, d) => s + Number(d[k] ?? 0), 0);
  const totalCost = data.dailyAiCost.reduce((s, d) => s + Number(d.est_cost_usd ?? 0), 0);
  const f = data.funnel;
  const quality = data.tryonQuality ?? [];
  const alertAt = data.tryonBrokenRateAlert ?? TRYON_BROKEN_RATE_ALERT_DEFAULT;
  const q7 = summarizeTryonQuality(quality, istanbulDate(), 7, alertAt);

  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Son {data.days} gün</CardTitle>
          <CardDescription>Analiz, rapor ve deneme sayıları; tahmini AI maliyeti (SPEC 5.4 birim fiyatları).</CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
            <div><dt className="text-muted-foreground">Analiz tamam</dt><dd className="font-medium">{num(sum("analyses_completed"))}</dd></div>
            <div><dt className="text-muted-foreground">Analiz hata</dt><dd className="font-medium">{num(sum("analyses_failed"))}</dd></div>
            <div><dt className="text-muted-foreground">Rapor (fallback)</dt><dd className="font-medium">{num(sum("reports"))} ({num(sum("fallback_reports"))})</dd></div>
            <div><dt className="text-muted-foreground">Deneme başarı / drift / hata</dt><dd className="font-medium">{num(sum("tryons_success"))} / {num(sum("tryons_identity_drift"))} / {num(sum("tryons_failed"))}</dd></div>
            <div><dt className="text-muted-foreground">Tahmini AI maliyeti</dt><dd className="font-medium">${totalCost.toFixed(2)}</dd></div>
          </dl>
        </CardContent>
      </Card>

      {f ? (
        <Card>
          <CardHeader>
            <CardTitle>Huni</CardTitle>
            <CardDescription>Profil → 18+ → anket → analiz → ödeme (toplam).</CardDescription>
          </CardHeader>
          <CardContent>
            <table className="w-full text-sm">
              <tbody>
                {[
                  ["Profil", f.profiles, f.profiles],
                  ["18+", f.adults, f.profiles],
                  ["Anket tamam", f.questionnaire_completed, f.adults],
                  ["Analiz yapan", f.analyzed_users, f.questionnaire_completed],
                  ["Ödeme denemesi", f.ever_checked_out, f.analyzed_users],
                  ["Şu an premium", f.premium_now, f.analyzed_users],
                ].map(([label, v, base]) => (
                  <tr key={String(label)} className="border-b last:border-0">
                    <td className="py-1 text-muted-foreground">{label}</td>
                    <td className="py-1 text-right font-medium">{num(Number(v))}</td>
                    <td className="py-1 text-right text-muted-foreground">{pct(Number(v), Number(base))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Aktif abonelikler</CardTitle>
        </CardHeader>
        <CardContent>
          {data.activeSubscriptions.length === 0 ? (
            <p className="text-sm text-muted-foreground">Aktif abonelik yok.</p>
          ) : (
            <table className="w-full text-sm">
              <thead><tr className="text-left text-muted-foreground"><th className="py-1">Plan</th><th className="py-1 text-right">Aktif</th><th className="py-1 text-right">İptal planlı</th></tr></thead>
              <tbody>
                {data.activeSubscriptions.map((s) => (
                  <tr key={s.plan} className="border-b last:border-0"><td className="py-1">{s.plan}</td><td className="py-1 text-right">{num(s.active_count)}</td><td className="py-1 text-right">{num(s.canceling_count)}</td></tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Günlük</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-xs">
            <thead><tr className="text-left text-muted-foreground"><th className="py-1">Gün</th><th className="py-1 text-right">Analiz</th><th className="py-1 text-right">Hata</th><th className="py-1 text-right">Rapor</th><th className="py-1 text-right">Deneme</th><th className="py-1 text-right">Drift</th><th className="py-1 text-right">USD</th></tr></thead>
            <tbody>
              {data.dailyActivity.map((d) => {
                const c = data.dailyAiCost.find((x) => x.day === d.day);
                return (
                  <tr key={d.day} className="border-b last:border-0">
                    <td className="py-1">{d.day}</td><td className="py-1 text-right">{num(d.analyses_completed)}</td><td className="py-1 text-right">{num(d.analyses_failed)}</td><td className="py-1 text-right">{num(d.reports)}</td><td className="py-1 text-right">{num(d.tryons_success)}</td><td className="py-1 text-right">{num(d.tryons_identity_drift)}</td><td className="py-1 text-right">{c ? Number(c.est_cost_usd).toFixed(2) : "–"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Deneme kalitesi · &ldquo;Bozuk görünüyor&rdquo; oranı</CardTitle>
          <CardDescription>Bildirilen bozuk / başarılı deneme (ops.daily_tryon_quality). Eşik {formatRate(alertAt)} üstü vurgulanır. Görsel yoktur.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {data.tryonQualityAvailable === false ? (
            <p className="text-sm text-muted-foreground">Veri yok: ops_daily_tryon_quality RPC&apos;si bu ortamda uygulanmamış (migration 0015).</p>
          ) : (
            <>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
                <div>
                  <dt className="text-muted-foreground">Son 7 gün oran</dt>
                  <dd className={cn("font-semibold", q7.alert ? "text-warn" : "")} data-broken-rate-alert={q7.alert ? "1" : "0"}>
                    {formatRate(q7.brokenRate)}
                    {q7.alert ? " · eşik üstü" : ""}
                  </dd>
                </div>
                <div><dt className="text-muted-foreground">Bozuk bildirimi</dt><dd className="font-medium">{num(q7.flaggedBroken)}</dd></div>
                <div><dt className="text-muted-foreground">Başarılı</dt><dd className="font-medium">{num(q7.success)}</dd></div>
                <div><dt className="text-muted-foreground">Kalite kontrolü kaldı / drift</dt><dd className="font-medium">{num(q7.qcFailed)} / {num(q7.identityDrift)}</dd></div>
              </dl>
              {quality.length === 0 ? (
                <p className="text-sm text-muted-foreground">Bu aralıkta deneme yok.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[520px] text-xs">
                    <thead><tr className="text-left text-muted-foreground"><th className="py-1">Gün</th><th className="py-1">Mod</th><th className="py-1 text-right">Başarılı</th><th className="py-1 text-right">KK kaldı</th><th className="py-1 text-right">Drift</th><th className="py-1 text-right">Bozuk</th><th className="py-1 text-right">Oran</th></tr></thead>
                    <tbody>
                      {quality.map((r) => {
                        const rate = Number(r.broken_rate);
                        return (
                          <tr key={`${r.day}-${r.mode}`} className="border-b last:border-0">
                            <td className="py-1">{String(r.day).slice(0, 10)}</td><td className="py-1">{r.mode}</td><td className="py-1 text-right">{num(Number(r.success))}</td><td className="py-1 text-right">{num(Number(r.qc_failed))}</td><td className="py-1 text-right">{num(Number(r.identity_drift))}</td><td className="py-1 text-right">{num(Number(r.flagged_broken))}</td>
                            <td className={cn("py-1 text-right", rate > alertAt ? "font-semibold text-warn" : "")}>{formatRate(Number.isFinite(rate) ? rate : null)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Bildirilen içerikler</CardTitle>
          <CardDescription>&ldquo;Uygunsuz içerik bildir&rdquo; kayıtları (son 50). Fotoğraf veya kullanıcı kimliği yoktur.</CardDescription>
        </CardHeader>
        <CardContent>
          {data.reportedContent.length === 0 ? (
            <p className="text-sm text-muted-foreground">Bildirim yok.</p>
          ) : (
            <ul className="grid gap-2 text-sm">
              {data.reportedContent.map((r) => (
                <li key={r.id} className="rounded-md border p-2">
                  <div className="flex justify-between text-xs text-muted-foreground"><span>{r.target_type}{r.target_id ? ` · ${r.target_id.slice(0, 8)}…` : ""}</span><span>{new Date(r.created_at).toLocaleString("tr-TR")}</span></div>
                  <p className="mt-1 whitespace-pre-wrap">{r.reason ?? "(gerekçe yok)"}</p>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
