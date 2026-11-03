// Form girdisi denetimleri (sunucu eylemleri ve istemci ortak kullanır).

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** E-postayı kırpıp küçük harfe çevirir; geçersizse null. */
export function parseEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !EMAIL_RE.test(email)) return null;
  return email;
}

/** 6 haneli e-posta kodu (boşluk ve tireler ayıklanır); geçersizse null. */
export function parseOtpCode(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const digits = value.replace(/[\s-]/g, '');
  return /^\d{6,8}$/.test(digits) ? digits : null;
}

/** Davet kodu: "gi_" + base32 (create_guardian_invite). Boşluklar ayıklanır, küçük harfe çevrilir. */
export function parseInviteToken(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const token = value.replace(/\s+/g, '').toLowerCase();
  return /^gi_[a-z2-7]{16,64}$/.test(token) ? token : null;
}

export interface StudentProfileInput {
  displayName: string;
  grade: string;
  targetExam: string;
  goal: string;
}

export const GRADES = ['5', '6', '7', '8', '9', '10', '11', '12', 'mezun', 'lisans-1', 'lisans-2', 'lisans-3', 'lisans-4'] as const;
export const GRADE_LABELS: Record<(typeof GRADES)[number], string> = {
  '5': '5. sınıf',
  '6': '6. sınıf',
  '7': '7. sınıf',
  '8': '8. sınıf',
  '9': '9. sınıf',
  '10': '10. sınıf',
  '11': '11. sınıf',
  '12': '12. sınıf',
  mezun: 'Mezun',
  'lisans-1': 'Üniversite 1. sınıf',
  'lisans-2': 'Üniversite 2. sınıf',
  'lisans-3': 'Üniversite 3. sınıf',
  'lisans-4': 'Üniversite 4. sınıf',
};
export const TARGET_EXAMS = ['TYT', 'AYT', 'LGS', 'final', 'diger'] as const;
export const TARGET_EXAM_LABELS: Record<(typeof TARGET_EXAMS)[number], string> = {
  TYT: 'TYT',
  AYT: 'AYT',
  LGS: 'LGS',
  final: 'Okul ya da üniversite sınavı',
  diger: 'Başka bir hedef',
};

export type FieldErrors<K extends string> = Partial<Record<K, string>>;

/** Öğrenci onboarding formu: ad (2-60), sınıf (listeden), hedef sınav (listeden), hedef metni (en çok 280). */
export function parseStudentProfile(form: FormData): { ok: true; value: StudentProfileInput } | { ok: false; errors: FieldErrors<keyof StudentProfileInput> } {
  const displayName = String(form.get('displayName') ?? '').trim().replace(/\s+/g, ' ');
  const grade = String(form.get('grade') ?? '');
  const targetExam = String(form.get('targetExam') ?? '');
  const goal = String(form.get('goal') ?? '').trim();
  const errors: FieldErrors<keyof StudentProfileInput> = {};
  if (displayName.length < 2 || displayName.length > 60) errors.displayName = 'Adın 2 ile 60 karakter arasında olmalı.';
  if (!(GRADES as readonly string[]).includes(grade)) errors.grade = 'Sınıfını listeden seç.';
  if (!(TARGET_EXAMS as readonly string[]).includes(targetExam)) errors.targetExam = 'Hedefini listeden seç.';
  if (goal.length > 280) errors.goal = 'Hedef metni en çok 280 karakter olabilir.';
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, value: { displayName, grade, targetExam, goal } };
}

/** Veli onboarding formu: davet kodu + görünen ad. */
export function parseParentProfile(form: FormData): { ok: true; value: { displayName: string; token: string } } | { ok: false; errors: FieldErrors<'displayName' | 'token'> } {
  const displayName = String(form.get('displayName') ?? '').trim().replace(/\s+/g, ' ');
  const token = parseInviteToken(form.get('token'));
  const errors: FieldErrors<'displayName' | 'token'> = {};
  if (displayName.length < 2 || displayName.length > 60) errors.displayName = 'Adın 2 ile 60 karakter arasında olmalı.';
  if (!token) errors.token = 'Davet kodu "gi_" ile başlar; öğrencinin gönderdiği kodu aynen yapıştır.';
  if (Object.keys(errors).length > 0 || !token) return { ok: false, errors };
  return { ok: true, value: { displayName, token } };
}
