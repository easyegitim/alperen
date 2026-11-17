// Onboarding'in saf parçaları (test/onboarding.test.ts): çipler, metin doğrulaması, onboarding_enroll yanıtı ve
// sonraki ekran kararı.
import { z } from 'zod';

/** Mockup S01'in 6 çipi. "Üniversite dersi" ve "Diğer" metin ister (arama kutusuna odaklanır). */
export const ONBOARDING_CHIPS = [
  { id: 'TYT', label: 'TYT', text: 'TYT' },
  { id: 'AYT', label: 'AYT', text: 'AYT' },
  { id: 'LGS', label: 'LGS', text: 'LGS' },
  { id: 'KPSS', label: 'KPSS', text: 'KPSS' },
  { id: 'uni', label: 'Üniversite dersi', text: null },
  { id: 'diger', label: 'Diğer', text: null },
] as const;

export type ChipId = (typeof ONBOARDING_CHIPS)[number]['id'];

/** Gönderilecek ders metni: yazılan metin önce, yoksa seçili çipin metni. */
export function courseTextOf(chip: ChipId | null, typed: string): string {
  const t = typed.trim().replace(/\s+/g, ' ');
  if (t) return t;
  const c = ONBOARDING_CHIPS.find((x) => x.id === chip);
  return c?.text ?? '';
}

export function parseCourseText(raw: FormDataEntryValue | null): { ok: true; value: string } | { ok: false; error: string } {
  const v = typeof raw === 'string' ? raw.trim().replace(/\s+/g, ' ') : '';
  if (v.length < 2) return { ok: false, error: 'Hangi sınava ya da derse hazırlandığını seç ya da yaz.' };
  if (v.length > 120) return { ok: false, error: 'Ders adı en çok 120 harf olabilir.' };
  return { ok: true, value: v };
}

/** Hedef tarih alanı: boş ya da "Bilmiyorum" (atla) ise null; biçim bozuksa hata. Geçmiş tarihi RPC reddeder (OGR-ONB-002). */
export function parseExamDate(raw: FormDataEntryValue | null, skipped: FormDataEntryValue | null): { ok: true; value: string | null } | { ok: false; error: string } {
  if (skipped) return { ok: true, value: null };
  const v = typeof raw === 'string' ? raw.trim() : '';
  if (!v) return { ok: true, value: null };
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  const d = m ? new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))) : null;
  if (!m || !d || d.getUTCMonth() !== Number(m[2]) - 1 || d.getUTCDate() !== Number(m[3])) return { ok: false, error: 'Tarihi gün, ay ve yıl olarak seç.' };
  return { ok: true, value: v };
}

const enrollSchema = z.object({
  enrollment_id: z.string(),
  course_id: z.string().nullable().optional(),
  curriculum_id: z.string(),
  curriculum_status: z.string(),
  matched: z.string().optional(),
  created: z.boolean().optional(),
});
export type EnrollResult = z.infer<typeof enrollSchema>;
export const parseEnrollResult = (raw: unknown): EnrollResult => enrollSchema.parse(raw);

/** Müfredat taslakta ise "Hazırlıyorum…", değilse Bugün. */
export function nextAfterEnroll(r: Pick<EnrollResult, 'curriculum_id' | 'curriculum_status'>): string {
  return r.curriculum_status === 'draft' ? `/ogrenci/onboarding?mufredat=${r.curriculum_id}` : '/ogrenci';
}

/** Hatanın ders seçimini değiştirmeyi gerektirip gerektirmediği (istemci ilk adıma döner). */
export const isCourseError = (code: string | null): boolean => code === 'OGR-ONB-001' || code === 'OGR-ONB-003';

export function onboardingErrorMessage(code: string | null): string {
  if (code === 'OGR-ONB-001') return 'Ders adı 2 ile 120 harf arasında olmalı.';
  if (code === 'OGR-ONB-003') return 'Bugün yeterince yeni ders açtın; listeden seç ya da yarın dene.';
  if (code === 'OGR-ONB-002') return 'Hedef tarih geçmişte olamaz.';
  if (code === 'OGR-AUTH-001' || code === '42501') return 'Bu hesapla ders seçilemiyor. Öğrenci hesabıyla giriş yap.';
  return 'Kaydedemedim. Biraz sonra yeniden dene.';
}
