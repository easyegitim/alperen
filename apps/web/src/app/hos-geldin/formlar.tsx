'use client';

import { useActionState } from 'react';
import { Notice, Button, TextField } from '@/ds';
import { SelectField } from '@/components/SelectField';
import { GRADES, GRADE_LABELS, TARGET_EXAMS, TARGET_EXAM_LABELS, type StudentProfileInput } from '@/lib/validation';
import { completeParentOnboarding, completeStudentOnboarding, type OnboardingState } from './actions';

const gradeOptions = GRADES.map((g) => ({ value: g, label: GRADE_LABELS[g] }));
const examOptions = TARGET_EXAMS.map((e) => ({ value: e, label: TARGET_EXAM_LABELS[e] }));

export function OgrenciFormu({ defaultName }: { defaultName: string }) {
  const [state, action, pending] = useActionState<OnboardingState<keyof StudentProfileInput>, FormData>(completeStudentOnboarding, {});
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      {state.formError ? <Notice tone="warning">{state.formError}</Notice> : null}
      <TextField label="Adın" name="displayName" autoComplete="given-name" required defaultValue={defaultName} error={state.errors?.displayName} />
      <SelectField label="Sınıfın" name="grade" required defaultValue="" placeholder="Sınıfını seç" options={gradeOptions} error={state.errors?.grade} />
      <SelectField label="Hedefin" name="targetExam" required defaultValue="" placeholder="Hedefini seç" options={examOptions} error={state.errors?.targetExam} />
      <TextField
        label="Hedefini bir cümleyle yaz (isteğe bağlı)"
        name="goal"
        maxLength={280}
        hint="Örneğin: Matematik netlerimi 20'ye çıkarmak."
        error={state.errors?.goal}
      />
      <Button type="submit" variant="primary" size="lg" block disabled={pending}>
        {pending ? 'Kaydediliyor' : 'Başla'}
      </Button>
    </form>
  );
}

export function VeliFormu({ defaultName }: { defaultName: string }) {
  const [state, action, pending] = useActionState<OnboardingState<'displayName' | 'token'>, FormData>(completeParentOnboarding, {});
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      {state.formError ? <Notice tone="warning">{state.formError}</Notice> : null}
      <TextField label="Adın" name="displayName" autoComplete="name" required defaultValue={defaultName} error={state.errors?.displayName} />
      <TextField
        label="Davet kodu"
        name="token"
        required
        mono
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        placeholder="gi_…"
        hint="Öğrencinin ya da eğitmeninin gönderdiği kodu aynen yapıştır. Kod 72 saat geçerlidir."
        error={state.errors?.token}
      />
      <Button type="submit" variant="primary" size="lg" block disabled={pending}>
        {pending ? 'Doğrulanıyor' : 'Daveti kabul et'}
      </Button>
    </form>
  );
}
