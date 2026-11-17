'use client';

import { useRef, useState, type FormEvent } from 'react';
import { LogOut } from 'lucide-react';
import { signOut } from '@/app/auth/actions';
import { Button } from '@/ds';
import { createSupabaseBrowserClient } from '@/lib/supabase/browser';
import { currentSubscription, isPushSupported } from '@/lib/push';

/** Bu cihazın bildirim aboneliğini hesaptan ayırır (satırı siler, tarayıcı aboneliğini iptal eder). Hata çıkışı engellemez. */
async function releasePushSubscription(): Promise<void> {
  if (!isPushSupported()) return;
  try {
    const sub = await currentSubscription();
    if (!sub) return;
    try {
      const supabase = createSupabaseBrowserClient();
      await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
    } catch {
      // Satır silinemese de abonelik iptal edilir: sonraki kullanıcı yeni bir uç nokta alır.
    }
    await sub.unsubscribe();
  } catch {
    // Bildirim temizliği çıkışı engellememeli.
  }
}

/**
 * Çıkış: önce (oturum hâlâ geçerliyken) bu cihazın bildirim aboneliği temizlenir, sonra sunucu eylemi oturumu kapatır
 * ve /giris'e yollar. JavaScript yoksa form doğrudan sunucu eylemine gider.
 * Paylaşılan cihazda önceki kullanıcının bildirimlerinin sonrakine görünmesini önler.
 */
export function SignOutButton({ block = false }: { block?: boolean }) {
  const cleaned = useRef(false);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    if (cleaned.current) return;
    event.preventDefault();
    const form = event.currentTarget;
    setBusy(true);
    // En çok 4 sn beklenir; takılırsa yine de çıkılır.
    await Promise.race([releasePushSubscription(), new Promise<void>((resolve) => setTimeout(resolve, 4000))]);
    cleaned.current = true;
    form.requestSubmit();
  }

  return (
    <form action={signOut} onSubmit={onSubmit}>
      <Button type="submit" variant="secondary" block={block} icon={<LogOut size={18} />} disabled={busy}>
        Çıkış yap
      </Button>
    </form>
  );
}
