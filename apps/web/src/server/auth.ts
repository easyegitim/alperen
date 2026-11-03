import 'server-only';
import { cache } from 'react';
import { redirect } from 'next/navigation';
import { areaOfPath, canUseArea, isAppRole, roleHome, type AppRole } from '@/lib/roles';
import { needsOnboarding } from '@/lib/routing';
import { createSupabaseServerClient } from './supabase';
import type { ProfileRow } from '@/lib/supabase/types';

export interface CurrentUser {
  id: string;
  email: string | null;
}

export interface CurrentProfile {
  user: CurrentUser;
  /** Profil satırı (onboarding öncesi null). */
  profile: Pick<ProfileRow, 'id' | 'role' | 'display_name' | 'onboarded_at' | 'tz' | 'locale'> | null;
}

/** Doğrulanmış kullanıcı (imzası kontrol edilmiş JWT talepleri). İstek başına bir kez çalışır. */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (!claims || typeof claims.sub !== 'string') return null;
  return { id: claims.sub, email: typeof claims.email === 'string' ? claims.email : null };
});

/** Kullanıcı + profil satırı (RLS: kişi kendi profilini okur). İstek başına bir kez çalışır. */
export const getCurrentProfile = cache(async (): Promise<CurrentProfile | null> => {
  const user = await getCurrentUser();
  if (!user) return null;
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.from('profiles').select('id, role, display_name, onboarded_at, tz, locale').eq('id', user.id).maybeSingle();
  return { user, profile: data ?? null };
});

/** Oturum yoksa /giris'e yollar. */
export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect('/giris');
  return user;
}

export interface RequiredRole {
  user: CurrentUser;
  role: AppRole;
  displayName: string | null;
}

/**
 * Sayfa/düzen koruması: oturum + profil + rol. Yanlış rol kendi ana sayfasına, profili/onboardingi eksik kullanıcı
 * /hos-geldin'e yönlenir. proxy.ts'in iyimser kararını sunucuda yeniden doğrular (yetkinin asıl noktası burasıdır).
 */
export async function requireRole(...allowed: AppRole[]): Promise<RequiredRole> {
  const current = await getCurrentProfile();
  if (!current) redirect('/giris');
  const { user, profile } = current;
  if (needsOnboarding(profile?.role ?? null, Boolean(profile?.onboarded_at)) || !profile || !isAppRole(profile.role)) redirect('/hos-geldin');
  const role = profile.role;
  const permitted = allowed.length === 0 || allowed.includes(role);
  if (!permitted) redirect(roleHome(role));
  return { user, role, displayName: profile.display_name };
}

/** Rol alanı düzenleri için: yoldan alanı bulup yalnız o alana girebilen rolleri kabul eder. */
export async function requireArea(pathname: '/ogrenci' | '/veli' | '/egitmen'): Promise<RequiredRole> {
  const area = areaOfPath(pathname);
  const required = await requireRole();
  if (!area || !canUseArea(required.role, area)) redirect(roleHome(required.role));
  return required;
}
