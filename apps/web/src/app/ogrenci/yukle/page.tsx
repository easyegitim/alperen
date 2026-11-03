import type { Metadata } from 'next';
import Link from 'next/link';
import { X } from 'lucide-react';
import { Notice } from '@/ds';
import { requireRole } from '@/server/auth';
import { YukleAkisi } from './yukle-akisi';

export const metadata: Metadata = { title: 'Yükle' };

// Yükle (PLAN-v2 §13, mockup S07): iki seçenek → çek ya da PDF seç → Gönder. Gerisini koç yapar.
// Admin öğrenci kabuğunu görebilir ama yükleyemez (submit_upload yalnız öğrenci): dosya girişi gösterilmez, böylece
// Storage'a sahipsiz nesne düşmez.
export default async function YukleSayfasi() {
  const { user, role } = await requireRole('student', 'admin');
  return (
    <div className="mx-auto flex w-full max-w-lg flex-col">
      <div className="flex justify-end">
        <Link href="/ogrenci" aria-label="Kapat" className="flex size-11 items-center justify-center rounded-full text-ink-muted hover:bg-surface-sunken hover:text-ink">
          <X aria-hidden="true" size={22} strokeWidth={1.75} />
        </Link>
      </div>
      {role === 'student' ? (
        <YukleAkisi ownerId={user.id} />
      ) : (
        <Notice tone="info" title="Yükleme yalnız öğrenci hesabıyla">
          Bu ekranı öğrenci hesabıyla açtığında sayfa ekleyip gönderebilirsin.
        </Notice>
      )}
    </div>
  );
}
