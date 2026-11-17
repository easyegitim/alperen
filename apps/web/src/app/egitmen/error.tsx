'use client';

import { useEffect } from 'react';
import { Button } from '@/ds';
import { LinkButton } from '@/components/LinkButton';

export default function HataSayfasi({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error('OGR-WEB-005 sayfa açılamadı', error.digest ?? '', error);
  }, [error]);
  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-4 py-10">
      <p className="text-body m-0 text-ink">Bu sayfa şu an açılamadı.</p>
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="primary" onClick={() => reset()}>
          Yeniden dene
        </Button>
        <LinkButton href="/egitmen" variant="quiet">
          Ana sayfaya dön
        </LinkButton>
      </div>
    </div>
  );
}
