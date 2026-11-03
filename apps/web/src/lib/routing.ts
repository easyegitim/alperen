import { areaOfPath, canUseArea, isAppRole, roleHome, type AppRole } from './roles';

/** Oturum açmadan görülebilen yollar (proxy bunlara dokunmaz, yalnız oturumu yeniler). */
const PUBLIC_EXACT = new Set(['/giris', '/cevrimdisi', '/api/health', '/manifest.webmanifest', '/sw.js']);
const PUBLIC_PREFIXES = ['/auth/', '/icons/'];

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_EXACT.has(pathname) || PUBLIC_PREFIXES.some((p) => pathname.startsWith(p));
}

export interface RouteInput {
  pathname: string;
  /** Oturum açık mı (doğrulanmış kullanıcı var mı). */
  authed: boolean;
  /** profiles.role; profil satırı yoksa null. */
  role: string | null;
  /** profiles.onboarded_at dolu mu. */
  onboarded: boolean;
  /** İstek sorgusu (`?kod=…` dahil, yoksa boş); girişe yönlendirirken `next` içinde korunur. */
  search?: string;
}

export type RouteDecision = { type: 'next' } | { type: 'redirect'; to: string };

const NEXT: RouteDecision = { type: 'next' };

/** Onboarding gerektiren roller: öğrenci ve veli kendi kurulumunu yapar; eğitmen/yönetici hesabı davetle açılır. */
export function needsOnboarding(role: string | null, onboarded: boolean): boolean {
  if (!isAppRole(role)) return true;
  if (role === 'student' || role === 'parent') return !onboarded;
  return false;
}

/** `?next=` değeri yalnızca uygulama içi, alan altı bir yol olabilir (açık yönlendirme koruması). */
export function safeNextPath(value: string | null | undefined, fallback = '/'): string {
  if (!value) return fallback;
  if (!value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return fallback;
  if (/[\u0000-\u001f]/.test(value)) return fallback;
  return value;
}

/**
 * Saf yönlendirme kararı (proxy.ts kullanır; sunucu bileşenleri requireRole ile yeniden doğrular).
 *  - Oturumsuz + korumalı yol            -> /giris?next=
 *  - Oturumlu + profil/onboarding eksik  -> /hos-geldin
 *  - Oturumlu + / veya /giris            -> rol ana sayfası
 *  - Oturumlu + başka rolün alanı        -> kendi ana sayfası
 */
export function decideRoute({ pathname, authed, role, onboarded, search = '' }: RouteInput): RouteDecision {
  if (!authed) {
    if (isPublicPath(pathname)) return NEXT;
    const next = pathname === '/' && !search ? '' : `?next=${encodeURIComponent(`${pathname}${search}`)}`;
    return { type: 'redirect', to: `/giris${next}` };
  }

  // Oturum açık: sağlık ucu, servis çalışanı ve çevrimdışı sayfa her zaman geçer.
  if (pathname === '/api/health' || pathname === '/cevrimdisi' || pathname === '/manifest.webmanifest' || pathname === '/sw.js') return NEXT;
  if (pathname.startsWith('/auth/') || pathname.startsWith('/icons/')) return NEXT;
  // Veli davet bağlantısı: rolü/kurulumu ne olursa olsun sayfa kodu doğru yere (veli kurulumu ya da ayarlar) kendisi yollar.
  if (pathname === '/davet') return NEXT;

  if (needsOnboarding(role, onboarded)) {
    return pathname === '/hos-geldin' ? NEXT : { type: 'redirect', to: '/hos-geldin' };
  }
  const appRole = role as AppRole;
  const home = roleHome(appRole);
  if (pathname === '/' || pathname === '/giris' || pathname === '/hos-geldin') return { type: 'redirect', to: home };

  const area = areaOfPath(pathname);
  if (area && !canUseArea(appRole, area)) return { type: 'redirect', to: home };
  return NEXT;
}
