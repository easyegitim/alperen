'use client';

import { useActionState, useRef } from 'react';
import { Mail } from 'lucide-react';
import { Button, TextField } from '@/ds';
import type { LocalDemoAccount } from '@/lib/local-dev';
import { loginStep, signInWithGoogle, type LoginState } from './actions';

const INITIAL: LoginState = { step: 'email' };

/**
 * Giriş formu: e-posta -> kod; ayrıca Google. Tüm metinler Türkçe, hatalar kelimeyle söylenir.
 * `localAccounts` yalnız yerel denemede (NEXT_PUBLIC_LOCAL_DEV=1) verilir: tek dokunuşla e-posta alanını doldurur.
 */
export function GirisFormu({ next, localAccounts }: { next: string; localAccounts?: readonly LocalDemoAccount[] }) {
  const [state, action, pending] = useActionState(loginStep, INITIAL);
  const email = state.email ?? '';
  const emailRef = useRef<HTMLInputElement>(null);

  return (
    <div className="flex flex-col gap-6">
      {state.step === 'email' ? (
        <form action={action} className="flex flex-col gap-4" noValidate>
          <input type="hidden" name="step" value="email" />
          <input type="hidden" name="next" value={next} />
          <TextField
            label="E-posta adresin"
            name="email"
            type="email"
            autoComplete="email"
            inputMode="email"
            required
            defaultValue={email}
            ref={emailRef}
            error={state.error}
            hint="Sana 6 haneli bir kod ve giriş bağlantısı göndereceğiz."
          />
          {localAccounts?.length ? (
            <div className="flex flex-wrap gap-2" role="group" aria-label="Yerel deneme hesapları">
              {localAccounts.map((a) => (
                <Button
                  key={a.email}
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    if (!emailRef.current) return;
                    emailRef.current.value = a.email;
                    emailRef.current.focus();
                  }}
                >
                  {a.label}
                </Button>
              ))}
            </div>
          ) : null}
          <Button type="submit" variant="primary" size="lg" block icon={<Mail size={20} />} disabled={pending}>
            {pending ? 'Gönderiliyor' : 'Kod gönder'}
          </Button>
        </form>
      ) : (
        <form action={action} className="flex flex-col gap-4" noValidate>
          <input type="hidden" name="step" value="code" />
          <input type="hidden" name="next" value={next} />
          <input type="hidden" name="email" value={email} />
          <p className="text-body m-0 text-ink" role="status">
            <strong className="font-semibold">{email}</strong> adresine bir kod gönderdik. Kodu yaz ya da e-postadaki bağlantıya dokun.
          </p>
          <TextField
            label="E-posta kodu"
            name="code"
            autoComplete="one-time-code"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={8}
            required
            mono
            error={state.error}
          />
          <Button type="submit" variant="primary" size="lg" block disabled={pending}>
            {pending ? 'Doğrulanıyor' : 'Giriş yap'}
          </Button>
          <Button type="submit" name="intent" value="resend" variant="quiet" block disabled={pending} formNoValidate>
            Kodu yeniden gönder
          </Button>
        </form>
      )}

      <div className="flex items-center gap-3 text-ink-muted" role="separator" aria-label="ya da">
        <span className="h-px flex-1 bg-line" />
        <span className="text-small">ya da</span>
        <span className="h-px flex-1 bg-line" />
      </div>

      <form action={signInWithGoogle}>
        <input type="hidden" name="next" value={next} />
        <Button type="submit" variant="secondary" size="lg" block>
          Google ile devam et
        </Button>
      </form>
    </div>
  );
}
