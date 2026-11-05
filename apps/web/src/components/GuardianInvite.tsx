'use client';

import { useActionState, useState } from 'react';
import { Copy, Share2, UserPlus } from 'lucide-react';
import { Button, Notice } from '@/ds';
import { SelectField } from '@/components/SelectField';
import { formatDateTimeTr } from '@/lib/format';
import { createGuardianInvite, type InviteCreateState } from '@/app/davet/actions';

const RELATION_OPTIONS = [
  { value: 'anne', label: 'Anne' },
  { value: 'baba', label: 'Baba' },
  { value: 'vasi', label: 'Vasi' },
  { value: 'diğer', label: 'Diğer' },
];

/**
 * Veli daveti üretir ve kodu bir kez gösterir (süreyi RPC döndürür). Öğrenci Profil sayfasında `studentId` vermez
 * (sunucu kendi kaydını bulur); eğitmen öğrenci kartında verir.
 */
export function GuardianInvite({ studentId, compact = false, simple = false }: { studentId?: string; compact?: boolean; /** Öğrenci Profil'i: yakınlık seçimi yok, tek düğme "Veli davet et"; kod Paylaş ile gider. */ simple?: boolean }) {
  const [state, action, pending] = useActionState<InviteCreateState, FormData>(createGuardianInvite, {});
  const [copied, setCopied] = useState<'kod' | 'baglanti' | 'hata' | null>(null);
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';
  const token = state.token;
  const link = token && typeof window !== 'undefined' ? `${window.location.origin}/davet?kod=${encodeURIComponent(token)}` : null;

  async function copy(kind: 'kod' | 'baglanti', value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(kind);
    } catch {
      setCopied('hata');
    }
  }

  async function share(value: string, url: string | null) {
    try {
      await navigator.share({ title: 'Öğrenmen veli daveti', text: `Öğrenmen’de gelişimimi görebilmen için davet kodun: ${value}`, ...(url ? { url } : {}) });
    } catch {
      /* paylaşım iptal edildi */
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <form action={action} className={compact ? 'flex flex-wrap items-end gap-2' : 'flex max-w-md flex-col gap-3'}>
        {studentId ? <input type="hidden" name="studentId" value={studentId} /> : null}
        {simple ? null : <SelectField label="Yakınlık (isteğe bağlı)" name="relation" defaultValue="" placeholder="Seçmeden devam edebilirsin" options={RELATION_OPTIONS} />}
        <div>
          <Button type="submit" variant={simple ? 'primary' : 'secondary'} icon={<UserPlus size={18} />} disabled={pending}>
            {pending ? 'Üretiliyor' : simple ? (token ? 'Yeni davet' : 'Veli davet et') : token ? 'Yeni davet kodu üret' : 'Davet kodu üret'}
          </Button>
        </div>
      </form>
      {state.error ? <Notice tone="warning">{state.error}</Notice> : null}
      {token ? (
        <div className="flex flex-col gap-2 rounded-md border border-line bg-surface-sunken p-3" role="status">
          <span className="text-label text-ink">Davet kodu</span>
          <code data-testid="davet-kodu" className="text-body font-mono break-all text-ink">
            {token}
          </code>
          <p className="text-small m-0 text-ink-muted">
            Bir kez kullanılır. Bu kod yalnız şimdi gösterilir; velin giriş yapıp kodu girdiğinde bağlantı kurulur.
            {state.expiresAt ? ` Son kullanma: ${formatDateTimeTr(state.expiresAt)}.` : ''}
          </p>
          <div className="flex flex-wrap gap-2">
            {simple && canShare ? (
              <Button type="button" variant="secondary" size="sm" icon={<Share2 size={16} />} onClick={() => void share(token, link)}>
                Paylaş
              </Button>
            ) : null}
            <Button type="button" variant="quiet" size="sm" icon={<Copy size={16} />} onClick={() => copy('kod', token)}>
              Kodu kopyala
            </Button>
            {link ? (
              <Button type="button" variant="quiet" size="sm" icon={<Copy size={16} />} onClick={() => copy('baglanti', link)}>
                Bağlantıyı kopyala
              </Button>
            ) : null}
          </div>
          <p className="text-small m-0 text-ink-muted" aria-live="polite">
            {copied === 'kod' ? '✓ Kod kopyalandı.' : copied === 'baglanti' ? '✓ Bağlantı kopyalandı.' : copied === 'hata' ? 'Kopyalanamadı; kodu elle seçip kopyala.' : ''}
          </p>
        </div>
      ) : null}
    </div>
  );
}
