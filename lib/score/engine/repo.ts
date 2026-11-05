import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { AiUsage } from "./types";
import type { CachedSetRow } from "./setCache";

// hybrid.v2 iş deposu: jobs.ts bu dar arayüzle yazar; gerçek uygulama service-role istemcisi (lib/db/admin.ts), testte
// bellek içi sahte. Fotoğraf ve landmark hiçbir çağrıda geçmez (yalnız sayılar, denetimli metin, HMAC anahtarı).

export type ReportRow = {
  user_id: string;
  analysis_id: string;
  model: string;
  prompt_version: string;
  report: unknown;
  is_fallback: boolean;
  safety_flags: string[];
  input_tokens: number | null;
  output_tokens: number | null;
  ai_usage: AiUsage | null;
};

export type AnalysisRepo = {
  updateAnalysis(id: string, patch: Record<string, unknown>): Promise<void>;
  insertReport(row: ReportRow): Promise<void>;
  /** Bu kullanıcının süresi dolmamış set satırı; yoksa null. Başka kullanıcının satırı asla dönmez (set hash'i istemci beyanıdır). */
  lookupSet(setKey: string, userId: string, nowIso: string): Promise<CachedSetRow | null>;
  storeSet(row: Pick<CachedSetRow, "set_key" | "user_id" | "scores" | "model" | "prompt_version" | "calibration_version">): Promise<void>;
};

export function createAnalysisRepo(admin: SupabaseClient): AnalysisRepo {
  return {
    async updateAnalysis(id, patch) {
      const { error } = await admin.from("analyses").update(patch).eq("id", id);
      if (error) throw new Error(`analyses update failed: ${error.code ?? "?"}`);
    },
    async insertReport(row) {
      const { error } = await admin.from("coach_reports").insert(row);
      if (error) throw new Error(`coach_reports insert failed: ${error.code ?? "?"}`);
    },
    async lookupSet(setKey, userId, nowIso) {
      // user_id filtresi zorunlu: sourceHashes sunucuda görsellerle doğrulanmaz; başkasının hash listesiyle onun skoru ve raporu alınamaz.
      const { data } = await admin.from("analysis_sets").select("set_key, user_id, scores, model, prompt_version, calibration_version, created_at, expires_at").eq("set_key", setKey).eq("user_id", userId).gt("expires_at", nowIso).maybeSingle();
      return (data as CachedSetRow | null) ?? null;
    },
    async storeSet(row) {
      // set_key birincil anahtar: aynı set başka kullanıcıdan daha önce geldiyse bu kayıt atlanır (o kullanıcı önbellekten
      // yararlanmaz; başkasının sonucu asla ona verilmez). Çakışma hata değildir.
      const { error } = await admin.from("analysis_sets").upsert(row, { onConflict: "set_key", ignoreDuplicates: true });
      if (error) console.warn(`[engine.v2] analysis_sets upsert failed: ${error.code ?? "?"}`);
    },
  };
}
