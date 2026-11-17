// Uzman Ağı (SPEC 12.3 / SPEC-MOBILE M8) saf yardımcılar; birim testli. API sözleşmesi app/api/experts ile aynı.
import { EXPERT_SPECIALTIES } from "@/content/expert-specialties";
import type { ClientAnalysisSummary } from "@/lib/score/present";

export type Partner = {
  id: string;
  name: string;
  kind: string;
  specialties: string[];
  city: string;
  institution: string | null;
  license_no: string;
  verified_at: string | null;
};

export type RequestForm = { name: string; contact: string; message: string };

export const SPECIALTY_IDS = EXPERT_SPECIALTIES.map((s) => s.id);

export function specialtyName(id: string): string {
  return EXPERT_SPECIALTIES.find((s) => s.id === id)?.nameTr ?? id;
}

/** GET /api/experts?specialty&city — boş filtreler gönderilmez; şehir kırpılır. */
export function buildExpertsPath(specialty: string, city: string): string {
  const params = new URLSearchParams();
  if (specialty && SPECIALTY_IDS.includes(specialty)) params.set("specialty", specialty);
  const c = city.trim();
  if (c) params.set("city", c.slice(0, 60));
  const q = params.toString();
  return q ? `/api/experts?${q}` : "/api/experts";
}

/** Sunucudaki Zod şemasının istemci yansıması (ad 2–80, iletişim 5–120, mesaj ≤ 600). Hata anahtarı döner. */
export function validateRequestForm(f: RequestForm): "name" | "contact" | "message" | null {
  const name = f.name.trim();
  const contact = f.contact.trim();
  if (name.length < 2 || name.length > 80) return "name";
  if (contact.length < 5 || contact.length > 120) return "contact";
  if (f.message.trim().length > 600) return "message";
  return null;
}

export function toRequestBody(partnerId: string, f: RequestForm, shareAnalysisId: string | null) {
  const message = f.message.trim();
  return { partnerId, name: f.name.trim(), contact: f.contact.trim(), message: message || undefined, shareAnalysisId: shareAnalysisId ?? undefined };
}

/** Son tamamlanmış analiz (liste zaten tarih sırasına göre). */
export function latestCompletedAnalysisId(list: Pick<ClientAnalysisSummary, "id" | "status">[] | null | undefined): string | null {
  return list?.find((a) => a.status === "completed")?.id ?? null;
}
