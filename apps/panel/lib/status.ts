// Öğrenci durumu: rozet metni ve onaydan türeyen durum (live ve mock aynı kuralı kullanır).
// §3.9 record_staff_consent / redeem_* gövdeleri: `status = case when consent_ok(sid) then 'active' else 'pending_consent' end`
// (silinmiş öğrenciye dokunulmaz). Koordinatörün onay iptali ve is_minor düzeltmesi aynı kuralla yeniden hesaplanır.
import type { ConsentKind } from './data/types';

export type BadgeTone = 'success' | 'warning' | 'neutral' | 'danger';

export const STUDENT_STATUS_TEXT: Record<string, { tone: BadgeTone; text: string }> = {
  active: { tone: 'success', text: 'Etkin' },
  pending_consent: { tone: 'warning', text: 'Onay bekliyor' },
  paused: { tone: 'neutral', text: 'Durduruldu' },
  deleted: { tone: 'danger', text: 'Silindi' },
};

export function studentStatusBadge(status: string): { tone: BadgeTone; text: string } {
  return STUDENT_STATUS_TEXT[status] ?? { tone: 'neutral', text: status };
}

/** public.consent_ok(): KVKK aydınlatma verilmiş ve (reşit ya da veli onayı verilmiş). */
export function consentOk(given: ReadonlySet<ConsentKind | string>, isMinor: boolean): boolean {
  return given.has('kvkk_aydinlatma') && (!isMinor || given.has('veli_onayi'));
}

/** Onay değişikliğinden sonra yazılacak durum; silinmiş öğrencide null (dokunulmaz). */
export function statusAfterConsentChange(current: string, given: ReadonlySet<ConsentKind | string>, isMinor: boolean): string | null {
  if (current === 'deleted') return null;
  return consentOk(given, isMinor) ? 'active' : 'pending_consent';
}
