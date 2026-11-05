import { z } from "zod";

// Ödeme sonrası dönülecek analiz (UI spec §4.2, F14). Saf fonksiyon: veritabanı okumaları çağıranda yapılır.
// Yalnız yönlendirme hedefini seçer; premium açma kararıyla hiçbir ilgisi yoktur (o yalnız iyzico doğrulamasından gelir).

const Uuid = z.uuid();

export function isUuid(v: unknown): v is string {
  return typeof v === "string" && Uuid.safeParse(v).success;
}

/** Aday analiz satırı (admin istemciyle `id, user_id, status` seçilir). */
export type CandidateRow = { id: string; user_id: string; status: string } | null;

/**
 * Önce checkout'ta gönderilen analiz: geçerli uuid, satır bulundu, aynı kullanıcıya ait ve tamamlanmış olmalı.
 * Değilse kullanıcının en son tamamlanan analizi; o da yoksa undefined.
 */
export function pickReturnAnalysis(candidate: unknown, candidateRow: CandidateRow, latestId: unknown, userId: string): string | undefined {
  if (isUuid(candidate) && candidateRow && candidateRow.id === candidate && candidateRow.user_id === userId && candidateRow.status === "completed") {
    return candidate;
  }
  return isUuid(latestId) ? latestId : undefined;
}

/** payment_events.payload'dan güvenle okunan alanlar (eski satırlarda analysisId yoktur). */
export function readCheckoutPayload(raw: unknown): { userId?: string; plan?: string; analysisId?: string; purchaseId?: string } {
  if (!raw || typeof raw !== "object") return {};
  const r = raw as Record<string, unknown>;
  return {
    userId: typeof r.userId === "string" && r.userId ? r.userId : undefined,
    plan: typeof r.plan === "string" && r.plan ? r.plan : undefined,
    analysisId: isUuid(r.analysisId) ? r.analysisId : undefined,
    /** one_time_report (F14 v2): bekleyen purchases satırı; callback paid/failed yazar. */
    purchaseId: isUuid(r.purchaseId) ? r.purchaseId : undefined,
  };
}
