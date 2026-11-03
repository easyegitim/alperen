// Gezinme tanımları (PLAN-v2 §13). Simgeler adla verilir; çizimi istemci kabuklarındadır.

export type NavIconName =
  | 'today'
  | 'growth'
  | 'coach'
  | 'ask'
  | 'exams'
  | 'notes'
  | 'map'
  | 'profile'
  | 'summary'
  | 'chat'
  | 'reports'
  | 'bell'
  | 'settings'
  | 'students'
  | 'courses'
  | 'curricula'
  | 'styles'
  | 'content'
  | 'examkeys'
  | 'queue'
  | 'cost';

export interface NavItemDef {
  id: string;
  label: string;
  href: string;
  icon: NavIconName;
  /** Etkin sayılacağı ek yol önekleri (ör. Gelişim sekmesi Profil sayfasında da etkindir). */
  alsoActive?: readonly string[];
}

/**
 * Öğrenci alt gezinme (PLAN-v2 §13): Bugün · Koç · Gelişim. "Sor" ortadaki kamera düğmesidir (FAB), listede yer almaz.
 * Denemeler/Notlarım Gelişim › Belgelerim, Konu haritası Gelişim › Konular altındadır; Profil Gelişim içinden açılır.
 */
export const STUDENT_NAV: NavItemDef[] = [
  { id: 'bugun', label: 'Bugün', href: '/ogrenci', icon: 'today' },
  { id: 'koc', label: 'Koç', href: '/ogrenci/koc', icon: 'coach' },
  { id: 'gelisim', label: 'Gelişim', href: '/ogrenci/gelisim', icon: 'growth', alsoActive: ['/ogrenci/profil'] },
];

export const STUDENT_FAB = { label: 'Sor', href: '/ogrenci/sor' } as const;

/** Veli alt gezinme (PLAN-v2 §13): Özet · Sohbet. Bildirimler ve Ayarlar üstteki hesap bağlantılarıdır. */
export const PARENT_NAV: NavItemDef[] = [
  { id: 'ozet', label: 'Özet', href: '/veli', icon: 'summary' },
  { id: 'sohbet', label: 'Sohbet', href: '/veli/sohbet', icon: 'chat' },
];

/** Veli hesap bağlantıları (sekme değil). */
export const PARENT_ACCOUNT_LINKS: Array<{ id: string; label: string; href: string; icon: NavIconName }> = [
  { id: 'bildirimler', label: 'Bildirimler', href: '/veli/bildirimler', icon: 'bell' },
  { id: 'ayarlar', label: 'Ayarlar', href: '/veli/ayarlar', icon: 'settings' },
];

export const INSTRUCTOR_NAV: NavItemDef[] = [
  { id: 'ogrenciler', label: 'Öğrenciler', href: '/egitmen', icon: 'students' },
  { id: 'dersler', label: 'Dersler', href: '/egitmen/dersler', icon: 'courses' },
  { id: 'mufredatlar', label: 'Müfredatlar', href: '/egitmen/mufredatlar', icon: 'curricula' },
  { id: 'soru-tarzlari', label: 'Soru tarzları', href: '/egitmen/soru-tarzlari', icon: 'styles' },
  { id: 'icerik', label: 'İçerik', href: '/egitmen/icerik', icon: 'content' },
  { id: 'sinavlar', label: 'Sınavlar', href: '/egitmen/sinavlar', icon: 'examkeys' },
  { id: 'kuyruk', label: 'Kuyruk', href: '/egitmen/kuyruk', icon: 'queue' },
  { id: 'maliyet', label: 'Maliyet', href: '/egitmen/maliyet', icon: 'cost' },
  { id: 'ayarlar', label: 'Ayarlar', href: '/egitmen/ayarlar', icon: 'settings' },
];

/** Gezinme öğesi bu yolda etkin mi? Kök öğe (ör. /ogrenci) yalnız tam eşleşmede, diğerleri alt yollarda da etkindir. */
export function isNavActive(href: string, pathname: string, rootHref: string, alsoActive: readonly string[] = []): boolean {
  if (href === rootHref) return pathname === href;
  return [href, ...alsoActive].some((h) => pathname === h || pathname.startsWith(`${h}/`));
}
