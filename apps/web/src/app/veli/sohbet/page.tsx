import type { Metadata } from 'next';
import { ScreenHeader } from '@/components/shell';
import { requireRole } from '@/server/auth';

export const metadata: Metadata = { title: 'Sohbet' };

// Veli Sohbet (mockup S10b) iskeleti: veli ajanı (dossier ve rapor araçlarıyla; asla cevap anahtarı ya da koç sohbeti)
// P6'da bağlanır.
export default async function VeliSohbet() {
  const { displayName } = await requireRole('parent', 'admin');
  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-6">
      <ScreenHeader title="Sohbet" name={displayName} accountHref="/veli/ayarlar" size="sm" />
      <p className="text-body-lg m-0 text-ink" data-testid="veli-durum">
        Henüz veri yok.
      </p>
      <p className="text-body m-0 text-ink-muted">Çocuğunun bu hafta ne çalıştığını burada soracaksın.</p>
    </div>
  );
}
