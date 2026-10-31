'use client';
// Personel sayfası kabuğu: oturum ve rol (BLUEPRINT §7 "Roller"), gezinme, mock rol seçici.
// Rol arayüzde görünürlük içindir; güvenlik RLS'tedir (gözlemcinin "Onayla" düğmesi disabled, tıklansa da RPC reddeder).
import * as React from 'react';
import Link from 'next/link';
import { Badge, Notice } from './ds';
import { getSupabase, type DataSource, type StaffRole, type Viewer } from './data';
import { useAsync, useDataSource } from './hooks';

export const ROLE_TEXT: Record<StaffRole, string> = {
  coordinator: 'Koordinatör',
  instructor: 'Branş eğitmeni',
  observer: 'Gözlemci',
};

interface NavItem {
  href: string;
  label: string;
  roles?: StaffRole[];
}
export const NAV: NavItem[] = [
  { href: '/', label: 'Genel bakış' },
  { href: '/dersler', label: 'Ders raporları' },
  { href: '/cevaplar', label: 'Bot cevapları' },
  { href: '/kuyruk', label: 'Onay kuyruğu' },
  { href: '/oncelik', label: 'Öncelikler' },
  { href: '/ogrenciler', label: 'Öğrenciler' },
  { href: '/onaylar', label: 'Onaylar', roles: ['coordinator', 'instructor'] },
  { href: '/gruplar', label: 'Gruplar', roles: ['coordinator'] },
  { href: '/maliyet', label: 'Maliyet', roles: ['coordinator'] },
];

export interface StaffContext {
  viewer: Viewer;
  ds: DataSource;
  /** Düzenleyebilir mi (koordinatör veya branş eğitmeni). */
  canEdit: boolean;
}

type Gate = { state: 'ok'; viewer: Viewer } | { state: 'no-session' } | { state: 'no-role' };

async function resolveGate(ds: DataSource): Promise<Gate> {
  if (ds.mode === 'live') {
    const session = await getSupabase().auth.getSession();
    if (!session) return { state: 'no-session' };
  }
  const viewer = await ds.viewer();
  return viewer ? { state: 'ok', viewer } : { state: 'no-role' };
}

/** Geçerli sorgu parametrelerini koruyup yalnız `role`'ü değiştirir (/ders?id=… rol değişince raporu kaybetmesin). */
export function roleHref(search: string, role: StaffRole): string {
  const q = new URLSearchParams(search);
  q.set('role', role);
  return `?${q.toString()}`;
}

function MockRoleSwitch({ current }: { current: StaffRole }) {
  const search = typeof window === 'undefined' ? '' : window.location.search;
  return (
    <div className="mock-role" aria-label="Yerel veri: rol seçici">
      <span className="t-caption">Yerel veri · rol:</span>
      {(Object.keys(ROLE_TEXT) as StaffRole[]).map((r) => (
        <a key={r} href={roleHref(search, r)} aria-current={r === current ? 'true' : undefined} className="mock-role-link">
          {ROLE_TEXT[r]}
        </a>
      ))}
    </div>
  );
}

export function StaffPage({
  title,
  roles,
  children,
}: {
  title: string;
  roles?: StaffRole[];
  children: (ctx: StaffContext) => React.ReactNode;
}) {
  const ds = useDataSource();
  const gate = useAsync(() => resolveGate(ds), [ds]);
  const g = gate.data;
  return (
    <div className="shell">
      <nav className="shell-nav" aria-label="Panel gezinme">
        {g?.state === 'ok' && (
          <ul>
            {NAV.filter((n) => !n.roles || n.roles.includes(g.viewer.role)).map((n) => (
              <li key={n.href}>
                <Link href={n.href}>{n.label}</Link>
              </li>
            ))}
          </ul>
        )}
        {g?.state === 'ok' && (
          <div className="shell-who">
            <span className="t-label">{g.viewer.full_name}</span>
            <Badge tone="neutral">{ROLE_TEXT[g.viewer.role]}</Badge>
          </div>
        )}
        {/* env ifadesi literal kalır: live derlemesinde DefinePlugin + küçültücü rol seçiciyi pakete hiç koymaz */}
        {process.env.NEXT_PUBLIC_DATA_SOURCE !== 'live' && g?.state === 'ok' && <MockRoleSwitch current={g.viewer.role} />}
      </nav>
      <main className="shell-main">
        <h1 className="t-title-1">{title}</h1>
        {gate.loading && !g && <div aria-busy="true" className="ds-skeleton" />}
        {gate.error && <Notice tone="warning" title="Bağlantı sorunu">{gate.error}</Notice>}
        {g?.state === 'no-session' && (
          <Notice tone="info" title="Oturum açman gerekiyor" action={<Link href="/giris">Giriş yap</Link>}>
            Panel verisi yalnız giriş yapmış personele açılır.
          </Notice>
        )}
        {g?.state === 'no-role' && (
          <Notice tone="warning" title="Rol yok">
            Hesabın henüz bir role bağlanmadı; koordinatörle görüş.
          </Notice>
        )}
        {g?.state === 'ok' && roles && !roles.includes(g.viewer.role) && (
          <Notice tone="info" title="Yetki">
            Bu sayfa yalnız {roles.map((r) => ROLE_TEXT[r].toLocaleLowerCase('tr-TR')).join(' ve ')} içindir.
          </Notice>
        )}
        {g?.state === 'ok' && (!roles || roles.includes(g.viewer.role)) &&
          children({ viewer: g.viewer, ds, canEdit: g.viewer.role === 'coordinator' || g.viewer.role === 'instructor' })}
      </main>
    </div>
  );
}

/** Basit yükleme / hata / içerik üçlüsü. */
export function Loadable<T>({ state, children }: { state: { data: T | undefined; error: string | null; loading: boolean }; children: (data: T) => React.ReactNode }) {
  if (state.error) return <Notice tone="warning" title="Veri alınamadı">{state.error}</Notice>;
  if (state.data === undefined) return <div aria-busy="true" className="ds-skeleton" />;
  return <>{children(state.data)}</>;
}

/** Eylem sonucu satırı (başarı bilgisi ya da hata). */
export function ActionResult({ error, message }: { error: string | null; message: string | null }) {
  if (error) return <Notice tone="warning" title="İşlem yapılamadı">{error}</Notice>;
  if (message) return <Notice tone="info">{message}</Notice>;
  return null;
}
