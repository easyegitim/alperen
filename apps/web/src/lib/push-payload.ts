// Web-push yükünün ayrıştırılması (servis çalışanı ve testler ortak kullanır). Worker şu biçimde gönderir:
//   { "title": "Haftalık özet hazır", "body": "…", "url": "/veli/raporlar", "tag": "weekly_report" }

export interface PushDisplay {
  title: string;
  body: string;
  /** Tıklanınca açılacak uygulama içi yol. */
  url: string;
  tag?: string;
}

const FALLBACK: PushDisplay = { title: 'Öğrenmen', body: 'Yeni bir bildirimin var.', url: '/' };

/** Yalnız uygulama içi yollar kabul edilir (başka kökene yönlendirme yok). */
export function safePushUrl(value: unknown): string {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return '/';
  return value;
}

export function parsePushPayload(raw: string | null | undefined): PushDisplay {
  if (!raw) return FALLBACK;
  try {
    const data: unknown = JSON.parse(raw);
    if (typeof data !== 'object' || data === null) return { ...FALLBACK, body: String(raw).slice(0, 200) };
    const obj = data as Record<string, unknown>;
    const title = typeof obj.title === 'string' && obj.title.trim() ? obj.title.trim().slice(0, 80) : FALLBACK.title;
    const body = typeof obj.body === 'string' ? obj.body.trim().slice(0, 200) : FALLBACK.body;
    const tag = typeof obj.tag === 'string' && obj.tag ? obj.tag.slice(0, 64) : undefined;
    return { title, body, url: safePushUrl(obj.url), ...(tag ? { tag } : {}) };
  } catch {
    return { ...FALLBACK, body: String(raw).slice(0, 200) };
  }
}
