/**
 * Bildirim teslim kaydı. `notifications.channels` kural motorunun seçtiği kanallardır (CHECK: in_app | push | email);
 * kanal başına ne olduğu `payload.delivery.<kanal>` = {status, at, detail?} alanına yazılır:
 *   sent  gönderildi (en az bir abonelik / e-posta kabul edildi); `sent_at` ilk gönderimde dolar
 *   dry   anahtar yok (VAPID / Resend): kuru çalışma, ileti günlüğe yazıldı; `sent_at` boş kalır
 *   none  alıcının aboneliği ya da e-posta adresi yok
 *   failed kalıcı hata (ayrıntı `detail`)
 * `sent_at` yalnız gerçek gönderimin zamanıdır (kuru çalışma onu doldurmaz).
 */
import type { Db } from '../db.js';

export type DeliveryChannel = 'push' | 'email';
export type DeliveryStatus = 'sent' | 'dry' | 'none' | 'failed';

export async function markDelivery(db: Db, notificationId: string, channel: DeliveryChannel, status: DeliveryStatus, detail?: string): Promise<void> {
  await db.query(
    `update public.notifications n
        set payload = n.payload || jsonb_build_object('delivery', coalesce(n.payload -> 'delivery', '{}'::jsonb)
                        || jsonb_build_object($2::text, jsonb_strip_nulls(jsonb_build_object('status', $3::text, 'at', now(), 'detail', $4::text)))),
            sent_at = case when $3 = 'sent' then coalesce(n.sent_at, now()) else n.sent_at end
      where n.id = $1::uuid`,
    [notificationId, channel, status, detail ? detail.slice(0, 200) : null],
  );
}

/** `payload.delivery.<kanal>.status` (yoksa null). */
export function deliveryStatus(payload: unknown, channel: DeliveryChannel): DeliveryStatus | null {
  const d = payload && typeof payload === 'object' ? (payload as { delivery?: Record<string, { status?: unknown }> }).delivery : undefined;
  const s = d?.[channel]?.status;
  return s === 'sent' || s === 'dry' || s === 'none' || s === 'failed' ? s : null;
}
