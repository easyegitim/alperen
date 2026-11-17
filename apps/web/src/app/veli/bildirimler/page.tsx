import type { Metadata } from 'next';
import { PageHeader } from '@/components/PageHeader';
import { PushToggle } from '@/components/PushToggle';
import { EmailSwitch, RuleSwitches } from '@/components/parent/RuleSwitches';
import { PARENT_RULES, emailOn, parseRules } from '@/lib/parent';
import { getPublicEnv } from '@/lib/env';
import { requireRole } from '@/server/auth';
import { parentDb } from '@/server/parent/children';
import { formatDateTimeTr } from '@/lib/format';
import { loadNotifications, loadRules } from '@/server/parent/rpc';

export const metadata: Metadata = { title: 'Bildirimler' };

// Bildirim ayarları (Özet › dişli): kural anahtarları tek sayfa, altında tek "E-postayla da gönder" anahtarı (bütün türler).
// Anlık bildirim düğmesi yalnız VAPID anahtarı varsa görünür.
export default async function VeliBildirimler() {
  const { user } = await requireRole('parent', 'admin');
  const vapid = getPublicEnv().vapidPublicKey;
  const db = await parentDb();
  const [res, hist] = await Promise.all([loadRules(db), loadNotifications(db, 20, false)]);
  const history = hist.ok ? hist.data.items : [];
  const rules = res.ok ? res.data : parseRules(PARENT_RULES.map((r) => ({ kind: r.kind, enabled: true })));
  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-8">
      <PageHeader title="Bildirimler" description="Hangi gelişmelerde haber almak istediğinizi seçin." />
      <section aria-labelledby="gecmis" className="flex flex-col gap-3">
        <h2 id="gecmis" className="text-title-3 m-0 text-ink">
          Son bildirimler
        </h2>
        {history.length === 0 ? (
          <p className="text-small m-0 text-ink-muted">Henüz bildirim yok.</p>
        ) : (
          <ul aria-label="Bildirim geçmişi" className="m-0 flex list-none flex-col divide-y divide-line p-0">
            {history.map((n) => (
              <li key={n.id} className="flex flex-col gap-0.5 py-3">
                <span className={`text-label text-ink ${n.read ? 'font-normal' : 'font-bold'}`}>{n.title}</span>
                {n.body ? <span className="text-small line-clamp-2 text-ink-muted">{n.body}</span> : null}
                <span className="text-caption text-ink-muted">{formatDateTimeTr(n.createdAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
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
