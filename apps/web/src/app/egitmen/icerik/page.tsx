import type { Metadata } from 'next';
import { EmptyState } from '@/components/EmptyState';
import { PageHeader } from '@/components/PageHeader';
import { ReviewQueue } from '@/components/documents/ReviewQueue';
import { requireRole } from '@/server/auth';
import { listReviewQueue } from '@/server/documents/review';
import { reviewDocument } from './actions';

export const metadata: Metadata = { title: 'İçerik' };

// İçerik: yapay zekânın hazırladığı ve incelemesi gereken notlar/denemeler (review_required, durum "review").
// Onaylanan belge öğrenciye Bugün kartı olarak gider; reddedilen öğrenciye hiç görünmez.
export default async function Sayfa() {
  await requireRole('instructor', 'admin');
  const items = await listReviewQueue();
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
      <PageHeader title="İçerik" description="Üretilen not ve denemelerin incelemesi." />
      {items.length === 0 ? (
        <EmptyState title="İncelenecek içerik yok">
          {"Yapay zekânın hazırladığı notlar ve denemeler yayımlanmadan önce burada incelenir. Şekiller ve çözümler doğrulanmadan öğrenciye gösterilmez."}
        </EmptyState>
      ) : (
        <ReviewQueue items={items} decide={reviewDocument} />
      )}
    </div>
  );
}
