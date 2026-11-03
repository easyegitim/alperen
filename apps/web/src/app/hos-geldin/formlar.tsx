'use client';

import { useActionState, useMemo, useState } from 'react';
import { Notice, Button, TextField } from '@/ds';
import { SelectField } from '@/components/SelectField';
import { GRADES, GRADE_LABELS, targetExamOf, type StudentProfileInput } from '@/lib/validation';
import type { EnrollableCourse } from '@/server/queries';
import { completeParentOnboarding, completeStudentOnboarding, type OnboardingState } from './actions';

const gradeOptions = GRADES.map((g) => ({ value: g, label: GRADE_LABELS[g] }));

const CHIPS = [
  { id: 'all', label: 'Hepsi' },
  { id: 'TYT', label: 'TYT' },
  { id: 'AYT', label: 'AYT' },
  { id: 'LGS', label: 'LGS' },
  { id: 'final', label: 'Okul ve üniversite' },
] as const;

/** İki adımlı öğrenci kurulumu: (1) hangi sınava/derse hazırlanıyorsun, (2) hedef tarihin. Ad ve sınıf isteğe bağlıdır. */
export function OgrenciFormu({ defaultName, courses }: { defaultName: string; courses: EnrollableCourse[] }) {
  const [state, action, pending] = useActionState<OnboardingState<keyof StudentProfileInput>, FormData>(completeStudentOnboarding, {});
  const [step, setStep] = useState<1 | 2>(1);
  const [query, setQuery] = useState('');
  const [chip, setChip] = useState<(typeof CHIPS)[number]['id']>('all');
  const [courseId, setCourseId] = useState('');

  const visible = useMemo(() => {
    const q = query.trim().toLocaleLowerCase('tr');
    return courses.filter((c) => (chip === 'all' || targetExamOf(c) === chip) && (q === '' || c.title.toLocaleLowerCase('tr').includes(q)));
  }, [courses, query, chip]);
  const selected = courses.find((c) => c.id === courseId);
  const today = new Date().toISOString().slice(0, 10);

  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      {state.formError ? <Notice tone="warning">{state.formError}</Notice> : null}
      <input type="hidden" name="courseId" value={courseId} />

      {step === 1 ? (
        <>
          <h2 className="text-title-2 m-0 text-ink">Hangi sınava ya da derse hazırlanıyorsun?</h2>
          {courses.length === 0 ? (
            <Notice tone="info">Şu an seçilebilir bir ders yok. Devam et; ders eklendiğinde koçun sana haber verir.</Notice>
          ) : (
            <>
              <TextField
                label="Ara"
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') e.preventDefault();
                }}
              />
              <div role="group" aria-label="Sınav türü" className="flex flex-wrap gap-2">
                {CHIPS.map((c) => (
                  <Button key={c.id} type="button" size="sm" variant={chip === c.id ? 'primary' : 'secondary'} aria-pressed={chip === c.id} onClick={() => setChip(c.id)}>
                    {c.label}
                  </Button>
                ))}
              </div>
              <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
                <legend className="sr-only">Ders</legend>
                {visible.length === 0 ? <p className="text-small m-0 text-ink-muted">Eşleşen ders bulunamadı.</p> : null}
                {visible.map((c) => (
                  <label key={c.id} className="text-body flex min-h-11 cursor-pointer items-center gap-3 rounded-md border border-line bg-surface-raised px-3 text-ink has-[:checked]:border-primary has-[:checked]:bg-primary-soft">
                    <input type="radio" checked={courseId === c.id} onChange={() => setCourseId(c.id)} className="size-4 accent-[var(--og-color-primary,currentColor)]" />
                    {c.title}
                  </label>
                ))}
              </fieldset>
            </>
          )}
          {state.errors?.courseId ? <Notice tone="warning">{state.errors.courseId}</Notice> : null}
          <Button type="button" variant="primary" size="lg" block disabled={courses.length > 0 && courseId === ''} onClick={() => setStep(2)}>
            Devam
          </Button>
        </>
      ) : (
        <>
          <h2 className="text-title-2 m-0 text-ink">Hedef tarihin?</h2>
          {selected ? <p className="text-small m-0 text-ink-muted">{selected.title}</p> : null}
          {state.errors?.courseId ? <Notice tone="warning">{state.errors.courseId}</Notice> : null}
          <TextField label="Sınav ya da hedef tarihi" name="examDate" type="date" min={today} hint="Bilmiyorsan boş bırakabilirsin." error={state.errors?.examDate} />
          <details className="rounded-md border border-line bg-surface-raised p-3">
            <summary className="text-label cursor-pointer text-ink">Adın ve sınıfın (isteğe bağlı)</summary>
            <div className="mt-3 flex flex-col gap-4">
              <TextField label="Adın" name="displayName" autoComplete="given-name" defaultValue={defaultName} error={state.errors?.displayName} />
              <SelectField label="Sınıfın" name="grade" defaultValue="" placeholder="Sınıfını seç" options={gradeOptions} error={state.errors?.grade} />
            </div>
          </details>
          <Button type="submit" variant="primary" size="lg" block disabled={pending}>
            {pending ? 'Hazırlıyorum…' : 'Bitir'}
          </Button>
          <Button type="button" variant="quiet" onClick={() => setStep(1)} disabled={pending}>
            Geri
          </Button>
        </>
      )}
    </form>
  );
}

export function VeliFormu({ defaultName, defaultToken = '', tokenOptional = false }: { defaultName: string; defaultToken?: string; tokenOptional?: boolean }) {
  const [state, action, pending] = useActionState<OnboardingState<'displayName' | 'token'>, FormData>(completeParentOnboarding, {});
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      {state.formError ? <Notice tone="warning">{state.formError}</Notice> : null}
      <TextField label="Adın" name="displayName" autoComplete="name" required defaultValue={defaultName} error={state.errors?.displayName} />
      <TextField
        label={tokenOptional ? 'Davet kodu (isteğe bağlı)' : 'Davet kodu'}
        name="token"
        required={!tokenOptional}
        defaultValue={tokenOptional ? '' : defaultToken}
        mono
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        placeholder="gi_…"
        hint={tokenOptional ? 'Davetin zaten kabul edildi; yalnız adını yazman yeterli.' : 'Öğrencinin ya da eğitmeninin gönderdiği kodu aynen yapıştır.'}
        error={state.errors?.token}
      />
      <Button type="submit" variant="primary" size="lg" block disabled={pending}>
        {pending ? 'Doğrulanıyor' : 'Daveti kabul et'}
      </Button>
    </form>
  );
}
