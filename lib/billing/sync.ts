// iyzico abonelik durumunu subscriptions satırına çevirir (SPEC 15.2 adım 6–9). Saf fonksiyonlar; birim testli.
import { PLANS, type SubscriptionPlanId } from "@/lib/config/plans";

/** iyzico abonelik durumları (SDK/webhook'ta görülen dizgeler; bilinmeyenler 'expired' sayılmaz, mevcut korunur). */
export type IyzicoSubscriptionStatus = "ACTIVE" | "PENDING" | "UNPAID" | "UPGRADED" | "CANCELED" | "EXPIRED" | (string & {});

export type SubscriptionRow = {
  plan: SubscriptionPlanId | "week_pass";
  status: "pending" | "active" | "past_due" | "canceled" | "expired";
  current_period_start: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
};

/** Yenileme başarısızlığında ek süre (SPEC 15.2 adım 8). */
export const PAST_DUE_GRACE_DAYS = 3;

/** Plan periyodunun sonu (iyzico dönem bitişi gelmezse yedek hesap). */
export function periodEndFor(plan: SubscriptionPlanId, start: Date): Date {
  const end = new Date(start);
  const interval = PLANS[plan].iyzicoInterval;
  if (interval === "WEEKLY") end.setUTCDate(end.getUTCDate() + 7);
  else if (interval === "MONTHLY") end.setUTCMonth(end.getUTCMonth() + 1);
  else end.setUTCFullYear(end.getUTCFullYear() + 1);
  return end;
}

export type RemoteSubscription = {
  status: IyzicoSubscriptionStatus;
  /** iyzico'dan okunabilirse geçerli dönemin başlangıcı/bitişi (ISO); yoksa null. */
  periodStart?: string | null;
  periodEnd?: string | null;
};

/**
 * Uzak durumu yerel satıra uygular. Kural: tarayıcıdan gelen hiçbir bilgi değil, yalnız iyzico'dan çekilen durum.
 * - ACTIVE → active, dönem güncellenir.
 * - UNPAID → past_due, current_period_end 3 gün uzatılır (ilk kez).
 * - CANCELED → kullanıcı iptal ettiyse (cancel_at_period_end) dönem sonuna kadar active kalır; aksi halde canceled.
 * - EXPIRED → expired. PENDING/UPGRADED/bilinmeyen → durum korunur.
 */
export function applyRemoteStatus(current: SubscriptionRow, remote: RemoteSubscription, now: Date = new Date()): SubscriptionRow {
  const next: SubscriptionRow = { ...current };
  const plan = current.plan === "week_pass" ? null : current.plan;
  switch (remote.status) {
    case "ACTIVE": {
      next.status = "active";
      const start = remote.periodStart ? new Date(remote.periodStart) : (current.current_period_start ? new Date(current.current_period_start) : now);
      const end = remote.periodEnd ? new Date(remote.periodEnd) : plan ? periodEndFor(plan, start) : current.current_period_end ? new Date(current.current_period_end) : now;
      next.current_period_start = start.toISOString();
      next.current_period_end = end.toISOString();
      break;
    }
    case "UNPAID": {
      if (current.status !== "past_due") {
        const base = current.current_period_end ? new Date(current.current_period_end) : now;
        const extended = new Date(Math.max(base.getTime(), now.getTime()) + PAST_DUE_GRACE_DAYS * 86_400_000);
        next.current_period_end = extended.toISOString();
      }
      next.status = "past_due";
      break;
    }
    case "CANCELED": {
      const endsLater = current.current_period_end ? new Date(current.current_period_end) > now : false;
      if (current.cancel_at_period_end && endsLater && current.status === "active") next.status = "active";
      else next.status = "canceled";
      break;
    }
    case "EXPIRED":
      next.status = "expired";
      break;
    default:
      break;
  }
  return next;
}

/** payment_events.event_key: aynı bildirim iki kez işlenmez. */
export function webhookEventKey(payload: Record<string, unknown>): string {
  const parts = ["iyziEventType", "subscriptionReferenceCode", "orderReferenceCode", "paymentId", "iyziEventTime", "token", "iyziReferenceCode"]
    .map((k) => (payload[k] === undefined ? "" : String(payload[k])))
    .join("|");
  return parts.replace(/\|+$/, "") || JSON.stringify(payload);
}
