import { redirect } from 'next/navigation';

// Bugün sekmesi /ogrenci kökündedir (src/app/ogrenci/page.tsx); eski/elle yazılmış bağlantılar için.
export default function BugunYonlendirme() {
  redirect('/ogrenci');
}
