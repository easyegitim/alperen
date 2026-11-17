'use client';

import { useEffect } from 'react';

export default function GlobalHata({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error('OGR-WEB-006 kök düzen hatası', error.digest ?? '', error);
  }, [error]);
  return (
    <html lang="tr">
      <body style={{ margin: 0, fontFamily: 'system-ui, sans-serif', display: 'grid', placeItems: 'center', minHeight: '100dvh', padding: 16 }}>
        <main style={{ maxWidth: 360 }}>
          <p style={{ fontSize: 18, margin: '0 0 16px' }}>Bu sayfa şu an açılamadı.</p>
          <button type="button" onClick={() => reset()} style={{ minHeight: 44, padding: '0 20px', fontSize: 16, borderRadius: 8, border: 0, background: '#1f4fd8', color: '#fff', cursor: 'pointer' }}>
            Yeniden dene
          </button>
        </main>
      </body>
    </html>
  );
}
