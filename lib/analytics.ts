// SPEC 17.1 olay adları. PostHog yalnız çerez onayı "granted" iken ve yalnız tarayıcıda çalışır
// (components/providers/AnalyticsProvider.tsx). Sunucuda track() no-op'tur.
// Kural: olaylara fotoğraf, skor, metrik, e-posta eklenmez; tip sistemi bunu zorlar.
// İstemci yapısal tiptedir: web posthog-js, mobil posthog-react-native aynı arayüzü sağlar.
import type { MethodFrom } from "@/lib/config/method";

export type AnalyticsEvents = {
  landing_cta_clicked: undefined;
  anon_session_started: undefined;
  age_blocked: undefined;
  consent_updated: { type: string; granted: boolean };
  questionnaire_completed: undefined;
  capture_started: { source: "camera" | "gallery" };
  capture_quality_failed: { reason: string };
  capture_succeeded: { attempts: number };
  analysis_completed: { tier: "free" | "premium" };
  analysis_failed: { reason: string };
  paywall_viewed: { trigger: string; teaserMode: string };
  account_linked: { method: "email" | "google" | "apple" };
  // v2 ödeme öncesi akış (CONTRACTS_V2 §8): yalnız adım adları, açı adları ve sayılar; bant, cinsiyet, e-posta, skor yok.
  sign_in_started: { method: "google" | "apple" | "email" };
  onboarding_step_completed: { step: "age" | "age_under18_soon" | "gender" | "account" | "consents" };
  /** view: ViewKey; source: kamera/galeri. */
  capture_view_captured: { view: string; source: "camera" | "gallery" };
  /** Galeriden çoklu seçim: kaç dosya seçildi, kaçı bir açıya yerleşti. */
  capture_gallery_batch: { selected: number; assigned: number };
  /** Kalite pop-up'ı (KB R1-E12): yalnız cevap. */
  capture_quality_prompt: { answer: "yes" | "no" };
  /** Cihaz analizi gönderildi: açı adları virgülle (ör. "front,profile_left"), sayı. */
  device_analysis_submitted: { views: string; count: number; hashed: boolean };
  device_analysis_completed: undefined;
  /** Ödeme sonrası fotoğraf seti gönderildi (POST /api/analyses/[id]/run): açı adları ve sayı; resume = çekime dönüş. */
  full_analysis_submitted: { views: string; count: number; hashed: boolean; resume: boolean };
  referral_code_viewed: undefined;
  referral_claimed: { ok: boolean };
  checkout_started: { plan: string };
  subscription_activated: { plan: string };
  /** F14 v2: tek seferlik rapor ödemesi sunucuda doğrulandı (ürün adı; analiz kimliği, fiyat yok). */
  purchase_completed: { product: string };
  subscription_canceled: { plan: string };
  report_viewed: undefined;
  tryon_started: { presetKind: "hair" | "beard" | "color" };
  tryon_result: { status: string; durationMs: number };
  share_card_created: { withPhoto: boolean };
  routine_checked: { kind: "step" | "exercise" | "habit" };
  expert_request_sent: { specialty: string };
  feedback_sent: { targetType: string; rating: number | null };
  account_deletion_requested: undefined;
  // UI spec §8.2 (kapalı liste): skor, değer, kaldıraç, fotoğraf, metrik, e-posta yok.
  result_viewed: { tier: "free" | "premium"; overlay: "photo" | "schematic"; legacy: boolean };
  overlay_opened: { source: "photo" | "schematic" };
  method_viewed: { from: MethodFrom };
  paywall_step_viewed: { step: "plans"; trigger: string };
  paywall_plan_selected: { plan: "weekly" | "monthly" | "yearly" | "week_pass" | "one_time_report" };
  paywall_dismissed: { step: "benefits" | "plans" };
  capture_manual_offered: undefined;
  /** issue: QualityIssue kodu. */
  capture_manual_used: { issue: string };
  improve_first_clicked: { position: 1 | 2 | 3 };
  plan_basis_edit_clicked: undefined;
  // Sprint 2 (CONTRACTS_V2 Sprint 2): YALNIZ olay adı, yük yok — adım kimliği, bölge, skor, mod, fotoğraf, plan içeriği eklenmez.
  plan_viewed: undefined;
  plan_step_opened: undefined;
  questionnaire_v2_completed: undefined;
  tryon_combo_started: undefined;
  tryon_qc_failed: undefined;
  tryon_flagged_broken: undefined;
  glowup_viewed: undefined;
};

/** Sprint 2 olayları (yüksüz); testler ve mobil eşitlik bu listeyi kullanır. */
export const SPRINT2_EVENTS = ["plan_viewed", "plan_step_opened", "questionnaire_v2_completed", "tryon_combo_started", "tryon_qc_failed", "tryon_flagged_broken", "glowup_viewed"] as const satisfies readonly AnalyticsEventName[];

export type AnalyticsEventName = keyof AnalyticsEvents;

/** Olay özelliklerinde yasak anahtarlar (savunma: tip dışı çağrılara karşı çalışma zamanı filtresi). */
const FORBIDDEN_PROP = /^(image|photo|selfie|landmarks|points|email|overall|potential|subscores|metrics|geometry|score)$/i;

export function sanitizeProps(props: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!props) return undefined;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(props)) {
    if (FORBIDDEN_PROP.test(k)) continue;
    if (typeof v === "string" && v.length > 200) continue;
    if (v !== null && typeof v === "object") continue;
    out[k] = v;
  }
  return out;
}

export type AnalyticsClient = {
  capture(event: string, properties?: Record<string, unknown>): unknown;
  getFeatureFlag(flag: string): unknown;
};

let client: AnalyticsClient | null = null;

/** AnalyticsProvider (web: çerez onayı, mobil: analitik izni) bağlar/çözer. */
export function setAnalyticsClient(c: AnalyticsClient | null): void {
  client = c;
}

export function isAnalyticsEnabled(): boolean {
  return client !== null;
}

export function track<E extends AnalyticsEventName>(
  ...args: AnalyticsEvents[E] extends undefined ? [event: E] : [event: E, props: AnalyticsEvents[E]]
): void {
  if (!client) return;
  const [event, props] = args as [E, Record<string, unknown> | undefined];
  try {
    client.capture(event, sanitizeProps(props));
  } catch {
    // analitik hiçbir akışı bozmaz
  }
}

/** Teaser A/B bayrağı (PostHog feature flag "teaser_mode"). Sunucu tarafı mod TEASER_MODE ortam değişkenidir;
 *  bayrak yalnız deney kaydı için okunur ve olaylara "teaserVariant" olarak eklenir. */
export function getTeaserVariant(): string | null {
  if (!client) return null;
  const v = client.getFeatureFlag("teaser_mode");
  return typeof v === "string" ? v : null;
}
