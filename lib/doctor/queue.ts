import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { DoctorItem, DoctorStatus } from "./types";
import { DoctorItems, validateDoctorItems } from "./types";
import { deliverableItems, type DoctorRowLike } from "./rules";

// Hekim inceleme kuyruğu (migration 0013 doctor_recommendations; RLS açık, tarayıcı politikası YOK). Yalnız service role.
// Kullanıcı kanalı: userDeliverable (physician_reviewed/delivered yalnız physician_items) + markDelivered (RPC, DB kuralı).
// Hekim kanalı: listQueue / review (admin rotası). Taslak kullanıcıya hiçbir fonksiyondan dönmez.

export type DoctorRow = DoctorRowLike & {
  id: string;
  user_id: string;
  analysis_id: string;
  report_id: string | null;
  ai_model: string;
  ai_prompt_version: string;
  physician_id: string | null;
  physician_notes: string | null;
  reviewed_at: string | null;
  delivered_at: string | null;
  created_at: string;
};

const COLS = "id, user_id, analysis_id, report_id, status, ai_items, ai_model, ai_prompt_version, physician_items, physician_id, physician_notes, reviewed_at, delivered_at, created_at";

export async function insertDraft(admin: SupabaseClient, row: { user_id: string; analysis_id: string; report_id: string | null; ai_items: DoctorItem[]; ai_model: string; ai_prompt_version: string }): Promise<string> {
  const items = DoctorItems.parse(row.ai_items);
  const { data, error } = await admin.from("doctor_recommendations").insert({ ...row, ai_items: items, status: "draft" }).select("id").single();
  if (error || !data) throw new Error(`doctor_recommendations insert failed: ${error?.code ?? "?"}`);
  return String(data.id);
}

/** Kullanıcının bu analiz için satırları (yalnız durum ve hekim öğeleri; taslak içerik sunucuda kalır). */
export async function userRows(admin: SupabaseClient, userId: string, analysisId: string): Promise<Pick<DoctorRow, "id" | "status" | "physician_items" | "reviewed_at">[]> {
  const { data } = await admin.from("doctor_recommendations").select("id, status, physician_items, reviewed_at").eq("user_id", userId).eq("analysis_id", analysisId).order("created_at", { ascending: false });
  return (data ?? []).map((r) => ({ id: String(r.id), status: r.status as DoctorStatus, physician_items: r.physician_items, reviewed_at: r.reviewed_at ? String(r.reviewed_at) : null }));
}

/** Kullanıcıya gidebilecek öğeler (hekim onaylı); varsa teslim RPC'si çağrılır (physician_reviewed → delivered, DB kuralı). */
export async function userDeliverable(admin: SupabaseClient, userId: string, analysisId: string): Promise<{ items: DoctorItem[]; reviewedAt: string | null; rows: Pick<DoctorRow, "status">[] }> {
  const rows = await userRows(admin, userId, analysisId);
  const row = rows.find((r) => deliverableItems(r).length > 0);
  if (!row) return { items: [], reviewedAt: null, rows };
  if (row.status === "physician_reviewed") {
    const { error } = await admin.rpc("deliver_doctor_recommendation", { p_id: row.id, p_user: userId });
    if (error) console.warn(`[doctor] deliver rpc failed: ${error.code ?? "?"}`);
  }
  return { items: deliverableItems(row), reviewedAt: row.reviewed_at, rows };
}

export async function listQueue(admin: SupabaseClient, status?: DoctorStatus): Promise<DoctorRow[]> {
  let q = admin.from("doctor_recommendations").select(COLS).order("created_at", { ascending: true }).limit(100);
  if (status) q = q.eq("status", status);
  const { data } = await q;
  return (data ?? []) as DoctorRow[];
}

export type ReviewInput = { id: string; decision: "physician_reviewed" | "rejected"; physicianId: string; items: DoctorItem[]; notes?: string | null; knownMethodIds: ReadonlySet<string> | null };

/** Bu analiz için reddedilmemiş bir satır (taslak, onaylı ya da teslim edilmiş) var mı: taslak tekrarı önlenir. */
export async function hasActiveDoctorRow(admin: SupabaseClient, userId: string, analysisId: string): Promise<boolean> {
  const rows = await userRows(admin, userId, analysisId);
  return rows.some((r) => r.status !== "rejected");
}

/**
 * Hekim kararı (admin rotası): onayda physician_items zorunlu ve doğrulanır (doz/marka/satış/izinsiz alan → ret); reddetme
 * öğesiz. Herhangi bir öğe kurala takılırsa HİÇBİR ŞEY yazılmaz (ok:false + issues): hekim metni düzeltip yeniden gönderir;
 * sessizce eksilmiş bir liste "onaylandı" diye kullanıcıya gitmez. Yalnız draft ya da daha önce incelenmiş satır değişir.
 */
export async function reviewRecommendation(admin: SupabaseClient, input: ReviewInput): Promise<{ ok: boolean; issues: ReturnType<typeof validateDoctorItems>["issues"] }> {
  const now = new Date().toISOString();
  if (input.decision === "rejected") {
    const { error } = await admin.from("doctor_recommendations").update({ status: "rejected", physician_id: input.physicianId, physician_notes: input.notes ?? null, reviewed_at: now }).eq("id", input.id).in("status", ["draft", "physician_reviewed"]);
    return { ok: !error, issues: [] };
  }
  const { valid, issues } = validateDoctorItems(input.items, input.knownMethodIds);
  if (valid.length === 0 || issues.length > 0) return { ok: false, issues };
  const { error } = await admin
    .from("doctor_recommendations")
    .update({ status: "physician_reviewed", physician_items: valid, physician_id: input.physicianId, physician_notes: input.notes ?? null, reviewed_at: now })
    .eq("id", input.id)
    .in("status", ["draft", "physician_reviewed"]);
  return { ok: !error, issues };
}
