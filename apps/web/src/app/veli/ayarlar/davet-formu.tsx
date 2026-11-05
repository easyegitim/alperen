'use client';

import { useActionState } from 'react';
import { Button, TextField } from '@/ds';
import { acceptInvite, type DavetState } from './actions';

export function DavetFormu({ defaultToken = '' }: { defaultToken?: string }) {
  const [state, action, pending] = useActionState<DavetState, FormData>(acceptInvite, {});
  return (
    <form action={action} className="flex max-w-md flex-col gap-3" noValidate>
      <TextField label="Davet kodu" name="token" defaultValue={defaultToken} mono autoCapitalize="none" autoCorrect="off" spellCheck={false} placeholder="gi_…" error={state.error} />
      <div>
        <Button type="submit" variant="secondary" disabled={pending}>
          {pending ? 'Doğrulanıyor' : 'Daveti kabul et'}
        </Button>
      </div>
      {state.ok ? (
        <p role="status" className="text-small m-0 text-success">
          Davet kabul edildi. Çocuğunuz Özet sayfasında görünecek.
        </p>
      ) : null}
    </form>
  );
}
