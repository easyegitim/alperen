import { beforeEach, describe, expect, it, vi } from 'vitest';

const rpc = vi.fn();
vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/server/auth', () => ({ requireRole: vi.fn(async () => ({ user: { id: 'u1' } })) }));
vi.mock('@/server/supabase', () => ({ createSupabaseServerClient: vi.fn(async () => ({ rpc })) }));

const { revokeGuardianLink } = await import('@/app/ogrenci/profil/actions');
const { reportKindWord } = await import('@/server/documents/present');
const ID = '123e4567-e89b-42d3-a456-426614174000';

describe('revokeGuardianLink', () => {
  beforeEach(() => rpc.mockReset());
  it('geçerli kimlikle revoke_guardian_link çağrılır', async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    expect(await revokeGuardianLink(ID)).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith('revoke_guardian_link', { p_link: ID });
  });
  it('geçersiz kimlikte RPC çağrılmaz; RPC hatası ok:false döner', async () => {
    expect(await revokeGuardianLink('x')).toEqual({ ok: false });
    expect(rpc).not.toHaveBeenCalled();
    rpc.mockResolvedValue({ data: null, error: { message: 'OGR-INV-001 bağ bulunamadı' } });
    expect(await revokeGuardianLink(ID)).toEqual({ ok: false });
  });
});

describe('reportKindWord', () => {
  it('rapor türü kelimesi', () => {
    expect(reportKindWord({ title: 'Deneme 4', exam_session_id: 's' })).toBe('Deneme');
    expect(reportKindWord({ title: 'Haftalık özet', exam_session_id: null })).toBe('Haftalık');
    expect(reportKindWord({ title: 'Trend raporu', exam_session_id: null })).toBe('Trend');
    expect(reportKindWord({ title: 'Başka', exam_session_id: null })).toBe('Rapor');
  });
});
