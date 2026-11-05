import "server-only";

import type { createAdminClient } from "@/lib/db/admin";
import { isMissingColumnError } from "@/lib/score/rowColumns";

type Admin = ReturnType<typeof createAdminClient>;

/** Glow-up bağı: istenen analiz (kullanıcının, tamamlanmış) yoksa en son tamamlanmış analiz. Görsel/landmark okunmaz. */
export async function resolveTryonAnalysisId(admin: Admin, userId: string, requested: string | null): Promise<string | null> {
  if (requested) {
    const own = await admin.from("analyses").select("id").eq("id", requested).eq("user_id", userId).eq("status", "completed").maybeSingle();
    if (own.data?.id) return String(own.data.id);
  }
  const latest = await admin.from("analyses").select("id").eq("user_id", userId).eq("status", "completed").order("created_at", { ascending: false }).limit(1).maybeSingle();
  return latest.data?.id ? String(latest.data.id) : null;
}

/** Analizin koç raporu: rapor (v1 öneriler ya da v3 metin) + plan_v2 (0013; sütun yoksa yalnız rapor). Analize bağlı satır yoksa en son satır. */
export async function loadTryonReport(admin: Admin, userId: string, analysisId: string | null): Promise<{ report: unknown; plan_v2: unknown } | null> {
  for (const scope of analysisId ? [analysisId, null] : [null]) {
    let full = admin.from("coach_reports").select("report, plan_v2").eq("user_id", userId);
    if (scope) full = full.eq("analysis_id", scope);
    const r = await full.order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (!r.error) {
      if (r.data) return { report: r.data.report, plan_v2: r.data.plan_v2 };
      continue;
    }
    if (!isMissingColumnError(r.error)) return null;
    let legacy = admin.from("coach_reports").select("report").eq("user_id", userId);
    if (scope) legacy = legacy.eq("analysis_id", scope);
    const l = await legacy.order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (l.data) return { report: l.data.report, plan_v2: null };
  }
  return null;
}
