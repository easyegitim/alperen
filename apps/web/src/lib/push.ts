// Web-push abonelik yardımcıları (istemci). Gönderim apps/worker'dadır; burada yalnız abonelik alınır ve
// public.push_subscriptions tablosuna (RLS: user_id = auth.uid()) yazılır. VAPID herkese açık anahtarı env'den gelir.

/** base64url VAPID anahtarını PushManager'ın beklediği bayt dizisine çevirir. */
export function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

export function isPushSupported(): boolean {
  return typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

export interface SerializedSubscription {
  endpoint: string;
  p256dh: string;
  auth: string;
}

/** PushSubscription -> tablo satırı alanları; anahtarlar yoksa null. */
export function serializeSubscription(sub: { toJSON(): { endpoint?: string; keys?: Record<string, string> } }): SerializedSubscription | null {
  const json = sub.toJSON();
  const p256dh = json.keys?.p256dh;
  const auth = json.keys?.auth;
  if (!json.endpoint || !p256dh || !auth) return null;
  return { endpoint: json.endpoint, p256dh, auth };
}

/** İzin ister ve abone olur. İzin verilmezse null döner. */
export async function subscribeToPush(vapidPublicKey: string): Promise<PushSubscription | null> {
  if (!isPushSupported() || !vapidPublicKey) return null;
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return null;
  const registration = await navigator.serviceWorker.ready;
  const existing = await registration.pushManager.getSubscription();
  if (existing) return existing;
  return registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(vapidPublicKey) });
}

export async function currentSubscription(): Promise<PushSubscription | null> {
  if (!isPushSupported()) return null;
  const registration = await navigator.serviceWorker.getRegistration();
  return registration ? registration.pushManager.getSubscription() : null;
}
