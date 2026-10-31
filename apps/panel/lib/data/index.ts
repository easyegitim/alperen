// Veri kaynağı seçimi: NEXT_PUBLIC_DATA_SOURCE=live|mock. Üretim derlemesi değişkeni açıkça ister (next.config.mjs durur);
// geliştirme ve testlerde tanımsızsa mock kullanılır. mock modunda rol seçici: ?role=coordinator|instructor|observer
// (oturum boyunca sessionStorage'da tutulur).
// live derlemesinde './mock' içe aktarımı next.config.mjs'teki NormalModuleReplacementPlugin ile mock-unavailable.ts'e
// çevrilir: fixtures/db/dev-seed.json (cevap anahtarları, kimlik verileri) üretim paketine girmez (test/build-output.test.ts).
import { SupabaseClient } from '../supabase';
import { createLiveDataSource } from './live';
import { createMockDataSource } from './mock';
import type { DataSource, StaffRole } from './types';

export type { DataSource } from './types';
export * from './types';

export const DATA_SOURCE_MODE: 'live' | 'mock' = process.env.NEXT_PUBLIC_DATA_SOURCE === 'live' ? 'live' : 'mock';

const ROLES: StaffRole[] = ['coordinator', 'instructor', 'observer'];
const ROLE_KEY = 'ogrenmen.panel.mockRole';

export function isStaffRole(v: unknown): v is StaffRole {
  return typeof v === 'string' && (ROLES as string[]).includes(v);
}

/** mock rolü: önce ?role=, sonra sessionStorage, yoksa koordinatör. */
export function resolveMockRole(search: string, store: Pick<Storage, 'getItem' | 'setItem'> | null): StaffRole {
  const fromQuery = new URLSearchParams(search).get('role');
  if (isStaffRole(fromQuery)) {
    store?.setItem(ROLE_KEY, fromQuery);
    return fromQuery;
  }
  const saved = store?.getItem(ROLE_KEY);
  return isStaffRole(saved) ? saved : 'coordinator';
}

let cached: { key: string; ds: DataSource } | null = null;
let supabase: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (!supabase) {
    supabase = new SupabaseClient({
      url: process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
      anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
    });
  }
  return supabase;
}

/** Tarayıcıda tek örnek; mock'ta rol değişirse yeni örnek. */
export function getDataSource(): DataSource {
  if (DATA_SOURCE_MODE === 'live') {
    if (!cached || cached.key !== 'live') cached = { key: 'live', ds: createLiveDataSource(getSupabase()) };
    return cached.ds;
  }
  const hasWindow = typeof window !== 'undefined';
  const role = resolveMockRole(hasWindow ? window.location.search : '', hasWindow ? window.sessionStorage : null);
  const key = `mock:${role}`;
  if (!cached || cached.key !== key) cached = { key, ds: createMockDataSource({ role }) };
  return cached.ds;
}

/** Testler: önbelleği boşaltır (yeni rol / temiz dünya). */
export function resetDataSourceForTests(): void {
  cached = null;
  supabase = null;
}
