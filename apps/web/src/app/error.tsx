'use client';

import { Button, Notice } from '@/ds';

export default function HataSayfasi({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main id="icerik" className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-4 px-4 py-10">
      <h1 className="text-title-2 m-0 text-ink">Bir şeyler ters gitti</h1>
      <Notice tone="warning">Sayfa yüklenemedi. Yeniden deneyebilirsin; sorun sürerse eğitmenine haber ver.</Notice>
      <div>
        <Button variant="primary" onClick={() => reset()}>
          Yeniden dene
        </Button>
      </div>
    </main>
  );
}
