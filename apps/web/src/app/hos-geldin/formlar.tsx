'use client';

import { useActionState } from 'react';
import { Notice, Button, TextField } from '@/ds';
import { completeParentOnboarding, type OnboardingState } from './actions';

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
