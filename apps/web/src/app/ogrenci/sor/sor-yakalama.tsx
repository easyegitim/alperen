'use client';

import { useState } from 'react';
import { CameraSheet, Notice, type CameraSheetResult } from '@/ds';

/**
 * Kamera yakalama: tasarım sisteminin CameraSheet bileşeni. Yükleme ve teşhis hattı henüz bağlı değil;
 * gönderimde fotoğraflar yalnız bu cihazda hazırlanır ve kullanıcıya bunu açıkça söyleriz.
 */
export function SorYakalama() {
  const [result, setResult] = useState<CameraSheetResult | null>(null);
  if (result) {
    return (
      <Notice tone="info" title="Fotoğrafların hazır">
        {result.items.length} sayfa bu cihazda hazırlandı. Soru analizi henüz açık değil; açıldığında buradan gönderebileceksin. Hiçbir şey sunucuya gönderilmedi.
      </Notice>
    );
  }
  return <CameraSheet onSubmit={setResult} onCancel={() => setResult(null)} />;
}
