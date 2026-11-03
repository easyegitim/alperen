import { z } from 'zod';
import { PermanentJobError } from './errors.js';
import { uuid } from './schemas.js';
import type { JobDefinition } from './types.js';

const payload = z
  .object({
    /** Var olan bildirim (alıcı, başlık, gövde, bağlantı ondan okunur). */
    notificationId: uuid.optional(),
    /** Doğrudan gönderim. */
    userId: uuid.optional(),
    title: z.string().min(1).max(200).optional(),
    body: z.string().max(1000).optional(),
    url: z.string().max(500).optional(),
    tag: z.string().max(64).optional(),
  })
  .refine((p) => p.notificationId || (p.userId && p.title), { message: 'notificationId ya da userId+title gerekli' });

export interface PushSendResult {
  subscriptions: number;
  sent: number;
  removed: number;
  failed: number;
  skipped?: string;
}

/**
 * İSKELET (P6): web-push gönderimi. Bildirim satırından ya da doğrudan kullanıcıdan abonelikleri okur, VAPID ile
 * gönderir; 404/410 abonelikleri siler; en az biri gittiyse `notifications.sent_at` yazar. Kural motoru, sessiz
 * saatler ve e-posta kanalı P6'da eklenir.
 */
export const pushSendJob: JobDefinition<z.infer<typeof payload>, PushSendResult> = {
  name: 'push.send',
  description: 'Web-push (VAPID) gönderimi; geçersiz abonelikleri temizler.',
  process: 'worker',
  payload,
  concurrency: 4,
  retry: { retryLimit: 5, retryDelay: 10, retryBackoff: true, retryDelayMax: 900, expireInSeconds: 120, deleteAfterSeconds: 86_400 },
  skeleton: true,
  handler: async (p, ctx) => {
    let userId = p.userId ?? null;
    let title = p.title ?? '';
    let body = p.body ?? '';
    let url = p.url;
    let tag = p.tag;
    if (p.notificationId) {
      const r = await ctx.db.query(
        `select recipient_id, kind, title, body, channels, payload ->> 'url' as url from public.notifications where id = $1::uuid`,
        [p.notificationId],
      );
      const n = r.rows[0];
      if (!n) throw new PermanentJobError(`bildirim yok: ${p.notificationId}`, 'OGR-PUSH-002');
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
    if (subs.rows.length === 0) return { subscriptions: 0, sent: 0, removed: 0, failed: 0 };
    if (!ctx.push.configured) {
      throw new PermanentJobError('VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT tanımlı değil', 'OGR-PUSH-001');
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
    if (sent > 0 && p.notificationId) {
      await ctx.db.query('update public.notifications set sent_at = now() where id = $1::uuid and sent_at is null', [p.notificationId]);
    }
    // Hiçbiri gitmediyse ve hata geçiciyse yeniden dene (kalan geçerli abonelikler için).
    if (sent === 0 && retryable > 0) throw new Error(`push gönderilemedi (${lastMessage})`);
    ctx.log.info('push.send', { subscriptions: subs.rows.length, sent, removed, failed });
    return { subscriptions: subs.rows.length, sent, removed, failed };
  },
};
