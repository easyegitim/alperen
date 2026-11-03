import type { Metadata } from 'next';
import { EmptyState } from '@/components/EmptyState';
import { PageHeader } from '@/components/PageHeader';
import { requireRole } from '@/server/auth';
import { listTopics, progressClient } from '@/server/progress/read';
import { studentContext } from '@/server/suggestions/student';
import { TopicList } from '../parcalar';

export const metadata: Metadata = { title: 'Konular' };

// Gelişim › Konular: kanıtı olan yapraklar (mastery_view) zayıf / orta / iyi kelimesiyle; yüzde yok. Kanıt az olanlar "az veri".
export default async function KonularSayfasi() {
  const { user } = await requireRole('student', 'admin');
  const ctx = await studentContext(user.id);
  const topics = ctx?.enrollment ? await listTopics(await progressClient(), ctx.enrollment.id) : [];
  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-6">
      <PageHeader title="Konular" description="Hangi konuda ne durumda olduğunu burada görürsün." />
      {topics.length === 0 ? (
        <EmptyState title="Konu listen henüz boş">
          {'Koçun seni tanıdıkça konular burada zayıf, orta ya da iyi diye görünür.'}
        </EmptyState>
      ) : (
        <div className="rounded-lg border border-line bg-surface-raised px-5 pb-1 [&_li:first-child]:border-t-0">
          <TopicList topics={topics} />
        </div>
      )}
    </div>
  );
}
