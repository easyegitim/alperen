import { describe, expect, it } from 'vitest';
import { inviteErrorMessage } from '@/lib/invite-errors';
import { parseEmail, parseInviteToken, parseOtpCode, parseParentProfile, parseStudentProfile } from '@/lib/validation';

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
  it('öğrenci formu geçerli girdiyi kabul eder', () => {
    const r = parseStudentProfile(form({ displayName: '  Ayşe   Yılmaz ', grade: '11', targetExam: 'TYT', goal: 'Matematik 20 net' }));
    expect(r).toEqual({ ok: true, value: { displayName: 'Ayşe Yılmaz', grade: '11', targetExam: 'TYT', goal: 'Matematik 20 net' } });
  });
  it('öğrenci formu alan hatalarını söyler', () => {
    const r = parseStudentProfile(form({ displayName: 'A', grade: '99', targetExam: '', goal: 'x'.repeat(300) }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.errors).sort()).toEqual(['displayName', 'goal', 'grade', 'targetExam']);
  });
  it('veli formu davet kodunu doğrular', () => {
    const ok = parseParentProfile(form({ displayName: 'Mehmet Yılmaz', token: 'gi_abcdefghijklmnopqrstuvwxyz234567' }));
    expect(ok.ok).toBe(true);
    const bad = parseParentProfile(form({ displayName: 'Mehmet Yılmaz', token: 'merhaba' }));
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.errors.token).toContain('gi_');
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
