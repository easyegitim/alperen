import type { Metadata } from 'next';
import { WifiOff } from 'lucide-react';
import { AppBrand } from '@/components/AppBrand';
import { EmptyState } from '@/components/EmptyState';
import { ReloadButton } from './reload-button';

export const metadata: Metadata = { title: 'Çevrimdışı' };

// Önceden önbelleğe alınan yedek sayfa (servis çalışanı): internet yokken gezinti isteği buraya düşer. Kişisel veri içermez.
export default function Cevrimdisi() {
  return (
    <main id="icerik" className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-6 px-4 py-10">
      <AppBrand size="md" />
      <EmptyState title="İnternet bağlantın yok" action={<ReloadButton />}>
        {'Öğrenmen çalışmak için bağlantıya ihtiyaç duyar. Bağlantı geri geldiğinde kaldığın yerden devam edebilirsin.'}
      </EmptyState>
      <p className="text-small m-0 flex items-center justify-center gap-2 text-ink-muted">
        <WifiOff aria-hidden="true" size={16} />
        Bağlantı yokken kişisel verilerin cihazında saklanmaz.
      </p>
    </main>
  );
}
