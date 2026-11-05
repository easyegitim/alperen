import type { Metadata } from 'next';
import { PageHeader } from '@/components/PageHeader';
import { PushToggle } from '@/components/PushToggle';
import { EmailSwitch, RuleSwitches } from '@/components/parent/RuleSwitches';
import { PARENT_RULES, emailOn, parseRules } from '@/lib/parent';
import { getPublicEnv } from '@/lib/env';
import { requireRole } from '@/server/auth';
import { parentDb } from '@/server/parent/children';
import { loadRules } from '@/server/parent/rpc';

export const metadata: Metadata = { title: 'Bildirimler' };

// Bildirim ayarları (Özet › dişli): kural anahtarları tek sayfa, altında tek "E-postayla da gönder" anahtarı (bütün türler).
// Anlık bildirim düğmesi yalnız VAPID anahtarı varsa görünür.
export default async function VeliBildirimler() {
  const { user } = await requireRole('parent', 'admin');
  const vapid = getPublicEnv().vapidPublicKey;
  const res = await loadRules(await parentDb());
  const rules = res.ok ? res.data : parseRules(PARENT_RULES.map((r) => ({ kind: r.kind, enabled: true })));
  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-8">
      <PageHeader title="Bildirimler" description="Hangi gelişmelerde haber almak istediğinizi seçin." />
      <RuleSwitches rules={rules} />
      <EmailSwitch initial={emailOn(rules)} />
      {vapid ? (
        <section aria-labelledby="anlik" className="flex flex-col gap-3">
          <h2 id="anlik" className="text-title-3 m-0 text-ink">
            Bu cihazda
          </h2>
          <PushToggle userId={user.id} vapidPublicKey={vapid} />
        </section>
      ) : null}
    </div>
  );
}
