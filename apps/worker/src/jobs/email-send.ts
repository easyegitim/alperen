/**
 * `email.send` {notification_id} — bildirimin e-posta kanalı (Resend). Kuralın kanalları `email` içeriyorsa
 * kural motoru (ya da saatlik süpürme) atar. Alıcı adresi `auth.users.email`'dir (yalnız worker okur; günlüğe maskeli).
 * Anahtar yoksa kuru çalışma: ileti günlüğe yazılır, `payload.delivery.email = dry` (bkz. notifications/delivery.ts).
 * Teslim kaydı varsa (sent/dry/none) iş yeniden göndermez.
 */
import { z } from 'zod';
import { deliveryStatus, markDelivery } from '../notifications/delivery.js';
import { buildEmail, emailSenderFromEnv, maskEmail, type EmailSender } from '../notifications/email.js';
import { PermanentJobError } from './errors.js';
import { uuid } from './schemas.js';
import type { JobDefinition } from './types.js';

const payload = z.object({ notification_id: uuid });

export interface EmailSendResult {
  status: 'sent' | 'dry' | 'none' | 'failed' | 'skipped';
  reason?: string;
}

export function createEmailSendJob(senderOf: () => EmailSender, siteUrl: () => string | null = () => process.env.OGRENMEN_SITE_URL ?? process.env.NEXT_PUBLIC_SITE_URL ?? null): JobDefinition<z.infer<typeof payload>, EmailSendResult> {
  return {
    name: 'email.send',
    description: 'E-posta bildirimi (Resend); anahtar yoksa kuru çalışma.',
    process: 'worker',
    payload,
    concurrency: 2,
    retry: { retryLimit: 4, retryDelay: 30, retryBackoff: true, retryDelayMax: 1800, expireInSeconds: 120, deleteAfterSeconds: 86_400, retentionSeconds: 86_400 },
    handler: async (p, ctx) => {
      const r = await ctx.db.query(
        `select n.recipient_id, n.title, n.body, n.channels, n.payload, u.email
           from public.notifications n left join auth.users u on u.id = n.recipient_id
          where n.id = $1::uuid`,
        [p.notification_id],
      );
      const n = r.rows[0];
      if (!n) throw new PermanentJobError(`bildirim yok: ${p.notification_id}`, 'OGR-EMAIL-002');
      if (!Array.isArray(n.channels) || !n.channels.includes('email')) return { status: 'skipped', reason: 'kanal e-posta değil' };
      const prior = deliveryStatus(n.payload, 'email');
      if (prior === 'sent' || prior === 'dry' || prior === 'none') return { status: 'skipped', reason: `teslim kaydı: ${prior}` };
      const to = typeof n.email === 'string' && n.email.includes('@') ? n.email : null;
      if (!to) {
        await markDelivery(ctx.db, p.notification_id, 'email', 'none', 'e-posta adresi yok');
        return { status: 'none' };
      }
      const url = n.payload && typeof n.payload === 'object' && typeof (n.payload as { url?: unknown }).url === 'string' ? String((n.payload as { url: string }).url) : null;
      const msg = buildEmail({ title: String(n.title), body: n.body === null ? null : String(n.body), url }, to, siteUrl());
      const sender = senderOf();
      if (!sender.configured) {
        // İçerik günlüğe yazılmaz (ad ve durum PII): yalnız kimlik, uzunluk ve maskeli adres.
        ctx.log.info('email.send kuru çalışma (RESEND_API_KEY yok)', {
          to: maskEmail(to),
          notification_id: p.notification_id,
          subject_length: msg.subject.length,
          text_length: msg.text.length,
        });
        await markDelivery(ctx.db, p.notification_id, 'email', 'dry');
        return { status: 'dry' };
      }
      const out = await sender.send(msg);
      if (out.ok) {
        await markDelivery(ctx.db, p.notification_id, 'email', 'sent', out.id ?? undefined);
        return { status: 'sent' };
      }
      if (out.retryable) throw new Error(`e-posta gönderilemedi (${out.status ?? 'ağ'}: ${out.message})`);
      await markDelivery(ctx.db, p.notification_id, 'email', 'failed', `${out.status ?? ''} ${out.message}`.trim());
      return { status: 'failed', reason: out.message };
    },
  };
}

let cached: EmailSender | null = null;
export const emailSendJob = createEmailSendJob(() => (cached ??= emailSenderFromEnv()));
