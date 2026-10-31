'use client';
// Giriş (BLUEPRINT §7, §12 #35): e-posta + şifre; magic link ikincil (PKCE). Panel yalnız anon anahtarı taşır.
import * as React from 'react';
import { Button, Notice, TextField } from '../../lib/ds';
import { getSupabase } from '../../lib/data';
import { useAction, useQueryParam } from '../../lib/hooks';
import { ActionResult } from '../../lib/shell';

function MockLogin() {
  return (
    <Notice tone="info" title="Yerel veri modu">
      Bu derleme fixtures verisiyle çalışır; giriş gerekmez. Rolü seç:{' '}
      <a href="/?role=coordinator">koordinatör</a> · <a href="/?role=instructor">branş eğitmeni</a> · <a href="/?role=observer">gözlemci</a>.
    </Notice>
  );
}

function LiveLogin() {
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const action = useAction();
  const code = useQueryParam('code');

  React.useEffect(() => {
    if (!code) return;
    void action.run(() => getSupabase().auth.exchangeCode(code)).then((r) => {
      if (r.ok) window.location.href = '/';
    });
    // yalnız ilk açılışta
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const r = await action.run(() => getSupabase().auth.signInWithPassword(email.trim(), password));
    if (r.ok) window.location.href = '/';
  };
  const magic = async () => {
    await action.run(() => getSupabase().auth.signInWithOtp(email.trim(), `${window.location.origin}/giris`), 'Giriş bağlantısı e-postana gönderildi.');
  };
  return (
    <form className="form" onSubmit={(e) => void submit(e)}>
      <TextField label="E-posta" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
      <TextField label="Şifre" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
      <div className="row">
        <Button variant="primary" type="submit" disabled={action.busy || !email || !password}>
          Giriş yap
        </Button>
        <Button variant="quiet" type="button" disabled={action.busy || !email} onClick={() => void magic()}>
          Bağlantıyla gir
        </Button>
      </div>
      <ActionResult error={action.error} message={action.message} />
    </form>
  );
}

export default function Page() {
  return (
    <main className="shell-main">
      <h1 className="t-title-1">Giriş</h1>
      <p className="muted">Eğitmen paneline e-posta ve şifrenle gir. Hesabın bir role bağlı değilse koordinatörle görüş.</p>
      {process.env.NEXT_PUBLIC_DATA_SOURCE !== 'live' ? <MockLogin /> : <LiveLogin />}
    </main>
  );
}
