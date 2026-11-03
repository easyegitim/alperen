// Roller ve ana sayfaları. Rol, public.profiles.role değeridir (docs/PLAN-v2-detail.md §2.3).

export type AppRole = 'student' | 'parent' | 'instructor' | 'admin';

export const APP_ROLES: readonly AppRole[] = ['student', 'parent', 'instructor', 'admin'];

/** Rolün ilk sayfası. Yönetici (admin) eğitmen konsolunu kullanır. */
export const ROLE_HOME: Record<AppRole, string> = {
  student: '/ogrenci',
  parent: '/veli',
  instructor: '/egitmen',
  admin: '/egitmen',
};

export const ROLE_LABELS: Record<AppRole, string> = {
  student: 'Öğrenci',
  parent: 'Veli',
  instructor: 'Eğitmen',
  admin: 'Yönetici',
};

/** Rol alanlarının yol önekleri. */
export const AREA_PREFIXES = ['/ogrenci', '/veli', '/egitmen'] as const;
export type AreaPrefix = (typeof AREA_PREFIXES)[number];

export function isAppRole(value: unknown): value is AppRole {
  return typeof value === 'string' && (APP_ROLES as readonly string[]).includes(value);
}

export function roleHome(role: AppRole): string {
  return ROLE_HOME[role];
}

/** Yolun ait olduğu alan öneki (`/ogrenci/profil` -> `/ogrenci`); alan dışıysa null. */
export function areaOfPath(pathname: string): AreaPrefix | null {
  for (const prefix of AREA_PREFIXES) {
    if (pathname === prefix || pathname.startsWith(`${prefix}/`)) return prefix;
  }
  return null;
}

/** Rol bu alanı kullanabilir mi? Yönetici üç alanı da görebilir (destek ve denetim için). */
export function canUseArea(role: AppRole, area: AreaPrefix): boolean {
  if (role === 'admin') return true;
  return ROLE_HOME[role] === area;
}
