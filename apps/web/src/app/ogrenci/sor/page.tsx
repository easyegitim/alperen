import { redirect } from 'next/navigation';

// Eski "Sor" sayfası (yarım kalmış kamera iskeleti) kaldırıldı: soru + çözüm fotoğrafı yükleme ve teşhis Yükle ekranında
// (/ogrenci/yukle). Eski bağlantılar ve kurulu PWA kısayolları için yönlendirme.
export default function SorYonlendirme() {
  redirect('/ogrenci/yukle');
}
