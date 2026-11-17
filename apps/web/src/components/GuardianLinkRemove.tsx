'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/ds';
import { revokeGuardianLink } from '@/app/ogrenci/profil/actions';

/** Sessiz "Bağlantıyı kaldır"; ikinci adımda "Eminim, kaldır" çıkar (modal yok). */
export function GuardianLinkRemove({ linkId }: { linkId: string }) {
  const [confirming, setConfirming] = useState(false);
  const [failed, setFailed] = useState(false);
  const [pending, start] = useTransition();
  if (!confirming) {
    return (
      <Button type="button" variant="quiet" size="sm" onClick={() => setConfirming(true)}>
        Bağlantıyı kaldır
      </Button>
    );
  }
  return (
    <span className="inline-flex items-center gap-2">
      <Button
        type="button"
        variant="quiet"
        size="sm"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const res = await revokeGuardianLink(linkId);
            setFailed(!res.ok);
            if (!res.ok) setConfirming(false);
          })
        }
      >
        Eminim, kaldır
      </Button>
      <Button type="button" variant="quiet" size="sm" disabled={pending} onClick={() => setConfirming(false)}>
        Vazgeç
      </Button>
      {failed ? <span role="alert">Kaldırılamadı.</span> : null}
    </span>
  );
}
