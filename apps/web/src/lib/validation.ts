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
  /** İsteğe bağlı; boşsa mevcut ad ya da e-posta başı kullanılır. */
  displayName: string | null;
  /** İsteğe bağlı sınıf. */
  grade: string | null;
  /** Seçilen ders (courses.id); ders listesi boşsa null. */
  courseId: string | null;
  /** Hedef tarih (YYYY-MM-DD); bilinmiyorsa null. */
  examDate: string | null;
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
/** Dersin hedef sınav etiketi (enrollments.target_exam): TYT/AYT/LGS kodlu parkurlar, okul/üniversite için 'final'. */
export function targetExamOf(course: { code: string; kind: string }): string | null {
  const m = /^(TYT|AYT|LGS)(?:-|$)/i.exec(course.code);
  if (m) return m[1]!.toUpperCase();
  return course.kind === 'school' || course.kind === 'university' ? 'final' : null;
}

export type FieldErrors<K extends string> = Partial<Record<K, string>>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** YYYY-MM-DD geçerli bir takvim günü mü? Geçerliyse aynı metin, değilse null. */
export function parseDateOnly(value: unknown): string | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const d = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value ? null : value;
}

/**
 * Öğrenci onboarding formu (PLAN-v2 §13, 2 adım): ders/sınav seçimi + hedef tarih. Ad ve sınıf isteğe bağlıdır.
 * Hedef tarih bugünden önce olamaz ve en çok 5 yıl ilerideki bir gün olabilir.
 */
export function parseStudentProfile(form: FormData, now: Date = new Date()): { ok: true; value: StudentProfileInput } | { ok: false; errors: FieldErrors<keyof StudentProfileInput> } {
  const displayName = String(form.get('displayName') ?? '').trim().replace(/\s+/g, ' ');
  const grade = String(form.get('grade') ?? '');
  const courseId = String(form.get('courseId') ?? '');
  const examDateRaw = String(form.get('examDate') ?? '').trim();
  const errors: FieldErrors<keyof StudentProfileInput> = {};
  if (displayName !== '' && (displayName.length < 2 || displayName.length > 60)) errors.displayName = 'Adın 2 ile 60 karakter arasında olmalı.';
  if (grade !== '' && !(GRADES as readonly string[]).includes(grade)) errors.grade = 'Sınıfını listeden seç.';
  if (courseId !== '' && !UUID_RE.test(courseId)) errors.courseId = 'Listeden bir ders seç.';
  let examDate: string | null = null;
  if (examDateRaw !== '') {
    examDate = parseDateOnly(examDateRaw);
    const today = now.toISOString().slice(0, 10);
    const limit = new Date(now.getTime() + 5 * 366 * 86_400_000).toISOString().slice(0, 10);
    if (!examDate) errors.examDate = 'Geçerli bir tarih seç.';
    else if (examDate < today) errors.examDate = 'Hedef tarih bugünden önce olamaz.';
    else if (examDate > limit) errors.examDate = 'Hedef tarih çok uzakta; 5 yıl içinde bir gün seç.';
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, value: { displayName: displayName || null, grade: grade || null, courseId: courseId || null, examDate } };
}

/**
 * Veli onboarding formu: görünen ad + davet kodu. Davet daha önce kabul edilmişse (etkin bağ var) kod aranmaz:
 * `tokenOptional` ile kod boş bırakılabilir ve `token` null döner; dolu ama geçersizse yine hata verilir.
 */
export function parseParentProfile(
  form: FormData,
  options: { tokenOptional?: boolean } = {},
): { ok: true; value: { displayName: string; token: string | null } } | { ok: false; errors: FieldErrors<'displayName' | 'token'> } {
  const displayName = String(form.get('displayName') ?? '').trim().replace(/\s+/g, ' ');
  const rawToken = String(form.get('token') ?? '').trim();
  const token = parseInviteToken(rawToken);
  const errors: FieldErrors<'displayName' | 'token'> = {};
  if (displayName.length < 2 || displayName.length > 60) errors.displayName = 'Adın 2 ile 60 karakter arasında olmalı.';
  if (!token && !(options.tokenOptional && rawToken === '')) errors.token = 'Davet kodu "gi_" ile başlar; öğrencinin gönderdiği kodu aynen yapıştırın.';
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, value: { displayName, token } };
}
