// Saat eşitleme eylemi (syncExamClockAction): exam_clock salt okur; yeni deneme oturumu açmaz; başka oturumun ya da
// kapanmış oturumun yanıtı yok sayılır (bitiş ile eşitleme yarışı). Sahte bağımlılıklarla.
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('next/navigation', () => ({ redirect: vi.fn(), notFound: vi.fn() }));
const user = vi.hoisted(() => ({ current: null as unknown }));
vi.mock('@/server/auth', () => ({ getCurrentUser: async () => user.current }));
vi.mock('@/server/exam/client', () => ({ examDb: async () => ({}) }));
vi.mock('@/server/practice/client', () => ({ studentDb: async () => ({}) }));
vi.mock('@/server/uploads/client', () => ({ uploadClient: async () => ({}) }));
vi.mock('@/server/suggestions/service', () => ({ consumeSuggestion: vi.fn() }));
const rpc = vi.hoisted(() => ({ clock: vi.fn(), start: vi.fn(), finish: vi.fn(), record: vi.fn() }));
vi.mock('@/server/exam/rpc', () => ({
  examClock: (...a: unknown[]) => rpc.clock(...a),
  startExam: (...a: unknown[]) => rpc.start(...a),
  finishExam: (...a: unknown[]) => rpc.finish(...a),
  recordResponse: (...a: unknown[]) => rpc.record(...a),
  isClosedCode: () => false,
  examErrorMessage: () => 'hata',
}));

import { syncExamClockAction } from '@/server/exam/actions';

const SESSION = '00000000-0000-4000-8000-000000000100';
const EXAM = '00000000-0000-4000-8000-000000000050';

describe('syncExamClockAction', () => {
  beforeEach(() => {
    user.current = { id: '00000000-0000-4000-8000-000000000001' };
    rpc.clock.mockReset();
    rpc.start.mockReset();
  });

  it('geçersiz kimlik ya da oturumsuz çağrı RPC çağırmadan null döner', async () => {
    expect(await syncExamClockAction('x')).toBeNull();
    user.current = null;
    expect(await syncExamClockAction(SESSION)).toBeNull();
    expect(rpc.clock).not.toHaveBeenCalled();
  });

  it('süren oturum için bitiş sınırını ve sunucu saatini döner; deneme oturumu açmaz (start_exam_session çağrılmaz)', async () => {
    rpc.clock.mockResolvedValue({ ok: true, data: { session_id: SESSION, status: 'in_progress', deadline_at: '2030-01-01T10:00:00Z', server_now: '2030-01-01T09:00:00Z' } });
    expect(await syncExamClockAction(SESSION)).toEqual({ deadlineAt: '2030-01-01T10:00:00Z', serverNow: '2030-01-01T09:00:00Z' });
    expect(rpc.clock).toHaveBeenCalledWith(expect.anything(), SESSION);
    expect(rpc.start).not.toHaveBeenCalled();
  });

  it('bitmiş oturum (bitiş sonrası eşitleme yarışı) null döner: yanıt sonucu değiştirmez', async () => {
    rpc.clock.mockResolvedValue({ ok: true, data: { session_id: SESSION, status: 'completed', deadline_at: null, server_now: '2030-01-01T09:00:00Z' } });
    expect(await syncExamClockAction(SESSION)).toBeNull();
  });

  it('yanıttaki oturum kimliği istenenle aynı değilse yok sayılır', async () => {
    rpc.clock.mockResolvedValue({ ok: true, data: { session_id: EXAM, status: 'in_progress', deadline_at: '2030-01-01T10:00:00Z', server_now: '2030-01-01T09:00:00Z' } });
    expect(await syncExamClockAction(SESSION)).toBeNull();
  });

  it('RPC hatası null döner (sayaç sayfa verisindeki saatle kalır)', async () => {
    rpc.clock.mockResolvedValue({ ok: false, error: { code: 'X', message: 'x' }, code: 'OGR-WEB-000' });
    expect(await syncExamClockAction(SESSION)).toBeNull();
  });
});
