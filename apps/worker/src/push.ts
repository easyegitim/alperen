/**
 * Web-push (VAPID). İstemci tarafı: apps/web/src/sw/sw.ts; yük biçimi apps/web/src/lib/push-payload.ts
 * ({ title, body, url, tag }). VAPID anahtarları ortamdan (Fly secrets) gelir; kodda yok.
 */
import webpush from 'web-push';

export interface PushSubscriptionRow {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface PushMessage {
  title: string;
  body: string;
  /** Uygulama içi yol (`/` ile başlar). */
  url?: string;
  tag?: string;
}

export type PushOutcome =
  | { ok: true }
  /** Abonelik artık geçersiz (404/410): silinmeli. */
  | { ok: false; gone: true; status: number }
  /** Geçici ya da kalıcı başka hata; `retryable` geçici olanlar için true. */
  | { ok: false; gone: false; status: number | null; retryable: boolean; message: string };

export interface PushSender {
  /** VAPID anahtarları tanımlı mı. */
  readonly configured: boolean;
  send(sub: PushSubscriptionRow, msg: PushMessage): Promise<PushOutcome>;
}

/** Yalnız uygulama içi yol (servis çalışanı da aynı denetimi yapar). */
export function safeUrl(value: unknown): string {
  return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//') && !value.includes('\\') ? value : '/';
}

export function buildPushBody(msg: PushMessage): string {
  return JSON.stringify({
    title: msg.title.trim().slice(0, 80) || 'Öğrenmen',
    body: msg.body.trim().slice(0, 200),
    url: safeUrl(msg.url),
    ...(msg.tag ? { tag: msg.tag.slice(0, 64) } : {}),
  });
}

export class WebPushSender implements PushSender {
  constructor(private readonly vapid: { publicKey: string; privateKey: string; subject: string } | null) {}

  get configured(): boolean {
    return this.vapid !== null;
  }

  async send(sub: PushSubscriptionRow, msg: PushMessage): Promise<PushOutcome> {
    if (!this.vapid) return { ok: false, gone: false, status: null, retryable: false, message: 'VAPID yapılandırılmamış' };
    try {
      await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, buildPushBody(msg), {
        vapidDetails: { subject: this.vapid.subject, publicKey: this.vapid.publicKey, privateKey: this.vapid.privateKey },
        TTL: 60 * 60 * 24,
        urgency: 'normal',
        timeout: 15_000,
      });
      return { ok: true };
    } catch (err) {
      const status = typeof (err as { statusCode?: unknown }).statusCode === 'number' ? (err as { statusCode: number }).statusCode : null;
      if (status === 404 || status === 410) return { ok: false, gone: true, status };
      const retryable = status === null || status === 429 || status >= 500;
      return { ok: false, gone: false, status, retryable, message: (err as Error).message };
    }
  }
}

/** Anahtar yokken kullanılan sahte gönderici değil: yapılandırılmamış gönderici (işler anlamlı hata verir). */
export const UNCONFIGURED_PUSH: PushSender = new WebPushSender(null);
