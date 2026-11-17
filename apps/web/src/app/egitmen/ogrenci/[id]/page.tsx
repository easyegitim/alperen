import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { PageHeader } from '@/components/PageHeader';
import { GRADE_LABELS, GRADES } from '@/lib/validation';
import { requireRole } from '@/server/auth';
import type { SkillLine } from '@/server/student-detail/present';
import { loadStudentDetail } from '@/server/student-detail/read';
import { BandPill } from '@/app/ogrenci/gelisim/parcalar';

export const metadata: Metadata = { title: 'Öğrenci' };

// Eğitmen › Öğrenci dossier'i (salt okunur): ustalık özeti (kelime bandı, yüzde yok), açık yanılgılar, son teşhisler,
// son denemeler, hafıza dosyaları. Bağlı olmayan ya da bulunamayan öğrenci → 404.
export default async function OgrenciDossier({ params }: { params: Promise<{ id: string }> }) {
  const { user, role } = await requireRole('instructor', 'admin');
  const { id } = await params;
  const d = await loadStudentDetail({ id: user.id, role }, id);
  if (!d) notFound();

  const grade = d.grade && (GRADES as readonly string[]).includes(d.grade) ? GRADE_LABELS[d.grade as (typeof GRADES)[number]] : null;
  const facts = [grade, d.course, d.targetExam, d.examDate ? `Sınav: ${d.examDate}${d.daysLeft !== null ? ` (${d.daysLeft} gün)` : ''}` : null].filter(Boolean).join(' · ');

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4">
      <Link href="/egitmen" className="text-small text-primary">
        ← Öğrenciler
      </Link>
      <PageHeader title={d.name} description={facts || 'Kayıt bilgisi yok'} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Section title="Ustalık özeti">
          {d.mastery.weakest.length + d.mastery.strongest.length === 0 ? (
            <Empty>Henüz bant çıkacak kadar kanıt yok.</Empty>
          ) : (
            <div className="flex flex-col gap-3">
              <SkillList label="En zayıf" lines={d.mastery.weakest} />
              <SkillList label="En güçlü" lines={d.mastery.strongest} />
            </div>
          )}
          {d.mastery.thin > 0 ? <p className="text-small m-0 mt-2 text-ink-muted">{`${d.mastery.thin} konuda az veri.`}</p> : null}
        </Section>

        <Section title="Açık yanılgılar">
          {d.misconceptions.length === 0 ? (
            <Empty>Açık yanılgı yok.</Empty>
          ) : (
            <ul className="m-0 flex list-none flex-col p-0">
              {d.misconceptions.map((m) => (
                <li key={m.id} className="flex flex-col gap-0.5 border-t border-line py-2 first:border-t-0">
                  <span className="flex items-baseline justify-between gap-3">
                    <code className="text-small truncate text-ink">{m.tag}</code>
                    <span className="text-small shrink-0 text-ink-muted">{`${m.evidence} kanıt`}</span>
                  </span>
                  <span className="text-small text-ink-muted">{m.text}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="Son teşhisler">
          {d.diagnoses.length === 0 ? (
            <Empty>Henüz teşhis yok.</Empty>
          ) : (
            <ul className="m-0 flex list-none flex-col p-0">
              {d.diagnoses.map((x) => (
                <li key={x.id} className="flex flex-col gap-0.5 border-t border-line py-2 first:border-t-0">
                  <span className="text-small flex justify-between gap-3 text-ink-muted">
                    <span className="truncate">{[x.date, x.skill].filter(Boolean).join(' · ')}</span>
                    <span className="shrink-0 font-medium text-ink">{x.cause}</span>
                  </span>
                  <span className="text-small text-ink">{x.sentence}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="Son denemeler">
          {d.exams.length === 0 ? (
            <Empty>Henüz deneme yok.</Empty>
          ) : (
            <ul className="m-0 flex list-none flex-col p-0">
              {d.exams.map((e) => (
                <li key={e.id} className="text-small flex items-baseline justify-between gap-3 border-t border-line py-2 first:border-t-0">
                  <span className="min-w-0 truncate text-ink">{e.title}</span>
                  <span className="shrink-0 text-ink-muted">{`${e.date} · ${e.result}`}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>

      <Section title="Hafıza dosyaları">
        {d.memory.length === 0 ? (
          <Empty>Hafıza dosyası yok.</Empty>
        ) : (
          <div className="flex flex-col gap-2">
            {d.memory.map((f) => (
              <details key={f.path} className="rounded-md border border-line">
                <summary className="text-small cursor-pointer px-3 py-2 text-ink">
                  <code>{f.path}</code>
                </summary>
                <pre className="text-small m-0 overflow-x-auto border-t border-line px-3 py-2 whitespace-pre-wrap text-ink">{f.content || '(boş)'}</pre>
              </details>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="rounded-lg border border-line bg-surface-raised p-4">
      <h2 className="text-label m-0 mb-2 text-ink">{title}</h2>
      {children}
    </section>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="text-small m-0 text-ink-muted">{children}</p>;
}

function SkillList({ label, lines }: { label: string; lines: SkillLine[] }) {
  if (lines.length === 0) return null;
  return (
    <div>
      <h3 className="text-small m-0 mb-1 font-medium text-ink-muted">{label}</h3>
      <ul className="m-0 flex list-none flex-col p-0">
        {lines.map((s) => (
          <li key={s.skillId} className="flex items-center justify-between gap-3 border-t border-line py-1.5 first:border-t-0">
            <span className="text-small min-w-0 truncate text-ink">{s.name}</span>
            <span className="flex shrink-0 items-center gap-2">
              <span className="text-small text-ink-muted">{`${s.evidence} kanıt`}</span>
              <BandPill band={s.band} word={s.word} />
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
