import { redirect } from 'next/navigation';
import { isAppRole, roleHome } from '@/lib/roles';
import { needsOnboarding } from '@/lib/routing';
import { getCurrentProfile } from '@/server/auth';

// Kök adres: oturuma ve role göre yönlendirir (proxy aynı kararı önceden verir; burası sunucuda yeniden doğrular).
export const dynamic = 'force-dynamic';

export default async function KokSayfa() {
  const current = await getCurrentProfile();
  if (!current) redirect('/giris');
  const profile = current.profile;
  if (!profile || !isAppRole(profile.role) || needsOnboarding(profile.role, Boolean(profile.onboarded_at))) redirect('/hos-geldin');
  redirect(roleHome(profile.role));
}
