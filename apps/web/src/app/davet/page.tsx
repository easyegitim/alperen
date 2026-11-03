import { redirect } from 'next/navigation';
import { roleHome } from '@/lib/roles';
import { parseInviteToken } from '@/lib/validation';
import { getCurrentProfile } from '@/server/auth';

export const dynamic = 'force-dynamic';

/**
 * Veli davet bağlantısı: `/davet?kod=gi_…`. Oturumsuzken proxy `/giris?next=/davet?kod=…` adresine yollar (sorgu korunur).
 * Oturum açıkken kod, rolüne göre veli kurulumuna ya da veli Ayarlar sayfasındaki forma önceden doldurulur.
 */
export default async function DavetSayfasi({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const raw = Array.isArray(params.kod) ? params.kod[0] : params.kod;
  const token = parseInviteToken(raw);
  const current = await getCurrentProfile();
  if (!current) redirect(`/giris?next=${encodeURIComponent(`/davet${token ? `?kod=${token}` : ''}`)}`);
  const { profile } = current;
  const query = token ? `&kod=${encodeURIComponent(token)}` : '';

  // Profil yok ya da veli kurulumu yarım: kurulum formu kodla açılır.
  if (!profile || (profile.role === 'parent' && !profile.onboarded_at)) redirect(`/hos-geldin?rol=veli${query}`);
  if (profile.role === 'parent') redirect(token ? `/veli/ayarlar?kod=${encodeURIComponent(token)}` : '/veli/ayarlar');
  // Öğrenci/eğitmen davet kabul edemez; kendi ana sayfasına döner.
  redirect(profile.role === 'student' || profile.role === 'instructor' || profile.role === 'admin' ? roleHome(profile.role) : '/');
}
