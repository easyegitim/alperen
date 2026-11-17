import { describe, expect, it } from 'vitest';
import { inviteErrorMessage } from '@/lib/invite-errors';
import { parseEmail, parseInviteToken, parseOtpCode, parseParentProfile, parseStudentProfile, targetExamOf } from '@/lib/validation';

function form(values: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(values)) f.set(k, v);
  return f;
}

describe('e-posta ve kod', () => {
  it('parseEmail kırpar, küçültür, geçersizi reddeder', () => {
    expect(parseEmail('  Ayse@Example.COM ')).toBe('ayse@example.com');
    for (const bad of ['', 'ayse', 'a@b', 'a b@c.com', null, 5, `${'a'.repeat(250)}@x.com`]) expect(parseEmail(bad)).toBeNull();
  });
  it('parseOtpCode boşluk ve tireyi ayıklar', () => {
    expect(parseOtpCode('123 456')).toBe('123456');
    expect(parseOtpCode('123-456')).toBe('123456');
    expect(parseOtpCode('12345')).toBeNull();
    expect(parseOtpCode('abcdef')).toBeNull();
    expect(parseOtpCode(undefined)).toBeNull();
  });
  it('parseInviteToken gi_ + base32', () => {
    const token = `gi_${'abcdefghijklmnopqrstuvwxyz234567'}`;
    expect(parseInviteToken(` ${token.toUpperCase()} `)).toBe(token);
    expect(parseInviteToken('gi_kisa')).toBeNull();
    expect(parseInviteToken('xx_abcdefghijklmnopqrstuvwxyz234567')).toBeNull();
    expect(parseInviteToken('gi_ABCDEFGHIJKLMNOPQRSTUVWXYZ189012')).toBeNull();
  });
});

describe('onboarding formları', () => {
  const NOW = new Date('2026-11-03T10:00:00Z');
  const COURSE = '50000000-0000-4000-8000-000000000001';
  it('öğrenci formu geçerli girdiyi kabul eder; ad ve sınıf isteğe bağlıdır', () => {
    const r = parseStudentProfile(form({ displayName: '  Ayşe   Yılmaz ', grade: '11', courseId: COURSE, examDate: '2027-06-19' }), NOW);
    expect(r).toEqual({ ok: true, value: { displayName: 'Ayşe Yılmaz', grade: '11', courseId: COURSE, examDate: '2027-06-19' } });
    expect(parseStudentProfile(form({ courseId: COURSE }), NOW)).toEqual({ ok: true, value: { displayName: null, grade: null, courseId: COURSE, examDate: null } });
  });
  it('öğrenci formu alan hatalarını söyler', () => {
    const r = parseStudentProfile(form({ displayName: 'A', grade: '99', courseId: 'x', examDate: '2020-01-01' }), NOW);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.errors).sort()).toEqual(['courseId', 'displayName', 'examDate', 'grade']);
    for (const bad of ['2026-02-30', 'yarin', '2040-01-01']) expect(parseStudentProfile(form({ examDate: bad }), NOW).ok).toBe(false);
  });
  it('targetExamOf ders kodundan hedef sınavı çıkarır', () => {
    expect(targetExamOf({ code: 'TYT-MAT', kind: 'exam_track' })).toBe('TYT');
    expect(targetExamOf({ code: 'lgs-fen', kind: 'exam_track' })).toBe('LGS');
    expect(targetExamOf({ code: 'MAT101-ODTU', kind: 'university' })).toBe('final');
    expect(targetExamOf({ code: 'X', kind: 'other' })).toBeNull();
  });
  it('veli formu davet kodunu doğrular', () => {
    const ok = parseParentProfile(form({ displayName: 'Mehmet Yılmaz', token: 'gi_abcdefghijklmnopqrstuvwxyz234567' }));
    expect(ok.ok).toBe(true);
    const bad = parseParentProfile(form({ displayName: 'Mehmet Yılmaz', token: 'merhaba' }));
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.errors.token).toContain('gi_');
  });
  it('veli formu: etkin bağ varsa kod isteğe bağlıdır, doluysa yine doğrulanır', () => {
    const noToken = parseParentProfile(form({ displayName: 'Mehmet Yılmaz', token: '' }), { tokenOptional: true });
    expect(noToken).toEqual({ ok: true, value: { displayName: 'Mehmet Yılmaz', token: null } });
    expect(parseParentProfile(form({ displayName: 'Mehmet Yılmaz', token: '' })).ok).toBe(false);
    expect(parseParentProfile(form({ displayName: 'Mehmet Yılmaz', token: 'bozuk' }), { tokenOptional: true }).ok).toBe(false);
    expect(parseParentProfile(form({ displayName: 'M', token: '' }), { tokenOptional: true }).ok).toBe(false);
  });
});

describe('davet hata iletileri', () => {
  it('OGR-INV kodlarını Türkçeye çevirir', () => {
    expect(inviteErrorMessage('OGR-INV-001 davet bulunamadı ya da kullanılmış')).toContain('bulunamadı');
    expect(inviteErrorMessage('OGR-INV-002 davetin süresi doldu')).toContain('süresi dolmuş');
    expect(inviteErrorMessage('OGR-INV-003 yalnız veli hesabı kabul edebilir (rol student)')).toContain('veli hesabı değil');
    expect(inviteErrorMessage(undefined)).toContain('kabul edilemedi');
    expect(inviteErrorMessage('başka bir şey')).toContain('kabul edilemedi');
  });
});

describe('onboarding hata iletileri', () => {
  it('OGR-ONB-003 ders seçimine döndürür', async () => {
    const { onboardingErrorMessage, isCourseError } = await import('../src/app/ogrenci/onboarding/shared');
    expect(onboardingErrorMessage('OGR-ONB-003')).toMatch(/yeni ders/);
    expect(isCourseError('OGR-ONB-003')).toBe(true);
    expect(isCourseError('OGR-ONB-001')).toBe(true);
    expect(isCourseError('OGR-ONB-002')).toBe(false);
  });
});
