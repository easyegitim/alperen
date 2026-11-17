import { beforeEach, describe, expect, it, vi } from 'vitest';

const rpc = vi.fn();
vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/server/auth', () => ({ getCurrentProfile: vi.fn(async () => ({ user: { id: 'u1' }, profile: { role: 'student' } })) }));
vi.mock('@/server/supabase', () => ({ createSupabaseServerClient: vi.fn(async () => ({ rpc })) }));

const { requestMemoryCorrection } = await import('@/server/memory-correction/actions');
const { CORRECTION_MAX_CHARS, parseCorrectionInput } = await import('@/server/memory-correction/input');

describe('requestMemoryCorrection (Profil > Hafıza "Düzeltme iste")', () => {
  beforeEach(() => {
    rpc.mockReset();
    rpc.mockResolvedValue({ data: { id: 'x', path: '/memories/profile.md', status: 'open' }, error: null });
  });

  it('boş ya da yalnız boşluk metin reddedilir; RPC çağrılmaz', async () => {
    for (const input of [{ text: '' }, { text: '   \n ' }, {}, null, 'metin']) {
      const res = await requestMemoryCorrection(input);
      expect(res.ok).toBe(false);
    }
    expect(rpc).not.toHaveBeenCalled();
  });

  it(`${CORRECTION_MAX_CHARS} karakteri aşan metin reddedilir; RPC çağrılmaz`, async () => {
    const res = await requestMemoryCorrection({ text: 'a'.repeat(CORRECTION_MAX_CHARS + 1) });
    expect(res).toEqual({ ok: false, error: `En çok ${CORRECTION_MAX_CHARS} karakter yazabilirsin.` });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('geçerli metin request_memory_correction ile gönderilir (izin dışı yol varsayılana döner)', async () => {
    const res = await requestMemoryCorrection({ text: '  Matematikte geometri değil cebir zayıfım ', path: '/memories/parent_summary.md' });
    expect(res).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith('request_memory_correction', { p_path: '/memories/profile.md', p_text: 'Matematikte geometri değil cebir zayıfım' });
    expect(parseCorrectionInput({ text: 'x', path: '/memories/courses/tyt-mat.md' })).toEqual({ ok: true, value: { path: '/memories/courses/tyt-mat.md', text: 'x' } });
  });

  it('RPC hatası sakin bir metne çevrilir', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'OGR-MEM-009 açık düzeltme isteği sınırı (20) doldu' } });
    const res = await requestMemoryCorrection({ text: 'cebir' });
    expect(res).toEqual({ ok: false, error: 'Bekleyen isteklerin çok; önce onlar işlensin, sonra yeniden dene.' });
  });
});
