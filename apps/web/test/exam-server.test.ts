// Sunucu eylemlerinin rol denetimi ve belge görüntüleyici yükleyicisi (sahte bağımlılıklarla).
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
const profile = vi.hoisted(() => ({ current: null as unknown }));
vi.mock('@/server/auth', () => ({ getCurrentProfile: async () => profile.current }));
const docs = vi.hoisted(() => ({ rows: [] as Record<string, unknown>[] }));
vi.mock('@/server/progress/read', () => ({
  progressClient: async () => ({
    from: () => ({ select: () => ({ eq: (_c: string, id: string) => ({ maybeSingle: async () => ({ data: docs.rows.find((r) => r.id === id) ?? null }) }) }) }),
    storage: { from: () => ({ createSignedUrl: async (p: string) => ({ data: { signedUrl: `https://x/${p}` } }) }) },
  }),
}));
vi.mock('@/server/practice/client', () => ({ studentDb: async () => ({}) }));
vi.mock('@/server/uploads/client', () => ({ uploadClient: async () => ({}) }));

import { sendBlankReason, sendHowFar, submitExam } from '@/server/exam-result/actions';
import { loadViewableDocument } from '@/server/documents/read';

const U = '00000000-0000-4000-8000-000000000001';

describe('deneme eylemleri: yalnız öğrenci', () => {
  beforeEach(() => {
    profile.current = { user: { id: U }, profile: { role: 'parent' } };
  });
  it('veli ya da oturumsuz çağrı reddedilir', async () => {
    for (const cur of [{ user: { id: U }, profile: { role: 'parent' } }, null]) {
      profile.current = cur;
      expect((await submitExam({})).ok).toBe(false);
      expect((await sendHowFar({})).ok).toBe(false);
      expect((await sendBlankReason({})).ok).toBe(false);
    }
  });
  it('öğrenci geçersiz girdide okunamadı hatası alır', async () => {
    profile.current = { user: { id: U }, profile: { role: 'student' } };
    expect(await sendBlankReason({ sessionId: 'x' })).toEqual({ ok: false, error: 'Seçim okunamadı.' });
  });
});

describe('loadViewableDocument', () => {
  it('cevap anahtarı ve bulunmayan belge null; hazır olmayan PDF src null; hazır olan imzalı adres', async () => {
    docs.rows = [
      { id: 'k', title: 'Anahtar', kind: 'answer_key', pdf_path: 'a.pdf', status: 'rendered' },
      { id: 'd', title: 'Deneme 4', kind: 'report', pdf_path: 'b.pdf', status: 'draft' },
      { id: 'r', title: 'Deneme 4', kind: 'report', pdf_path: 'c.pdf', status: 'rendered' },
    ];
    expect(await loadViewableDocument('k')).toBeNull();
    expect(await loadViewableDocument('yok')).toBeNull();
    expect((await loadViewableDocument('d'))?.src).toBeNull();
    expect((await loadViewableDocument('r'))?.src).toBe('https://x/c.pdf');
  });
});
