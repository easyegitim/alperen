'use client';

import { useEffect, useState } from 'react';
import { Bell, BellOff } from 'lucide-react';
import { Button, Notice } from '@/ds';
import { createSupabaseBrowserClient } from '@/lib/supabase/browser';
import { currentSubscription, isPushSupported, serializeSubscription, subscribeToPush } from '@/lib/push';

type Phase = 'checking' | 'unsupported' | 'unconfigured' | 'off' | 'on' | 'denied' | 'busy' | 'error';

/**
 * Bildirim aboneliği: tarayıcıdan web-push aboneliği alır ve public.push_subscriptions tablosuna yazar (RLS: kendi satırı).
 * Gönderim apps/worker'dadır. VAPID anahtarı yoksa düğme yerine açıklama gösterilir.
 */
export function PushToggle({ userId, vapidPublicKey }: { userId: string; vapidPublicKey: string | null }) {
  const [phase, setPhase] = useState<Phase>('checking');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!isPushSupported()) return cancelled ? undefined : setPhase('unsupported');
      if (!vapidPublicKey) return cancelled ? undefined : setPhase('unconfigured');
      if (Notification.permission === 'denied') return cancelled ? undefined : setPhase('denied');
      const sub = await currentSubscription();
      if (!cancelled) setPhase(sub ? 'on' : 'off');
    })();
    return () => {
      cancelled = true;
    };
  }, [vapidPublicKey]);

  async function enable() {
    if (!vapidPublicKey) return;
    setPhase('busy');
    try {
      const sub = await subscribeToPush(vapidPublicKey);
      if (!sub) return setPhase(Notification.permission === 'denied' ? 'denied' : 'off');
      const row = serializeSubscription(sub);
      if (!row) return setPhase('error');
      const supabase = createSupabaseBrowserClient();
      const { error } = await supabase.from('push_subscriptions').insert({ user_id: userId, ...row, ua: navigator.userAgent.slice(0, 200) });
      // 23505: aynı uç nokta zaten kayıtlı (başka oturumda eklenmiş); abonelik geçerli.
      if (error && error.code !== '23505') return setPhase('error');
      setPhase('on');
    } catch {
      setPhase('error');
    }
  }

  async function disable() {
    setPhase('busy');
    try {
      const sub = await currentSubscription();
      if (sub) {
        const supabase = createSupabaseBrowserClient();
        await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
        await sub.unsubscribe();
      }
      setPhase('off');
    } catch {
      setPhase('error');
    }
  }

  if (phase === 'checking') return <p className="text-small m-0 text-ink-muted">Bildirim durumu denetleniyor.</p>;
  if (phase === 'unsupported') return <Notice tone="info">{'Bu tarayıcı anlık bildirimleri desteklemiyor. iPhone\u2019da önce uygulamayı ana ekrana eklemelisin.'}</Notice>;
  if (phase === 'unconfigured') return <Notice tone="info">Anlık bildirimler bu ortamda henüz yapılandırılmadı.</Notice>;
  if (phase === 'denied') return <Notice tone="warning">Bildirim izni tarayıcı ayarlarında kapalı. İzni açtıktan sonra bu sayfayı yenile.</Notice>;
  return (
    <div className="flex flex-col items-start gap-2">
      {phase === 'on' ? (
        <Button variant="secondary" icon={<BellOff size={18} />} onClick={disable}>
          Anlık bildirimleri kapat
        </Button>
      ) : (
        <Button variant="secondary" icon={<Bell size={18} />} onClick={enable} disabled={phase === 'busy'}>
          Anlık bildirimleri aç
        </Button>
      )}
      <p className="text-small m-0 text-ink-muted" role="status">
        {phase === 'on' ? '✓ Bu cihaz anlık bildirim alıyor.' : phase === 'error' ? '✕ Bildirim ayarı kaydedilemedi. Biraz sonra yeniden dene.' : 'Kapalı: bu cihaz anlık bildirim almıyor.'}
      </p>
    </div>
  );
}
