/**
 * E-posta kanalı (Resend HTTP API; SDK yok, `fetch`). Anahtar ortamdandır (RESEND_API_KEY, EMAIL_FROM; Fly secrets);
 * yoksa gönderici "yapılandırılmamış"tır ve `email.send` kuru çalışır: gönderilecek ileti günlüğe yazılır (alıcı adresi
 * maskeli), bildirimin `payload.delivery.email` alanı `dry` olur. Anahtar gelince kod değişmeden gerçek gönderim başlar.
 *
 * Metin düzdür ve kısadır: bildirim başlığı + gövde + uygulamadaki bağlantı. HTML, tasarım sistemine uygun en sade
 * biçimdir (tek sütun, sistem yazı tipi); dış görsel ya da izleme pikseli yoktur.
 */
export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export type EmailOutcome =
  | { ok: true; id: string | null }
  /** `retryable`: 429 / 5xx / ağ hatası. */
  | { ok: false; status: number | null; retryable: boolean; message: string };

export interface EmailSender {
  readonly configured: boolean;
  send(msg: EmailMessage): Promise<EmailOutcome>;
}

export const RESEND_ENDPOINT = 'https://api.resend.com/emails';

type Env = Record<string, string | undefined>;
type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<{
  status: number;
  ok: boolean;
  text(): Promise<string>;
}>;

export class ResendSender implements EmailSender {
  constructor(
    private readonly opts: { apiKey: string; from: string } | null,
    private readonly fetcher: FetchLike = (url, init) => fetch(url, init),
  ) {}

  get configured(): boolean {
    return this.opts !== null;
  }

  async send(msg: EmailMessage): Promise<EmailOutcome> {
    if (!this.opts) return { ok: false, status: null, retryable: false, message: 'RESEND_API_KEY / EMAIL_FROM tanımlı değil' };
    try {
      const res = await this.fetcher(RESEND_ENDPOINT, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.opts.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: this.opts.from, to: [msg.to], subject: msg.subject, text: msg.text, html: msg.html }),
        signal: AbortSignal.timeout(15_000),
      });
      const raw = await res.text().catch(() => '');
      if (res.ok) {
        let id: string | null = null;
        try {
          const j = JSON.parse(raw) as { id?: unknown };
          id = typeof j.id === 'string' ? j.id : null;
        } catch {
          /* gövde JSON değil: kimliksiz başarı */
        }
        return { ok: true, id };
      }
      return { ok: false, status: res.status, retryable: res.status === 429 || res.status >= 500, message: raw.slice(0, 300) };
    } catch (err) {
      return { ok: false, status: null, retryable: true, message: (err as Error).message };
    }
  }
}

/** Ortamdan gönderici: RESEND_API_KEY ve EMAIL_FROM birlikte varsa gerçek, yoksa yapılandırılmamış (kuru çalışma). */
export function emailSenderFromEnv(env: Env = process.env): EmailSender {
  const apiKey = env.RESEND_API_KEY?.trim();
  const from = env.EMAIL_FROM?.trim();
  return new ResendSender(apiKey && from ? { apiKey, from } : null);
}

/** Günlük için maskeli adres: `v***@ogrenmen.test`. */
export function maskEmail(addr: string): string {
  const [user = '', domain = ''] = addr.split('@');
  return `${user.slice(0, 1)}***@${domain}`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Bildirimden e-posta: konu = başlık; gövde + "Uygulamada aç" bağlantısı (site adresi verildiyse). */
export function buildEmail(n: { title: string; body: string | null; url: string | null }, to: string, siteUrl: string | null): EmailMessage {
  const link = siteUrl && n.url && n.url.startsWith('/') && !n.url.startsWith('//') ? `${siteUrl.replace(/\/+$/, '')}${n.url}` : null;
  const body = (n.body ?? '').trim();
  const text = [body, link ? `Uygulamada aç: ${link}` : null, '', 'Öğrenmen · Bildirim ayarlarını uygulamadaki Ayarlar sayfasından değiştirebilirsiniz.']
    .filter((x) => x !== null)
    .join('\n');
  const html = [
    '<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:520px;color:#051c60;line-height:1.5">',
    `<h1 style="font-size:18px;margin:0 0 12px">${escapeHtml(n.title)}</h1>`,
    body ? `<p style="font-size:15px;margin:0 0 16px">${escapeHtml(body)}</p>` : '',
    link ? `<p style="margin:0 0 24px"><a href="${escapeHtml(link)}" style="color:#0030a2">Uygulamada aç</a></p>` : '',
    '<p style="font-size:12px;color:#7a86a8;margin:0">Öğrenmen · Bildirim ayarlarını uygulamadaki Ayarlar sayfasından değiştirebilirsiniz.</p>',
    '</div>',
  ].join('');
  return { to, subject: n.title.slice(0, 120), text, html };
}
