// @vitest-environment node
// Veli (P6-C) saf parçalar: tek cümle şablonu, özet/bildirim ayrıştırma, rapor parametreleri ve sınır, çocuk seçimi.
// Veli ajanı (sohbet turu, araçlar, depo): test/parent-agent*.test.ts (P6-B).
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { PARENT_COPY, PARENT_RULES, emailChannels, emailOn, formatTr, parseNotifications, parseRules, parseSummary, summarySentence, type ParentSummary } from '@/lib/parent';
import { askReport, reportParams } from '@/server/parent/rpc';
import { pickChild } from '@/server/parent/children';
import type { RpcClient } from '@/server/practice/rpc';

const CHILD = '10000000-0000-4000-8000-000000000001';
const OTHER = '10000000-0000-4000-8000-000000000009';

const raw = {
  student: { id: CHILD, name: 'Elif', grade: '11' },
  week: { minutes: 270, hours: 4.5, questions: 38, active_days: 4 },
  prev_week: { minutes: 100 },
  last_exam: { session_id: '5e550000-0000-4000-8000-000000000001', title: 'Deneme 4', net: 27.5 },
  courses: [
    { course_id: 'c1', title: 'TYT Matematik', bands: { low: 1, mid: 3, high: 4, insufficient: 2 }, trend: 'up' },
    { course_id: 'c2', title: 'TYT Türkçe', bands: { low: 5, mid: 1, high: 0, insufficient: 0 }, trend: 'down' },
  ],
  latest_report: { id: 'r1', title: 'Haftalık rapor', ready: true, created_at: '2026-11-02T10:00:00Z' },
};

describe('tek cümle ve sayılar', () => {
  it('ders durumuyla Türkçe cümle; saat Türkçe ondalık; yüzde ve ünlem yok', () => {
    const s = parseSummary(raw);
    expect(summarySentence(s)).toBe('Elif bu hafta 4,5 saat çalıştı; matematikte ilerliyor, Türkçe’de tekrar gerekiyor.');
    expect(summarySentence(s)).not.toMatch(/[%!]/);
    expect(formatTr(4.5)).toBe('4,5');
    expect(formatTr(38)).toBe('38');
    expect(s.latestReport).toEqual({ id: 'r1', title: 'Haftalık rapor', createdAt: '2026-11-02T10:00:00Z' });
    expect(s.lastExam?.net).toBe(27.5);
  });

  it('kısa çalışma, çalışmasız hafta ve veri yok', () => {
    const base = parseSummary(raw);
    expect(summarySentence({ ...base, minutes: 30, hours: 0.5, courses: [] })).toBe('Elif bu hafta 38 soru çözdü.');
    expect(summarySentence({ ...base, minutes: 0, hours: 0, questions: 0, courses: [], lastExam: null })).toBe(PARENT_COPY.noData);
    const idle: ParentSummary = { ...base, minutes: 0, hours: 0, questions: 0 };
    expect(summarySentence(idle)).toContain('Bu hafta henüz çalışma kaydı yok');
  });

  it('beklenmeyen biçim fırlatır; kanıtsız ders cümleye girmez; son rapor hazır değilse kart yok', () => {
    expect(() => parseSummary({ student: { name: 5 } })).toThrow();
    const s = parseSummary({ ...raw, courses: [{ title: 'TYT Fizik', bands: { low: 0, mid: 0, high: 0, insufficient: 6 }, trend: null }], latest_report: { id: 'x', ready: false } });
    expect(summarySentence(s)).toBe('Elif bu hafta 4,5 saat çalıştı.');
    expect(s.latestReport).toBeNull();
  });
});

describe('bildirim ve kural ayrıştırma', () => {
  it('yalnız /veli yolları bağlantı olur; okundu işareti', () => {
    const n = parseNotifications({
      unread: 2,
      items: [
        { id: 'a', kind: 'exam_analysed', title: 'Deneme sonucu hazır', body: 'Elif’in denemesi incelendi.', payload: { url: '/veli/rapor/x' }, read_at: null, created_at: '2026-11-03T10:00:00Z' },
        { id: 'b', kind: 'x', title: 'T', body: null, payload: { url: 'https://kotu.example/veli' }, read_at: '2026-11-03T11:00:00Z', created_at: '2026-11-03T10:00:00Z' },
        { id: 'c', kind: 'x', title: 'T', body: null, payload: { url: '//kotu.example' }, read_at: null, created_at: '2026-11-03T10:00:00Z' },
      ],
    });
    expect(n.unread).toBe(2);
    expect(n.items.map((i) => i.href)).toEqual(['/veli/rapor/x', null, null]);
    expect(n.items.map((i) => i.read)).toEqual([false, true, false]);
    expect(parseRules([{ kind: 'weekly_summary', enabled: false }, { kind: 'inactivity' }])).toEqual([
      { kind: 'weekly_summary', enabled: false, email: false },
      { kind: 'inactivity', enabled: true, email: false },
    ]);
  });

  it('e-posta anahtarı: bütün veli kuralları e-posta taşıyorsa açık; kanal listesi', () => {
    const all = (email: boolean) => PARENT_RULES.map((r) => ({ kind: r.kind, enabled: true, params: { channels: email ? ['email', 'in_app'] : ['in_app', 'push'] } }));
    expect(emailOn(parseRules(all(true)))).toBe(true);
    expect(emailOn(parseRules(all(false)))).toBe(false);
    expect(emailOn(parseRules([...all(true).slice(1), { kind: PARENT_RULES[0]!.kind, enabled: true, params: {} }]))).toBe(false);
    expect(emailOn([])).toBe(false);
    expect(emailChannels(true)).toEqual(['in_app', 'push', 'email']);
    expect(emailChannels(false)).toEqual(['in_app', 'push']);
  });
});

describe('rapor isteği', () => {
  const client = (fn: (name: string, args: Record<string, unknown>) => { data?: unknown; error?: { message: string } }): RpcClient & { calls: Array<[string, Record<string, unknown>]> } => {
    const calls: Array<[string, Record<string, unknown>]> = [];
    return {
      calls,
      rpc: async (name, args = {}) => {
        calls.push([name, args]);
        const r = fn(name, args);
        return { data: r.data ?? null, error: r.error ? { message: r.error.message } : null };
      },
    };
  };

  it('tür -> parametre eşlemesi', () => {
    expect(reportParams({ kind: 'weekly' })).toEqual({});
    expect(reportParams({ kind: 'exam', sessionId: 's1' })).toEqual({ session_id: 's1' });
    expect(reportParams({ kind: 'topic', topic: '  rasyonel sayılar ' })).toEqual({ topic: 'rasyonel sayılar' });
    expect(reportParams({ kind: 'trend', weeks: 8 })).toEqual({ weeks: 8 });
  });

  it('eksik konu/deneme RPC çağırmadan nazik uyarı; günlük sınır OGR-REPORT-002', async () => {
    const c = client(() => ({ data: { used: 1, max: 3 } }));
    expect((await askReport(c, CHILD, { kind: 'topic', topic: ' ' })).message).toBe(PARENT_COPY.reportNeedTopic);
    expect((await askReport(c, CHILD, { kind: 'exam', sessionId: null })).message).toBe(PARENT_COPY.reportNoExam);
    expect(c.calls).toHaveLength(0);
    expect(await askReport(c, CHILD, { kind: 'weekly' })).toEqual({ ok: true, message: PARENT_COPY.reportAsked });
    expect(c.calls[0]).toEqual(['parent_request_report', { p_student: CHILD, p_kind: 'weekly', p_params: {} }]);
    const full = client(() => ({ error: { message: 'OGR-REPORT-002 günlük rapor sınırı (3) doldu' } }));
    expect(await askReport(full, CHILD, { kind: 'weekly' })).toEqual({ ok: false, message: PARENT_COPY.reportLimit });
  });
});

describe('çocuk seçimi', () => {
  const kids = [
    { id: CHILD, name: 'Elif' },
    { id: OTHER, name: 'Can' },
  ];
  it('geçerli ve velinin çocuğu ise o; değilse ilk çocuk', () => {
    expect(pickChild(kids, OTHER)?.name).toBe('Can');
    expect(pickChild(kids, 'bozuk')?.name).toBe('Elif');
    expect(pickChild(kids, '10000000-0000-4000-8000-0000000000ff')?.name).toBe('Elif');
    expect(pickChild([], undefined)).toBeNull();
  });
});
