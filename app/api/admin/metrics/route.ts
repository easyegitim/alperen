import { withGuard } from "@/lib/api/guard";
import { getTryonBrokenRateAlert } from "@/lib/config/ops";
import { createAdminClient } from "@/lib/db/admin";

export const runtime = "nodejs";

/** RPC yoksa (0015 uygulanmamış ortam) metrikler çökmez: boş liste + available:false (PostgREST PGRST202 / PG 42883). */
const RPC_MISSING = new Set(["PGRST202", "42883"]);

/**
 * F18: GET /api/admin/metrics → 0005_ops görünümleri (0007 RPC ile) + bildirilen içerikler + Faz 6 deneme kalitesi
 * (ops.daily_tryon_quality, 0015 RPC; "Bozuk görünüyor" oranı, eşik CLAUDE NOTU %5). ADMIN_EMAILS dışı 404.
 */
export const GET = withGuard({ requireAdmin: true }, async ({ req }) => {
  const days = Math.min(90, Math.max(1, Number(new URL(req.url).searchParams.get("days") ?? 30) || 30));
  const admin = createAdminClient();
  const [activity, cost, subs, funnel, reported, tryonQuality] = await Promise.all([
    admin.rpc("ops_daily_activity", { p_days: days }),
    admin.rpc("ops_daily_ai_cost", { p_days: days }),
    admin.rpc("ops_active_subscriptions"),
    admin.rpc("ops_funnel"),
    admin.rpc("ops_reported_content", { p_limit: 50 }),
    admin.rpc("ops_daily_tryon_quality", { p_days: days }),
  ]);
  const firstError = [activity, cost, subs, funnel, reported].find((r) => r.error)?.error;
  if (firstError) throw new Error(`metrics rpc: ${firstError.message}`);
  if (tryonQuality.error && !RPC_MISSING.has(String(tryonQuality.error.code))) throw new Error(`metrics rpc: ${tryonQuality.error.message}`);
  return Response.json({
    days,
    dailyActivity: activity.data ?? [],
    dailyAiCost: cost.data ?? [],
    activeSubscriptions: subs.data ?? [],
    funnel: (funnel.data ?? [])[0] ?? null,
    reportedContent: reported.data ?? [],
    tryonQuality: tryonQuality.error ? [] : (tryonQuality.data ?? []),
    tryonQualityAvailable: !tryonQuality.error,
    tryonBrokenRateAlert: getTryonBrokenRateAlert(),
  });
});
