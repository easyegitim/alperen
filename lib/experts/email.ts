import "server-only";

import type { ReferralStatus } from "./refCode";
import { signStatusLink } from "./refCode";
import { APP_NAME, APP_URL } from "@/lib/config/app";
import { ClientSignals } from "@/lib/score/contract";

/**
 * Partner özeti: yalnız izinli gözlemler ve değerlendirilmiş bakım alt skorları. Genel skor ve potansiyel gitmez
 * (hybrid.v1'de genelin %40'ı yapısaldır; potansiyel ücretsizde kilitlidir ve sunucudan çıkmaz); yüz şekli de gitmez
 * (SPEC 12.3 "yüz şekli yargısı asla gitmez").
 */
export type AnalysisSummary = {
  subscores: Record<string, number> | null;
  observations: Record<string, string> | null;
};

/**
 * engine spec §8 (F19, veri en aza indirme): partnere yalnız bu gözlem anahtarları ve yalnız değerlendirilmiş bakım alt
 * skorları gider. Yapısal skor (harmony, eyes, jawline), yapısal metin, oran veya fotoğraf koşulu asla gitmez: estetik
 * cerrahi kategorisi olan bir ağda yapısal bir "sapma" notu cerrahi satış yönlendirmesi olurdu (CLAUDE.md).
 */
export const EXPERT_OBS_KEYS = ["skin", "hair", "brows", "facialHair"] as const;
export const EXPERT_SUB_KEYS = ["skin", "hair", "grooming"] as const;

/** Partner özeti için okunan satır (eski ve hybrid.v1 satırları). */
export type ExpertSummaryRow = {
  subscores: unknown;
  observations: unknown;
  engine_version?: string | null;
  signals?: unknown;
};

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Satırdan izin listesine göre en az özet (her satır için, eski satırlar dahil). hybrid.v1'de değerlendirilmeyen alan
 * (hariç tutulan veya bu çekimde görünmeyen; saklanan değer referansla doldurulmuştur) gönderilmez. Saf.
 */
export function expertAnalysisSummary(row: ExpertSummaryRow): AnalysisSummary {
  const skipped = new Set<string>();
  if (row.engine_version === "hybrid.v1") {
    const s = ClientSignals.safeParse(row.signals);
    // Sinyal ayrıştırılamıyorsa hangi alanın değerlendirildiği bilinemez: bakım skoru gönderilmez.
    if (s.success) s.data.notAssessed.forEach((n) => skipped.add(n.sub));
    else EXPERT_SUB_KEYS.forEach((k) => skipped.add(k));
  }
  const subs: Record<string, number> = {};
  if (isRecord(row.subscores)) {
    for (const k of EXPERT_SUB_KEYS) {
      const v = row.subscores[k];
      if (!skipped.has(k) && typeof v === "number" && Number.isFinite(v)) subs[k] = v;
    }
  }
  const obs: Record<string, string> = {};
  if (isRecord(row.observations)) {
    for (const k of EXPERT_OBS_KEYS) {
      const v = row.observations[k];
      if (typeof v === "string" && v.trim()) obs[k] = v;
    }
  }
  return {
    subscores: Object.keys(subs).length ? subs : null,
    observations: Object.keys(obs).length ? obs : null,
  };
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Partnere giden e-posta: ad, iletişim, mesaj, (rızayla) analiz özeti — fotoğraf ASLA. Durum linkleri imzalıdır. */
export function partnerRequestEmail(input: {
  partnerName: string;
  refCode: string;
  specialty: string;
  contact: string;
  name: string;
  message: string | null;
  summary: AnalysisSummary | null;
}): { subject: string; html: string } {
  const link = (status: ReferralStatus, label: string) =>
    `<a href="${APP_URL}/api/experts/requests/${encodeURIComponent(input.refCode)}/status?status=${status}&sig=${signStatusLink(input.refCode, status)}">${label}</a>`;
  const summary = input.summary
    ? `<h3>Analiz özeti (kullanıcının rızasıyla; fotoğraf paylaşılmaz)</h3>
<ul>
<li>Alt skorlar: ${esc(JSON.stringify(input.summary.subscores ?? {}))}</li>
<li>Gözlemler: ${esc(JSON.stringify(input.summary.observations ?? {}))}</li>
</ul>`
    : "<p>Kullanıcı analiz özetini paylaşmadı.</p>";
  return {
    subject: `${APP_NAME} ön görüşme talebi · ${input.refCode}`,
    html: `<h2>Yeni ön görüşme talebi</h2>
<p>Sayın ${esc(input.partnerName)}, ${APP_NAME} üzerinden <strong>${esc(input.specialty)}</strong> alanında bir ön görüşme talebi aldınız.</p>
<ul>
<li>Referans: <strong>${esc(input.refCode)}</strong></li>
<li>Ad: ${esc(input.name)}</li>
<li>İletişim: ${esc(input.contact)}</li>
<li>Mesaj: ${esc(input.message ?? "-")}</li>
</ul>
${summary}
<p>Durumu güncelle: ${link("contacted", "İletişime geçildi")} · ${link("booked", "Randevu verildi")} · ${link("completed", "Tamamlandı")} · ${link("cancelled", "İptal")}</p>
<p style="color:#666;font-size:12px">Bu e-posta ${APP_NAME} tarafından otomatik gönderildi. Kullanıcı verisi yalnız bu talep için kullanılabilir; üçüncü kişilerle paylaşılamaz.</p>`,
  };
}
