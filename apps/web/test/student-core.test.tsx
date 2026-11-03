// Bugün · Test · Gelişim · Onboarding · kabuk: saf kurallar ve iki istemci bileşeni (P1-F).
import fs from 'node:fs';
import path from 'node:path';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }), usePathname: () => '/ogrenci/gelisim' }));
vi.mock('@/server/practice/actions', () => ({ answerPracticeAction: vi.fn(), finishPracticeAction: vi.fn() }));
vi.mock('@/server/suggestions/actions', () => ({ openNotice: vi.fn(), startFirstPractice: vi.fn(), startSuggestion: vi.fn() }));

import { FirstPracticeCard } from '@/app/ogrenci/bugun/kartlar';
import { OneLineResult } from '@/components/result';
import { isFocusPath, shellTabs, TabShell } from '@/components/shell';
import { courseTextOf, nextAfterEnroll, onboardingErrorMessage, parseCourseText } from '@/app/ogrenci/onboarding/shared';
import { canSubmit, dotStates, initPlayer, isLastOpen, playerReducer, type PlayerState } from '@/server/practice/machine';
import { figureUrl, playerItems, practiceErrorMessage, resultView, toMathText } from '@/server/practice/present';
import { appErrorCode, callRpc, isUuid, type RpcClient } from '@/server/practice/rpc';
import { answerItem, startForEnrollment } from '@/server/practice/service';
import { parseFinishSummary, parsePracticeSet } from '@/server/practice/types';
import {
  bandWord,
  dayKey,
  daysUntil,
  documentLine,
  draftDone,
  examDative,
  formatNet,
  lastSevenDays,
  lineGeometry,
  netOf,
  seriesAlt,
  topicRows,
} from '@/server/progress/present';
import { arrangeToday, boxLine, metaLine, noticeHref, noticeLine, parseSuggestions, type Suggestion } from '@/server/suggestions/arrange';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function sug(n: number, kind: Suggestion['kind'], rank: number, extra: Partial<Suggestion> = {}): Suggestion {
  return { id: id(n), enrollmentId: null, kind, title: `Öneri ${n}`, subtitle: null, payload: {}, rank, expiresAt: null, createdAt: `2026-11-03T0${n % 10}:00:00Z`, ...extra };
}

describe('Bugün: öneri sıralaması (arrangeToday)', () => {
  const now = new Date('2026-11-03T10:00:00Z');

  it('kahraman kart en küçük rank; eşitlikte oluşturulma, sonra kimlik; en çok 3 kutu', () => {
    const items = [sug(5, 'weekly_homework', 10), sug(2, 'practice', 0), sug(3, 'lesson_review', 10, { createdAt: '2026-11-03T01:00:00Z' }), sug(4, 'gap_analysis', 20), sug(6, 'mini_exam', 30), sug(1, 'practice', 40)];
    const t = arrangeToday(items, now);
    expect(t.hero?.id).toBe(id(2));
    expect(t.boxes.map((b) => b.id)).toEqual([id(3), id(5), id(4)]);
    expect(t.notices).toEqual([]);
  });

  it('mini_exam kahraman ya da kutu olmaz (test akışı yok)', () => {
    const t = arrangeToday([sug(1, 'mini_exam', 0), sug(2, 'practice', 5)], now);
    expect(t.hero?.id).toBe(id(2));
    expect(t.boxes).toEqual([]);
  });

  it('süresi dolan atlanır; belge/yükleme sonucu kahraman olmaz, ayrı kart olur', () => {
    const items = [sug(1, 'document_ready', 0, { payload: { document_id: id(9) } }), sug(2, 'practice', 5, { expiresAt: '2026-11-03T09:59:00Z' }), sug(3, 'gap_analysis', 7)];
    const t = arrangeToday(items, now);
    expect(t.hero?.id).toBe(id(3));
    expect(t.boxes).toEqual([]);
    expect(t.notices.map((n) => n.kind)).toEqual(['document_ready']);
  });

  it('boş liste: kahraman yok (ekran "İlk testine başla" çizer)', () => {
    expect(arrangeToday([], now)).toEqual({ hero: null, boxes: [], notices: [] });
  });

  it('RPC satırları: bilinmeyen tür atlanır, payload boşsa {}', () => {
    const rows = parseSuggestions([
      { id: id(1), enrollment_id: null, kind: 'practice', title: ' Rasyonel sayılar ', subtitle: null, payload: { count: 8, minutes: 12 }, rank: 0, expires_at: null, created_at: '2026-11-03T00:00:00Z' },
      { id: id(2), kind: 'yeni_tur', title: 'x', rank: 1, created_at: '2026-11-03T00:00:00Z' },
      { id: id(3), kind: 'lesson_review', title: 'Ders', payload: null, rank: 2, created_at: '2026-11-03T00:00:00Z' },
    ]);
    expect(rows.map((r) => r.kind)).toEqual(['practice', 'lesson_review']);
    expect(rows[0]!.title).toBe('Rasyonel sayılar');
    expect(rows[1]!.payload).toEqual({});
  });

  it('kart metinleri: "8 soru · 12 dk", kutu süresi, bildirim hedefi', () => {
    expect(metaLine(sug(1, 'practice', 0, { payload: { count: 8, minutes: 12 } }))).toBe('8 soru · 12 dk');
    expect(metaLine(sug(1, 'practice', 0, { subtitle: 'Kısa tekrar' }))).toBe('Kısa tekrar');
    expect(boxLine(sug(1, 'weekly_homework', 0, { payload: { minutes: 20, count: 10 } }))).toBe('20 dk');
    expect(boxLine(sug(1, 'weekly_homework', 0, { payload: { count: 5 } }))).toBe('5 soru');
    expect(noticeHref(sug(1, 'document_ready', 0, { payload: { document_id: id(7) } }))).toBe(`/ogrenci/gelisim/belgeler/${id(7)}`);
    expect(noticeHref(sug(1, 'upload_result', 0, { payload: { upload_id: id(8), analysis_id: id(9) } }))).toBe(`/ogrenci/sonuc?analiz=${id(9)}`);
    expect(noticeHref(sug(1, 'upload_result', 0, { payload: { upload_id: id(8) } }))).toBe(`/ogrenci/sonuc?yukleme=${id(8)}`);
    expect(noticeHref(sug(1, 'upload_result', 0, { payload: { upload_id: '../x' } }))).toBeNull();
    expect(noticeLine(sug(1, 'document_ready', 0))).toBe('PDF');
  });
});

describe('Test: oynatıcı durum makinesi', () => {
  const slots = (answered: boolean[]) => answered.map((a, i) => ({ no: i + 1, answered: a, correct: a ? true : null }));

  it('yarıda kalan set ilk cevapsız sorudan sürer; hepsi cevaplıysa doğrudan bitişe', () => {
    expect(initPlayer(slots([true, false, false]), 0)).toMatchObject({ index: 1, phase: 'answering' });
    expect(initPlayer(slots([true, true]), 0)).toMatchObject({ phase: 'finishing' });
  });

  it('seçmeden gönderilmez; gönderim sırasında seçim değişmez', () => {
    let s = initPlayer(slots([false, false]), 0);
    expect(canSubmit(s)).toBe(false);
    expect(playerReducer(s, { type: 'SUBMIT' })).toBe(s);
    s = playerReducer(s, { type: 'SELECT', value: 'B' });
    expect(canSubmit(s)).toBe(true);
    s = playerReducer(s, { type: 'SUBMIT' });
    expect(s.phase).toBe('submitting');
    expect(playerReducer(s, { type: 'SELECT', value: 'C' }).selected).toBe('B');
    expect(playerReducer(playerReducer(initPlayer(slots([false]), 0), { type: 'SELECT', value: '   ' }), { type: 'SUBMIT' }).phase).toBe('answering');
  });

  it('cevap kaydı → sıradaki soru; son soru → finishing → done', () => {
    let s: PlayerState = initPlayer(slots([false, false]), 0);
    expect(isLastOpen(s)).toBe(false);
    s = playerReducer(playerReducer(s, { type: 'SELECT', value: 'A' }), { type: 'SUBMIT' });
    s = playerReducer(s, { type: 'ANSWERED', no: 1, correct: false, at: 50 });
    expect(s).toMatchObject({ index: 1, phase: 'answering', selected: null, shownAt: 50 });
    expect(s.slots[0]).toEqual({ no: 1, answered: true, correct: false });
    expect(isLastOpen(s)).toBe(true);
    expect(dotStates(s)).toEqual(['done', 'current']);
    s = playerReducer(playerReducer(s, { type: 'SELECT', value: 'C' }), { type: 'SUBMIT' });
    s = playerReducer(s, { type: 'ANSWERED', no: 2, correct: true, at: 90 });
    expect(s.phase).toBe('finishing');
    expect(dotStates(s)).toEqual(['done', 'done']);
    s = playerReducer(s, { type: 'FINISHED' });
    expect(s.phase).toBe('done');
  });

  it('ağ hatası soruda kalır (seçim korunur); bitiş hatası yeniden denenir', () => {
    let s = playerReducer(playerReducer(initPlayer(slots([false]), 0), { type: 'SELECT', value: 'D' }), { type: 'SUBMIT' });
    s = playerReducer(s, { type: 'FAILED', message: 'Kaydedemedim.' });
    expect(s).toMatchObject({ phase: 'answering', selected: 'D', error: 'Kaydedemedim.' });
    s = playerReducer(playerReducer(s, { type: 'SUBMIT' }), { type: 'ANSWERED', no: 1, correct: true, at: 1 });
    s = playerReducer(s, { type: 'FINISH_FAILED', message: 'Sonucu alamadım.' });
    expect(s.phase).toBe('error');
    s = playerReducer(s, { type: 'RETRY_FINISH' });
    expect(s.phase).toBe('finishing');
  });

  it('olay sırası dışı gelen ANSWERED/FINISHED yok sayılır', () => {
    const s = initPlayer(slots([false]), 0);
    expect(playerReducer(s, { type: 'ANSWERED', no: 1, correct: true, at: 1 })).toBe(s);
    expect(playerReducer(s, { type: 'FINISHED' })).toBe(s);
  });
});

const SET = {
  set_id: id(100),
  enrollment_id: id(200),
  suggestion_id: id(1),
  status: 'in_progress',
  skill_ids: ['tyt.mat.a'],
  target_count: 2,
  started_at: '2026-11-03T10:00:00Z',
  finished_at: null,
  summary: null,
  total: 2,
  answered: 0,
  items: [
    { no: 2, question_id: id(302), kind: 'numeric', stem: '`3/4 + 1/8` kaçtır?', stem_values: {}, options: null, figure: null, skill_ids: ['tyt.mat.a'], answered: false, correct: null },
    { no: 1, question_id: id(301), kind: 'mcq', stem: 'Sayı doğrusunda orta nokta?', stem_values: {}, options: [{ key: 'A', text: '`-1/4`' }, { key: 'B', text: '`-1/8`' }], figure: { id: id(9), png_path: 'figures/sayi-dogrusu-15.png', svg_path: null, alt_text: 'Sayı doğrusu' }, skill_ids: [], answered: false, correct: null },
  ],
};

describe('Test: set biçimi ve sunum', () => {
  it('set ayrıştırılır, sorular sırayla; formül ve şekil adresi çözülür', () => {
    const items = playerItems(parsePracticeSet(SET), 'http://127.0.0.1:54321/');
    expect(items.map((i) => i.no)).toEqual([1, 2]);
    expect(items[0]!.options[1]).toEqual({ key: 'B', text: '$-1/8$' });
    expect(items[0]!.figure).toEqual({ src: 'http://127.0.0.1:54321/storage/v1/object/public/figures/sayi-dogrusu-15.png', alt: 'Sayı doğrusu' });
    expect(items[1]!.stem).toBe('$3/4 + 1/8$ kaçtır?');
    expect(items[1]!.options).toEqual([]);
    expect(toMathText('düz metin')).toBe('düz metin');
    expect(figureUrl('http://x', null)).toBeNull();
    expect(figureUrl('http://x', 'a b/c.png')).toBe('http://x/storage/v1/object/public/figures/a%20b/c.png');
  });

  it('yanıtta doğru şık yoksa da geçerli; bilinmeyen durum reddedilir', () => {
    expect(() => parsePracticeSet({ ...SET, status: 'garip' })).toThrow();
  });

  it('tek cümle sonuç: skor, takıldığın yer, neyi öğrendik, katlı ayrıntı', () => {
    const summary = parseFinishSummary({
      set_id: id(100), status: 'finished', total: 8, answered: 8, correct: 6, wrong: 2, unanswered: 0,
      top_misconception: { tag: 'sayilar.parantez-eksi-dagitma', text: 'Eksi işareti parantezdeki her terime dağılır.', count: 2 },
      weak_skill: { skill_id: 'tyt.mat.a', name: 'Rasyonel sayılar', correct: 2, total: 4, band: null },
      skills: [{ skill_id: 'tyt.mat.a', name: 'Rasyonel sayılar', correct: 2, total: 4 }, { skill_id: 'tyt.mat.b', name: 'Üslü sayılar', correct: 4, total: 4 }],
      mastery: [], finished_at: '2026-11-03T10:10:00Z',
    });
    const items = Array.from({ length: 8 }, (_, i) => ({ no: i + 1, answered: true, correct: i !== 3 && i !== 6 }));
    const v = resultView(summary, items);
    expect(v.sentence).toBe('İyi gidiyorsun. Takıldığın yer: Rasyonel sayılar.');
    expect(v.scoreLabel).toBe('8 sorudan 6 doğru');
    expect(v.learned).toBe('Eksi işareti parantezdeki her terime dağılır');
    expect(v.dots.filter((d) => d === false)).toHaveLength(2);
    expect(v.detail.skills[1]).toEqual({ name: 'Üslü sayılar', line: '4 soruda 4 doğru' });
    expect(v.sentence).not.toMatch(/[!%]/);
  });

  it('hepsi doğru / hiç cevap yok cümleleri', () => {
    const base = { set_id: id(1), status: 'finished' as const, total: 2, wrong: 0, unanswered: 0, skills: [], mastery: [] };
    expect(resultView(parseFinishSummary({ ...base, answered: 2, correct: 2 }), []).sentence).toBe('Hepsi doğru.');
    expect(resultView(parseFinishSummary({ ...base, status: 'abandoned', answered: 0, correct: 0, unanswered: 2 }), []).sentence).toBe('Bu sette soru cevaplamadın.');
    expect(resultView(parseFinishSummary({ ...base, answered: 2, correct: 1 }), []).sentence).toBe('Yarı yoldasın.');
  });

  it('hata kodları tek cümleye çevrilir', () => {
    expect(appErrorCode({ message: 'OGR-PRAC-003 set cevaplanamaz (durum finished)', code: 'P0001' })).toBe('OGR-PRAC-003');
    expect(appErrorCode({ message: 'x', code: '42501' })).toBe('42501');
    expect(practiceErrorMessage('OGR-PRAC-005')).toBe('Önce bir cevap seç.');
    expect(practiceErrorMessage('OGR-PRAC-006')).toMatch(/^Planın kuruluyor/);
    expect(practiceErrorMessage('OGR-PRAC-007')).toMatch(/^Bugünlük alıştırma sınırı/);
    expect(practiceErrorMessage('OGR-PRAC-008')).toMatch(/^Planın eğitmen onayında/);
    expect(practiceErrorMessage('bilinmeyen')).toMatch(/^Kaydedemedim/);
  });

  it('RPC sarmalayıcıları doğru argümanları geçirir; bozuk yanıt OGR-WEB-001', async () => {
    const calls: Array<[string, unknown]> = [];
    const db: RpcClient = { rpc: async (fn, args) => (calls.push([fn, args]), { data: SET, error: null }) };
    const r = await startForEnrollment(db, id(200));
    expect(r.ok).toBe(true);
    expect(calls[0]).toEqual(['start_practice', { p_suggestion: null, p_enrollment: id(200), p_skill_ids: null, p_count: null }]);
    const bad = await answerItem(db, { setId: id(100), questionId: id(301), answer: 'B', responseMs: 12_345.6 });
    expect(calls[1]).toEqual(['answer_practice_item', { p_set: id(100), p_question: id(301), p_answer: 'B', p_response_ms: 12346 }]);
    expect(bad.ok === false && bad.code).toBe('OGR-WEB-001');
    const err = await callRpc({ rpc: async () => ({ data: null, error: { code: 'P0001', message: 'OGR-PRAC-001 set bulunamadı' } }) }, 'get_practice_set', {}, (x) => x);
    expect(err.ok === false && err.code).toBe('OGR-PRAC-001');
    expect(isUuid(id(1))).toBe(true);
    expect(isUuid('1; drop')).toBe(false);
  });
});

describe('Gelişim: sayılar, seri, bantlar', () => {
  const now = new Date('2026-11-03T21:30:00Z'); // İstanbul'da 4 Kasım 00:30

  it('İstanbul günleriyle son 7 gün; bugün en sonda', () => {
    expect(dayKey(now)).toBe('2026-11-04');
    const days = lastSevenDays(['2026-11-03T21:10:00Z', '2026-11-03T20:00:00Z', '2026-10-29T12:00:00Z', 'bozuk'], now);
    expect(days).toHaveLength(7);
    expect(days.at(-1)).toMatchObject({ key: '2026-11-04', label: 'Bugün', value: 1, today: true });
    expect(days.at(-2)).toMatchObject({ key: '2026-11-03', label: 'Sal', value: 1 });
    expect(days[0]).toMatchObject({ key: '2026-10-29', label: 'Per', value: 1 });
    expect(seriesAlt(days)).toMatch(/^Son 7 günde çözülen soru: Perşembe 1, .*bugün 1\.$/);
  });

  it('haftalık çizgi geometrisi deterministik (mockup S08 ölçüleri)', () => {
    const days = lastSevenDays([], now).map((d, i) => ({ ...d, value: [4, 6, 0, 8, 5, 9, 6][i]! }));
    const g = lineGeometry(days);
    expect(g.max).toBe(10);
    expect(g.polyline).toBe('30,80 72,60 114,120 156,40 198,70 240,30 282,60');
    expect(g.ticks.map((t) => t.label)).toEqual(['10', '5', '0']);
    expect(lineGeometry(lastSevenDays([], now)).max).toBe(5);
  });

  it('hedefe kalan gün, sınav eki, net', () => {
    expect(daysUntil('2027-06-20', new Date('2026-11-20T09:00:00Z'))).toBe(212);
    expect(daysUntil('2026-11-01', now)).toBeNull();
    expect(daysUntil(null, now)).toBeNull();
    expect(examDative('YKS')).toBe('YKS’ye');
    expect(examDative('ALES')).toBe('ALES’e');
    expect(examDative(null)).toBe('hedefe');
    expect(formatNet(27.5)).toBe('27,5');
    expect(formatNet(30)).toBe('30');
    expect(netOf({ net: 27.5 })).toBe(27.5);
    expect(netOf({})).toBeNull();
  });

  it('konular kelimeyle; kanıtsız atlanır, bantsız sona', () => {
    const rows = topicRows([
      { skill_id: 'b', skill_name: 'B', band: null, evidence_count: 2 },
      { skill_id: 'c', skill_name: 'C', band: 'high', evidence_count: 9 },
      { skill_id: 'a', skill_name: 'A', band: 'low', evidence_count: 6 },
      { skill_id: 'd', skill_name: 'D', band: null, evidence_count: 0 },
    ]);
    expect(rows.map((r) => `${r.name}:${r.word}`)).toEqual(['A:zayıf', 'C:iyi', 'B:az veri']);
    expect(bandWord('mid')).toBe('orta');
    expect(documentLine('Rasyonel sayılar', 'notes')).toBe('Rasyonel sayılar · Not');
    expect(documentLine('Haftalık rapor', 'report')).toBe('Haftalık rapor');
  });

  it('taslak bitti mi', () => {
    expect(draftDone({ status: 'draft', draft_status: 'drafting' })).toBe(false);
    expect(draftDone({ status: 'draft', draft_status: 'ready' })).toBe(true);
    expect(draftDone({ status: 'active', draft_status: 'queued' })).toBe(true);
    expect(draftDone(null)).toBe(true);
  });
});

describe('Onboarding (S01)', () => {
  it('yazılan metin çipten önce; Üniversite/Diğer metin ister', () => {
    expect(courseTextOf('TYT', '')).toBe('TYT');
    expect(courseTextOf('TYT', '  Lineer   Cebir ')).toBe('Lineer Cebir');
    expect(courseTextOf('uni', '')).toBe('');
    expect(courseTextOf(null, '')).toBe('');
    expect(parseCourseText('x')).toMatchObject({ ok: false });
    expect(parseCourseText('KPSS')).toEqual({ ok: true, value: 'KPSS' });
    expect(parseCourseText('a'.repeat(121))).toMatchObject({ ok: false });
  });

  it('taslak müfredat → Hazırlıyorum, aktif → Bugün', () => {
    expect(nextAfterEnroll({ curriculum_id: id(5), curriculum_status: 'draft' })).toBe(`/ogrenci/onboarding?mufredat=${id(5)}`);
    expect(nextAfterEnroll({ curriculum_id: id(5), curriculum_status: 'active' })).toBe('/ogrenci');
    expect(onboardingErrorMessage('OGR-ONB-001')).toMatch(/2 ile 120/);
  });
});

describe('Kabuk (mockup S02/S08/S10)', () => {
  it('odak ekranlarında gezinme yok', () => {
    expect(isFocusPath('/ogrenci/test/abc')).toBe(true);
    expect(isFocusPath('/ogrenci/onboarding')).toBe(true);
    expect(isFocusPath('/ogrenci/gelisim/belgeler/abc')).toBe(true);
    expect(isFocusPath('/ogrenci/gelisim/belgeler')).toBe(false);
    expect(isFocusPath('/ogrenci')).toBe(false);
    expect(isFocusPath('/ogrenci/testler')).toBe(false);
  });

  it('öğrenci 3, veli 2 sekme; etkin sekme yoldan', () => {
    expect(shellTabs('student', '/ogrenci/profil').map((t) => [t.label, t.active])).toEqual([
      ['Bugün', false],
      ['Koç', false],
      ['Gelişim', true],
    ]);
    expect(shellTabs('parent', '/veli').map((t) => [t.label, t.active])).toEqual([
      ['Özet', true],
      ['Sohbet', false],
    ]);
  });

  it('alt çubuk 3 sekme, ortada FAB yok', () => {
    render(
      <TabShell variant="student" brand={<span>marka</span>} footer={<span>alt</span>}>
        <h1>Gelişim</h1>
      </TabShell>,
    );
    const bottom = screen.getByRole('navigation', { name: 'Ana gezinme (alt çubuk)' });
    expect([...bottom.querySelectorAll('a')].map((a) => a.textContent)).toEqual(['Bugün', 'Koç', 'Gelişim']);
    expect(bottom.querySelector('a[aria-current="page"]')?.textContent).toBe('Gelişim');
  });
});

describe('Sonuç bileşeni (OneLineResult)', () => {
  it('tek birincil düğme; Detay katlı açılır', () => {
    render(<OneLineResult score={{ correct: 6, total: 8, label: '8 sorudan 6 doğru' }} dots={[true, false, null]} sentence="İyi gidiyorsun." learned="Dağılma özelliğinde işaret kuralı" primary={{ href: '/ogrenci', label: 'Devam et' }} detail={<p>En sık yanılgı</p>} coachHref="/ogrenci/koc" />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('İyi gidiyorsun.');
    expect(screen.getByText('8 sorudan 6 doğru')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Devam et' })).toHaveAttribute('href', '/ogrenci');
    const detail = screen.getByTestId('detay');
    expect(detail).not.toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Detay' }));
    expect(detail).toBeVisible();
    expect(screen.getByRole('link', { name: 'Koça sor' })).toBeInTheDocument();
  });
});

describe('Gelişim tipleri göçlerle uyumlu', () => {
  it('db-types.ts Row alanları göç dosyalarındaki sütunlar', () => {
    const root = path.resolve(__dirname, '../../..');
    const dir = path.join(root, 'supabase/migrations');
    const sql = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort().map((f) => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n');
    const src = fs.readFileSync(path.resolve(__dirname, '../src/server/progress/db-types.ts'), 'utf8');
    const tables: Record<string, string> = { AttemptRow: 'attempts', ExamSessionRow: 'exam_sessions', GeneratedDocumentRow: 'generated_documents', CurriculumRow: 'curricula' };
    for (const [type, table] of Object.entries(tables)) {
      const body = new RegExp(`export type ${type} = \\{([\\s\\S]*?)\\};`).exec(src)?.[1] ?? '';
      const fields = [...body.matchAll(/(\w+)\??:/g)].map((m) => m[1]!);
      expect(fields.length, type).toBeGreaterThan(2);
      const create = new RegExp(`create table public\\.${table} \\(([\\s\\S]*?)\\n\\);`).exec(sql)?.[1] ?? '';
      const added = [...sql.matchAll(new RegExp(`alter table public\\.${table} add column (\\w+)`, 'g'))].map((m) => m[1]);
      for (const f of fields) expect(new RegExp(`^\\s{2}${f}\\s`, 'm').test(create) || added.includes(f), `${table}.${f}`).toBe(true);
    }
    const view = /create view public\.mastery_view[\s\S]*?;\n/.exec(sql)?.[0] ?? '';
    for (const f of ['student_id', 'enrollment_id', 'skill_id', 'skill_name', 'parent_id', 'evidence_count', 'band']) expect(view, f).toContain(f);
  });
});

describe('Test bekleme ekranı: yoklama aralığı', () => {
  it('ilk dakika 2 sn, sonra 10 sn; 10 dakikada durur; süre setin açılışından sayılır', async () => {
    const { pollDelay, elapsedSince, SLOW_AFTER_MS, GIVE_UP_AFTER_MS } = await import('../src/server/practice/wait');
    expect(pollDelay(0)).toBe(2_000);
    expect(pollDelay(SLOW_AFTER_MS - 1)).toBe(2_000);
    expect(pollDelay(SLOW_AFTER_MS)).toBe(10_000);
    expect(pollDelay(GIVE_UP_AFTER_MS)).toBeNull();
    expect(SLOW_AFTER_MS).toBe(60_000);
    const now = Date.parse('2026-11-03T10:01:30Z');
    expect(elapsedSince('2026-11-03T10:00:00Z', now)).toBe(90_000);
    expect(elapsedSince('2026-11-03T10:05:00Z', now)).toBe(0);
    expect(elapsedSince(null, now)).toBe(0);
    expect(elapsedSince('bozuk', now)).toBe(0);
  });
});

describe('Bugün: öneri yokken ilk test kartı', () => {
  it('taslak hazırsa tek "İlk testine başla"; sürerken düğmesiz; eğitmen onayı beklerken düğmesiz tek cümle', () => {
    const { unmount } = render(<FirstPracticeCard drafting={false} />);
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['İlk testine başla']);
    unmount();
    const drafting = render(<FirstPracticeCard drafting />);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    drafting.unmount();
    render(<FirstPracticeCard drafting={false} awaitingApproval />);
    expect(screen.getByRole('heading', { name: 'Planın eğitmen onayında' })).toBeTruthy();
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });
});
