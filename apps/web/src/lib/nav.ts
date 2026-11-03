// Gezinme tanımları (PLAN-v2 §13). Simgeler adla verilir; çizimi istemci kabuklarındadır.

export type NavIconName =
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
}

/** Öğrenci alt gezinme. "Sor" ortadaki kamera düğmesidir (FAB), listede yer almaz. */
export const STUDENT_NAV: NavItemDef[] = [
  { id: 'koc', label: 'Koç', href: '/ogrenci', icon: 'coach' },
  { id: 'denemeler', label: 'Denemeler', href: '/ogrenci/denemeler', icon: 'exams' },
  { id: 'notlarim', label: 'Notlarım', href: '/ogrenci/notlarim', icon: 'notes' },
  { id: 'konu-haritasi', label: 'Konu haritası', href: '/ogrenci/konu-haritasi', icon: 'map' },
  { id: 'profil', label: 'Profil', href: '/ogrenci/profil', icon: 'profile' },
];

export const STUDENT_FAB = { label: 'Sor', href: '/ogrenci/sor' } as const;

export const PARENT_NAV: NavItemDef[] = [
  { id: 'ozet', label: 'Özet', href: '/veli', icon: 'summary' },
  { id: 'sohbet', label: 'Sohbet', href: '/veli/sohbet', icon: 'chat' },
  { id: 'raporlar', label: 'Raporlar', href: '/veli/raporlar', icon: 'reports' },
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
export function isNavActive(href: string, pathname: string, rootHref: string): boolean {
  if (href === rootHref) return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}
