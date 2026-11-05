import { z } from 'zod';
import { markDelivery } from '../notifications/delivery.js';
import { PermanentJobError } from './errors.js';
import { acceptCamelAliases, uuid } from './schemas.js';
import type { JobDefinition } from './types.js';

const payload = acceptCamelAliases(
  { notificationId: 'notification_id', userId: 'user_id' },
  z
  .object({
    /** Var olan bildirim (alıcı, başlık, gövde, bağlantı ondan okunur). */
    notification_id: uuid.optional(),
    /** Doğrudan gönderim. */
    user_id: uuid.optional(),
    title: z.string().min(1).max(200).optional(),
    body: z.string().max(1000).optional(),
    url: z.string().max(500).optional(),
    tag: z.string().max(64).optional(),
  })
  .refine((p) => p.notification_id || (p.user_id && p.title), { message: 'notification_id ya da user_id+title gerekli' }),
);

export interface PushSendResult {
  subscriptions: number;
  sent: number;
  removed: number;
  failed: number;
  skipped?: string;
}

/**
 * Web-push gönderimi (P6). Bildirim satırından (kural motoru: `emit_notification` push kanalı ve abonelik varsa
 * aynı işlemde atar) ya da doğrudan kullanıcıdan abonelikleri okur, VAPID ile gönderir; 404/410 abonelikleri siler.
 * Teslim `payload.delivery.push`'a yazılır (notifications/delivery.ts): en az biri gittiyse `sent` (+ `sent_at`),
 * abonelik yoksa `none`. VAPID anahtarı yoksa kuru çalışma: ileti günlüğe yazılır (uç nokta yalnız ana makine adıyla),
 * teslim `dry` olur ve `sent_at` boş kalır; anahtar gelince kod değişmeden gerçek gönderim başlar.
 */
export const pushSendJob: JobDefinition<z.infer<typeof payload>, PushSendResult> = {
  name: 'push.send',
  description: 'Web-push (VAPID) gönderimi; geçersiz abonelikleri temizler.',
  process: 'worker',
  payload,
  concurrency: 4,
  retry: { retryLimit: 5, retryDelay: 10, retryBackoff: true, retryDelayMax: 900, expireInSeconds: 120, deleteAfterSeconds: 86_400 },
  handler: async (p, ctx) => {
    let userId = p.user_id ?? null;
    let title = p.title ?? '';
    let body = p.body ?? '';
    let url = p.url;
    let tag = p.tag;
    if (p.notification_id) {
      const r = await ctx.db.query(
        `select recipient_id, kind, title, body, channels, payload ->> 'url' as url from public.notifications where id = $1::uuid`,
        [p.notification_id],
      );
      const n = r.rows[0];
      if (!n) throw new PermanentJobError(`bildirim yok: ${p.notification_id}`, 'OGR-PUSH-002');
      if (!Array.isArray(n.channels) || !n.channels.includes('push')) {
        return { subscriptions: 0, sent: 0, removed: 0, failed: 0, skipped: 'kanal push değil' };
      }
      userId = String(n.recipient_id);
      title = p.title ?? String(n.title);
      body = p.body ?? (n.body === null ? '' : String(n.body));
      url = p.url ?? (typeof n.url === 'string' ? n.url : undefined);
      tag = p.tag ?? String(n.kind);
    }
    if (!userId) throw new PermanentJobError('alıcı yok', 'OGR-PUSH-003');

    const subs = await ctx.db.query('select id, endpoint, p256dh, auth from public.push_subscriptions where user_id = $1::uuid order by created_at', [userId]);
    if (subs.rows.length === 0) {
      if (p.notification_id) await markDelivery(ctx.db, p.notification_id, 'push', 'none', 'abonelik yok');
      return { subscriptions: 0, sent: 0, removed: 0, failed: 0 };
    }
    if (!ctx.push.configured) {
      // Kuru çalışma (VAPID yok): ne gönderileceği günlükte görünür; uç nokta adresi sır sayılır, yalnız ana makine yazılır.
      const hosts = subs.rows.map((row) => {
        try {
          return new URL(String(row.endpoint)).host;
        } catch {
          return '?';
        }
      });
      // Başlık ve metin günlüğe yazılmaz (ad ve durum PII): yalnız uzunluklar.
      ctx.log.info('push.send kuru çalışma (VAPID yok)', {
        notification: p.notification_id ?? null,
        title_length: title.length,
        body_length: body.length,
        url: url ?? '/',
        hosts,
      });
      if (p.notification_id) await markDelivery(ctx.db, p.notification_id, 'push', 'dry');
      return { subscriptions: subs.rows.length, sent: 0, removed: 0, failed: 0, skipped: 'dry-run' };
    }

    let sent = 0;
    let removed = 0;
    let failed = 0;
    let retryable = 0;
    let lastMessage = '';
    for (const row of subs.rows) {
      const out = await ctx.push.send({ endpoint: String(row.endpoint), p256dh: String(row.p256dh), auth: String(row.auth) }, { title, body, url, tag });
      if (out.ok) {
        sent++;
      } else if (out.gone) {
        removed++;
        await ctx.db.query('delete from public.push_subscriptions where id = $1::uuid', [row.id]);
      } else {
        failed++;
        if (out.retryable) retryable++;
        lastMessage = `${out.status ?? 'ağ'}: ${out.message}`;
      }
    }
    if (sent > 0 && p.notification_id) await markDelivery(ctx.db, p.notification_id, 'push', 'sent');
    else if (sent === 0 && retryable === 0 && p.notification_id) await markDelivery(ctx.db, p.notification_id, 'push', removed > 0 && failed === 0 ? 'none' : 'failed', lastMessage || 'abonelikler geçersiz');
    // Hiçbiri gitmediyse ve hata geçiciyse yeniden dene (kalan geçerli abonelikler için).
    if (sent === 0 && retryable > 0) throw new Error(`push gönderilemedi (${lastMessage})`);
    ctx.log.info('push.send', { subscriptions: subs.rows.length, sent, removed, failed });
    return { subscriptions: subs.rows.length, sent, removed, failed };
  },
};
