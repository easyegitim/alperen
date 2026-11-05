import type { Metadata } from 'next';
import Link from 'next/link';
import { ScreenHeader } from '@/components/shell';
import { requireRole } from '@/server/auth';
import { formatNet } from '@/server/progress/present';
import { LibraryList } from '@/components/documents/Library';
import { documentDb } from '@/server/documents/read';
import { libraryRows } from '@/server/documents/present';
import { listMyDocuments } from '@/server/documents/rpc';
import { loadProgress } from '@/server/progress/read';
import { studentContext } from '@/server/suggestions/student';
import { loadStudentStyleSummary } from '@/server/styles/read';
import { loadStudentLessons } from '@/server/lessons/read';
import { WeeklyLine } from './grafik';
import { Fold, Stat, TopicList } from './parcalar';
import { StyleCoverageLine } from './tarz';
import { LessonsFold } from './dersler';

export const metadata: Metadata = { title: 'Gelişim' };

const TOPICS_INLINE = 12;
const DOCUMENTS_INLINE = 5;

// Gelişim (mockup S08; PLAN-v2 §13): 3 sayı (bu hafta çözülen soru · son deneme neti · hedefe kalan gün), haftalık
// çizgi, katlı Konular (mastery_view bantları kelimeyle) ve katlı Belgelerim (PDF görüntüleyiciye gider).
export default async function GelisimSayfasi() {
  const { user, displayName } = await requireRole('student', 'admin');
  const p = await loadProgress(user.id);
  const mine = await listMyDocuments(await documentDb());
  // Tarz kapsama satırı (P4): kaydın dersinde etkin tarz yoksa ya da okunamazsa hiç çizilmez
  const enrollment = (await studentContext(user.id))?.enrollment ?? null;
  const styles = enrollment ? await loadStudentStyleSummary(enrollment.id) : null;
  // Dersler (P5): yalnız eğitmenin öğrenciye görünür yaptıkları; yoksa katlı bölüm çizilmez
  const lessons = await loadStudentLessons();
  const documents = mine.ok ? libraryRows(mine.data) : (p?.documents ?? []).map((d) => ({ ...d, word: 'Hazır' as const, open: true }));
  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-8">
      <ScreenHeader title="Gelişim" name={displayName} accountHref="/ogrenci/profil" size="sm" />
      <dl aria-label="Özet" className="m-0 grid grid-cols-3 gap-3" data-testid="uc-sayi">
        <Stat value={String(p?.weekCount ?? 0)} unit="soru" label="bu hafta" />
        <Stat value={p?.lastNet != null ? formatNet(p.lastNet) : 'henüz yok'} unit="net" label="son deneme" />
        <Stat value={p?.daysLeft != null ? String(p.daysLeft) : 'tarih yok'} unit="gün" label={p?.examLabel ?? 'hedefe'} />
      </dl>

      <section aria-labelledby="grafik-baslik" className="flex flex-col gap-4 rounded-lg border border-line bg-surface-raised p-5">
        <h2 id="grafik-baslik" className="text-title-3 m-0 text-ink">
          Günlük soru
        </h2>
        {p ? <WeeklyLine days={p.days} /> : null}
      </section>

      <div className="flex flex-col gap-3">
        <Fold title="Konular" testId="konular">
          {p && p.topics.length > 0 ? (
            <>
              <TopicList topics={p.topics.slice(0, TOPICS_INLINE)} />
              {p.topics.length > TOPICS_INLINE ? (
                <Link href="/ogrenci/gelisim/konular" className="text-label inline-flex min-h-11 items-center text-primary">
                  Tüm konular
                </Link>
              ) : null}
            </>
          ) : (
            <p className="text-small m-0 border-t border-line pt-3 text-ink-muted">Birkaç test çözünce konuların burada zayıf, orta ya da iyi diye görünür.</p>
          )}
          <StyleCoverageLine summary={styles} />
        </Fold>
        {lessons.items.length > 0 ? (
          <Fold title="Dersler" testId="dersler">
            <LessonsFold items={lessons.items} total={lessons.total} />
          </Fold>
        ) : null}
        <Fold title="Belgelerim" testId="belgelerim">
          {documents.length > 0 ? (
            <>
              <LibraryList rows={documents.slice(0, DOCUMENTS_INLINE)} />
              {documents.length > DOCUMENTS_INLINE ? (
                <Link href="/ogrenci/gelisim/belgeler" className="text-label inline-flex min-h-11 items-center text-primary">
                  Tüm belgeler
                </Link>
              ) : null}
            </>
          ) : (
            <p className="text-small m-0 border-t border-line pt-3 text-ink-muted">Henüz belgen yok. Koçtan not istediğinde burada PDF olarak durur.</p>
          )}
        </Fold>
      </div>
    </div>
  );
}
