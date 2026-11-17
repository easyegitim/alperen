// SPEC 4.2 /admin ve 14 /api/admin/*: yalnız ADMIN_EMAILS (virgülle ayrılmış). Anonim kullanıcı asla admin değildir.
export function adminEmails(env: Record<string, string | undefined> = process.env): string[] {
  return (env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export function isAdminUser(user: { email?: string | null; is_anonymous?: boolean } | null | undefined, env?: Record<string, string | undefined>): boolean {
  if (!user?.email || user.is_anonymous) return false;
  return adminEmails(env).includes(user.email.toLowerCase());
}

/**
 * Hekim listesi (KB Ç3/Ç5; AUP: değiştirme yetkisi olan NİTELİKLİ kişi): yalnız PHYSICIAN_EMAILS. ADMIN_EMAILS ops içindir ve
 * hekim yetkisi VERMEZ; doktor kuyruğu (/admin/doctor, /api/doctor/review) yalnız bu listeyle açılır. Kimlik satıra
 * physician_id (auth.users) olarak yazılır; diploma/sicil referansı saklama ayrı bir migration ister (AÇIK, KB §11.7).
 */
export function physicianEmails(env: Record<string, string | undefined> = process.env): string[] {
  return (env.PHYSICIAN_EMAILS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export function isPhysicianUser(user: { email?: string | null; is_anonymous?: boolean } | null | undefined, env?: Record<string, string | undefined>): boolean {
  if (!user?.email || user.is_anonymous) return false;
  return physicianEmails(env).includes(user.email.toLowerCase());
}
