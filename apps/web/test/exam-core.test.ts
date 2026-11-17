// Uygulama içi sınav: durum makinesi, sunucudan türetilen zamanlayıcı, çevrimdışı kuyruk, görünüm eşlemesi, RPC sarmalayıcıları.
import { describe, expect, it, vi } from 'vitest';
import { makeClock, remainingSec, isExpired } from '@/server/exam/clock';
import { confirmText, countsLine, examCounts, examReducer, gridItems, initExam, isLastQuestion, snapshotOf, type ExamEvent, type ExamState } from '@/server/exam/machine';
import { cropLayout, durationLabel, examItems, introLine, parseBbox, type QuestionRow } from '@/server/exam/present';
import { loadQueue, queueKey, ResponseQueue, type QueueStorage, type SendOutcome } from '@/server/exam/queue';
import { examErrorMessage, finishExam, isClosedCode, recordResponse, startExam } from '@/server/exam/rpc';
import { examIntroHref, examPlayHref, examResultHref } from '@/server/exam/routes';
import { parsePlayerState } from '@/server/exam/types';
import type { RpcClient } from '@/server/practice/rpc';

const qid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const T0 = 1_000_000;

function init(n = 3, opts: Parameters<typeof initExam>[2] = {}): ExamState {
  return initExam(Array.from({ length: n }, (_, i) => ({ no: i + 1, questionId: qid(i + 1) })), T0, opts);
}
function run(state: ExamState, ...events: ExamEvent[]): ExamState {
  return events.reduce(examReducer, state);
}

describe('sınav durum makinesi', () => {
  it('ilk boş soruda açılır; hepsi doluysa ilk soruda; süre dolmuşsa doğrudan bitiş evresinde', () => {
    const s = initExam([{ no: 1, questionId: qid(1), answer: 'A' }, { no: 2, questionId: qid(2) }, { no: 3, questionId: qid(3) }], T0);
    expect(s.index).toBe(1);
    expect(initExam([{ no: 1, questionId: qid(1), answer: 'B' }], T0).index).toBe(0);
    expect(init(2, { expired: true }).phase).toBe('finishing');
  });

  it('şık seçer; aynı şıkka yeniden dokunmak geri alır; yazılan cevap aynen yazılır', () => {
    let s = run(init(), { type: 'CHOOSE', value: 'C', at: T0 });
    expect(s.slots[0]!.answer).toBe('C');
    s = run(s, { type: 'CHOOSE', value: 'C', at: T0 });
    expect(s.slots[0]!.answer).toBeNull();
    s = run(s, { type: 'SELECT', value: '12', at: T0 }, { type: 'SELECT', value: '  ', at: T0 });
    expect(s.slots[0]!.answer).toBeNull();
  });

  it('serbest gezinti: Sonraki, Önceki, ızgaradan atlama; sınırlar aşılmaz; soruda geçen süre birikir', () => {
    let s = run(init(), { type: 'NEXT', at: T0 + 5000 }, { type: 'NEXT', at: T0 + 9000 }, { type: 'NEXT', at: T0 + 9500 });
    expect(s.index).toBe(2);
    expect(isLastQuestion(s)).toBe(true);
    expect(s.slots.map((x) => x.spentSec)).toEqual([5, 4, 1]);
    s = run(s, { type: 'OPEN_GRID' }, { type: 'GO', no: 1, at: T0 + 20_000 });
    expect(s.index).toBe(0);
    expect(s.gridOpen).toBe(false);
    s = run(s, { type: 'PREV', at: T0 + 21_000 });
    expect(s.index).toBe(0);
    expect(run(s, { type: 'GO', no: 99, at: T0 }).index).toBe(0);
  });

  it('bayrak soru başına açılıp kapanır; ızgara bayraklı > cevaplı > boş sayar', () => {
    let s = run(init(4), { type: 'CHOOSE', value: 'A', at: T0 }, { type: 'NEXT', at: T0 }, { type: 'TOGGLE_FLAG', at: T0 }, { type: 'NEXT', at: T0 }, { type: 'CHOOSE', value: 'B', at: T0 }, { type: 'TOGGLE_FLAG', at: T0 });
    expect(gridItems(s).map((g) => g.status)).toEqual(['answered', 'flagged', 'flagged', 'blank']);
    expect(examCounts(s)).toEqual({ total: 4, answered: 2, flagged: 2, blank: 2 });
    expect(countsLine(examCounts(s))).toBe('2 cevaplı, 2 işaretli, 2 boş');
    s = run(s, { type: 'TOGGLE_FLAG', at: T0 });
    expect(s.slots[2]!.flagged).toBe(false);
  });

  it('bitir: onay → bitiş → tamam; geri dönüş; boş sayısı onay metninde kelimeyle', () => {
    let s = run(init(2), { type: 'CHOOSE', value: 'A', at: T0 }, { type: 'ASK_FINISH', at: T0 });
    expect(s.phase).toBe('confirming');
    expect(confirmText(examCounts(s))).toBe('1 soru boş. Yine de bitirmek istiyor musun?');
    s = run(s, { type: 'CANCEL_FINISH', at: T0 });
    expect(s.phase).toBe('answering');
    s = run(s, { type: 'NEXT', at: T0 }, { type: 'CHOOSE', value: 'B', at: T0 }, { type: 'ASK_FINISH', at: T0 });
    expect(confirmText(examCounts(s))).toBe('Tüm soruları cevapladın. Sınavı bitirelim mi?');
    s = run(s, { type: 'CONFIRM_FINISH', at: T0 });
    expect(s.phase).toBe('finishing');
    expect(run(s, { type: 'FINISHED' }).phase).toBe('done');
  });

  it('bitişte cevap kilitlenir; hata evresinden yeniden denenir', () => {
    let s = run(init(2), { type: 'ASK_FINISH', at: T0 }, { type: 'CONFIRM_FINISH', at: T0 });
    expect(run(s, { type: 'CHOOSE', value: 'A', at: T0 }).slots[0]!.answer).toBeNull();
    s = run(s, { type: 'FINISH_FAILED', message: 'x' });
    expect(s.phase).toBe('error');
    expect(run(s, { type: 'RETRY_FINISH' }).phase).toBe('finishing');
  });

  it('süre dolunca onay istenmeden bitiş evresine geçer (onay ekranındayken de)', () => {
    expect(run(init(), { type: 'TIME_UP', at: T0 }).phase).toBe('finishing');
    expect(run(init(), { type: 'ASK_FINISH', at: T0 }, { type: 'TIME_UP', at: T0 }).phase).toBe('finishing');
    expect(run(init(), { type: 'OPEN_GRID' }, { type: 'TIME_UP', at: T0 }).gridOpen).toBe(false);
  });

  it('anlık görüntü cevabın tamamını taşır', () => {
    const s = run(init(), { type: 'CHOOSE', value: 'D', at: T0 + 3000 }, { type: 'TOGGLE_FLAG', at: T0 + 3000 });
    expect(snapshotOf(s.slots[0]!)).toEqual({ questionId: qid(1), answer: 'D', flagged: true, timeSpentSec: 3 });
  });
});

describe('sunucudan türetilen zamanlayıcı', () => {
  it('istemci saati sunucudan geriyse ya da ileriyse kalan süre sunucuya göre kalır', () => {
    const deadline = '2026-11-04T10:30:00.000Z';
    const serverNow = Date.parse('2026-11-04T10:00:00.000Z');
    // istemci saati 5 dk geri
    const behind = makeClock({ deadlineAt: deadline, serverNow: '2026-11-04T10:00:00.000Z', clientNow: serverNow - 300_000 });
    expect(remainingSec(behind, serverNow - 300_000)).toBe(1800);
    expect(remainingSec(behind, serverNow - 300_000 + 60_000)).toBe(1740);
    // istemci saati 2 dk ileri
    const ahead = makeClock({ deadlineAt: deadline, serverNow: '2026-11-04T10:00:00.000Z', clientNow: serverNow + 120_000 });
    expect(remainingSec(ahead, serverNow + 120_000)).toBe(1800);
  });

  it('yukarı yuvarlar, 0 altına inmez, bitişte süre doldu der; süresizde null', () => {
    const c = makeClock({ deadlineAt: '2026-11-04T10:00:10.000Z', serverNow: '2026-11-04T10:00:00.000Z', clientNow: 0 });
    expect(remainingSec(c, 500)).toBe(10);
    expect(remainingSec(c, 9_400)).toBe(1);
    expect(isExpired(c, 9_400)).toBe(false);
    expect(remainingSec(c, 99_000)).toBe(0);
    expect(isExpired(c, 99_000)).toBe(true);
    const open = makeClock({ deadlineAt: null, serverNow: '2026-11-04T10:00:00.000Z', clientNow: 0 });
    expect(remainingSec(open, 1)).toBeNull();
    expect(isExpired(open, 1)).toBe(false);
  });
});

function memory(): QueueStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) };
}
const snap = (n: number, answer: string | null, extra: Partial<Parameters<ResponseQueue['enqueue']>[0]> = {}) => ({ questionId: qid(n), answer, flagged: false, timeSpentSec: 1, ...extra });

describe('çevrimdışı cevap kuyruğu', () => {
  it('sırayla gönderir ve boşalınca depoyu siler', async () => {
    const store = memory();
    const sent: string[] = [];
    const q = new ResponseQueue('S1', store, async (s) => (sent.push(`${s.questionId}:${s.answer}`), { kind: 'ok' }));
    q.enqueue(snap(1, 'A'));
    q.enqueue(snap(2, 'B'));
    expect(JSON.parse(store.data.get(queueKey('S1'))!)).toHaveLength(2);
    expect(await q.flush()).toBe(true);
    expect(sent).toEqual([`${qid(1)}:A`, `${qid(2)}:B`]);
    expect(q.pending).toBe(0);
    expect(store.data.has(queueKey('S1'))).toBe(false);
  });

  it('aynı soruyu birleştirir: son cevap kalır, karalama kimlikleri korunur', () => {
    const q = new ResponseQueue('S1', null, async () => ({ kind: 'ok' }));
    q.enqueue(snap(1, 'A', { workUploadIds: [qid(9)] }));
    q.enqueue(snap(1, 'C'));
    q.enqueue(snap(1, null, { flagged: true }));
    expect(q.snapshots()).toEqual([{ questionId: qid(1), answer: null, flagged: true, timeSpentSec: 1, workUploadIds: [qid(9)] }]);
  });

  it('ağ hatasında durur, kuyruk saklı kalır; bağlantı gelince (yeni örnek bile) kaldığı yerden gider', async () => {
    const store = memory();
    let online = false;
    const log: string[] = [];
    const sender = async (s: { questionId: string; answer: string | null }): Promise<SendOutcome> => (online ? (log.push(`${s.answer}`), { kind: 'ok' }) : { kind: 'retry' });
    const a = new ResponseQueue('S1', store, sender);
    a.enqueue(snap(1, 'A'));
    a.enqueue(snap(2, 'B'));
    expect(await a.flush()).toBe(false);
    expect(a.pending).toBe(2);
    // sayfa yenilendi: yeni örnek depodan okur
    expect(loadQueue(store, 'S1')).toHaveLength(2);
    const b = new ResponseQueue('S1', store, sender);
    expect(b.pending).toBe(2);
    online = true;
    expect(await b.flush()).toBe(true);
    expect(log).toEqual(['A', 'B']);
    expect(store.data.has(queueKey('S1'))).toBe(false);
  });

  it('süre dolduysa (closed) kuyruğu boşaltır ve yeni yazımı yok sayar', async () => {
    const q = new ResponseQueue('S1', memory(), async () => ({ kind: 'closed' }));
    q.enqueue(snap(1, 'A'));
    q.enqueue(snap(2, 'B'));
    expect(await q.flush()).toBe(true);
    expect(q.pending).toBe(0);
    expect(q.closed).toBe(true);
    q.enqueue(snap(3, 'C'));
    expect(q.pending).toBe(0);
  });

  it('gönderim sürerken aynı soru güncellenirse yeni değer de gider', async () => {
    const sent: Array<string | null> = [];
    const q: ResponseQueue = new ResponseQueue('S1', null, async (s) => {
      sent.push(s.answer);
      if (s.answer === 'A') q.enqueue(snap(1, 'B'));
      return { kind: 'ok' };
    });
    q.enqueue(snap(1, 'A'));
    await q.flush();
    expect(sent).toEqual(['A', 'B']);
    expect(q.pending).toBe(0);
  });

  it('eşzamanlı flush çağrıları tek akışta birleşir', async () => {
    const send = vi.fn(async (): Promise<SendOutcome> => ({ kind: 'ok' }));
    const q = new ResponseQueue('S1', null, send);
    q.enqueue(snap(1, 'A'));
    await Promise.all([q.flush(), q.flush(), q.flush()]);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('bozuk ya da erişilemeyen depo boş kuyruk sayılır', () => {
    const bad: QueueStorage = { getItem: () => '{bozuk', setItem: () => { throw new Error('dolu'); }, removeItem: () => {} };
    expect(loadQueue(bad, 'S1')).toEqual([]);
    expect(loadQueue(null, 'S1')).toEqual([]);
    const q = new ResponseQueue('S1', bad, async () => ({ kind: 'ok' }));
    expect(() => q.enqueue(snap(1, 'A'))).not.toThrow();
    const okStore = memory();
    okStore.data.set(queueKey('S1'), JSON.stringify([snap(1, 'A'), { questionId: 5 }, 'x']));
    expect(loadQueue(okStore, 'S1')).toHaveLength(1);
  });
});

describe('görünüm eşlemesi', () => {
  const row = (no: number, extra: Partial<QuestionRow> = {}): QuestionRow => ({
    id: qid(no), no, section: 'mat', kind: 'mcq', stem_text: `Soru `+'`x^2`'+` kaçtır?`, options: [{ key: 'a', text: '`1`' }, { key: 'B', text: '2' }],
    is_copyrighted: false, figure_upload_id: null, page_upload_id: null, bbox: null, ...extra,
  });

  it('soruları no sırasına koyar, formülü dolar işaretine çevirir, şık harfini büyütür', () => {
    const items = examItems([row(2), row(1)], new Map(), new Map());
    expect(items.map((i) => i.no)).toEqual([1, 2]);
    expect(items[0]!.stem).toBe('Soru $x^2$ kaçtır?');
    expect(items[0]!.options).toEqual([{ key: 'A', text: '$1$' }, { key: 'B', text: '2' }]);
    expect(items[0]!.crop).toBeNull();
  });

  it('telifli sınav: metin yok, şıklar harf, kitapçık kırpımı gösterilir', () => {
    const urls = new Map([[qid(50), 'https://x.test/p.jpg'], [qid(60), 'https://x.test/f.png']]);
    const uploads = new Map([[qid(50), { id: qid(50), storage_path: 'u/p.jpg', width: 1000, height: 1400 }]]);
    const [it] = examItems([row(1, { is_copyrighted: true, stem_text: null, page_upload_id: qid(50), bbox: { x: 0.1, y: 0.2, w: 0.4, h: 0.3 }, figure_upload_id: qid(60) })], urls, uploads);
    expect(it!.stem).toBeNull();
    expect(it!.options.every((o) => o.text === null)).toBe(true);
    expect(it!.crop?.src).toBe('https://x.test/p.jpg');
    expect(it!.crop?.pageAspect).toBeCloseTo(1000 / 1400);
    expect(it!.figure?.src).toBe('https://x.test/f.png');
  });

  it('kırpım yerleşimi: kutu kapsayıcıyı doldurur', () => {
    const l = cropLayout({ src: 'x', bbox: { x: 0.25, y: 0.5, w: 0.5, h: 0.25 }, pageAspect: 0.7 });
    expect(l.widthPct).toBe(200);
    expect(l.leftPct).toBe(-50);
    expect(l.topPct).toBe(-200);
    expect(l.aspectRatio).toBeCloseTo((0.5 * 0.7) / 0.25);
  });

  it('geçersiz kutu null', () => {
    expect(parseBbox({ x: 0.9, y: 0, w: 0.5, h: 0.1 })).toBeNull();
    expect(parseBbox({ x: 0, y: 0, w: 0, h: 0.1 })).toBeNull();
    expect(parseBbox('x')).toBeNull();
    expect(parseBbox({ x: 0, y: 0, w: 1, h: 1 })).toEqual({ x: 0, y: 0, w: 1, h: 1 });
  });

  it('süre ve giriş satırı', () => {
    expect(durationLabel(75)).toBe('1 sa 15 dk');
    expect(durationLabel(60)).toBe('1 sa');
    expect(durationLabel(45)).toBe('45 dk');
    expect(durationLabel(null)).toBeNull();
    expect(introLine(40, 135)).toBe('40 soru · 2 sa 15 dk');
    expect(introLine(10, null)).toBe('10 soru');
  });
});

describe('sınav RPC sarmalayıcıları', () => {
  function fake(handler: (fn: string, args: Record<string, unknown>) => { data: unknown; error: { code?: string; message: string } | null }): RpcClient & { calls: Array<[string, Record<string, unknown>]> } {
    const calls: Array<[string, Record<string, unknown>]> = [];
    return { calls, rpc: async (fn, args = {}) => (calls.push([fn, args]), handler(fn, args)) };
  }
  const state = { session_id: qid(1), exam_id: qid(2), enrollment_id: qid(3), title: 'TYT Deneme 1', status: 'in_progress', started_at: '2026-11-04T10:00:00Z', server_now: '2026-11-04T10:00:01Z', duration_min: 75, deadline_at: '2026-11-04T11:15:00Z', remaining_sec: 4499, expired: false, question_count: 3, sections: [], answers: [{ exam_question_id: qid(7), no: 1, answer: 'B', flagged: true, has_work: false }] };

  it('start_exam_session durumu ayrıştırır', async () => {
    const db = fake(() => ({ data: state, error: null }));
    const r = await startExam(db, qid(2));
    expect(db.calls[0]).toEqual(['start_exam_session', { p_exam: qid(2) }]);
    expect(r.ok && r.data.answers[0]!.flagged).toBe(true);
    expect(parsePlayerState({ ...state, answers: undefined }).answers).toEqual([]);
  });

  it('record_exam_response cevabın tamamını gönderir; boş cevap null olur', async () => {
    const db = fake(() => ({ data: qid(9), error: null }));
    await recordResponse(db, qid(1), { questionId: qid(7), answer: ' b ', flagged: true, timeSpentSec: 12.6, workUploadIds: [qid(8)] });
    await recordResponse(db, qid(1), { questionId: qid(7), answer: '  ', flagged: false, timeSpentSec: null });
    expect(db.calls[0]![1]).toEqual({ p_session: qid(1), p_exam_question: qid(7), p_answer: 'b', p_time_spent_sec: 13, p_flagged: true, p_work_upload_ids: [qid(8)], p_how_far_text: null });
    expect(db.calls[1]![1]).toMatchObject({ p_answer: null, p_flagged: false, p_time_spent_sec: null, p_work_upload_ids: null });
  });

  it('hata kodlarını ayırır: süre doldu ve kapanmış oturum yeniden denenmez', async () => {
    const db = fake(() => ({ data: null, error: { code: 'P0001', message: 'OGR-EXAM-008 süre doldu: cevap yazılamaz' } }));
    const r = await recordResponse(db, qid(1), { questionId: qid(7), answer: 'A', flagged: false, timeSpentSec: 1 });
    expect(!r.ok && isClosedCode(r.code)).toBe(true);
    expect(isClosedCode('OGR-EXAM-003')).toBe(true);
    expect(isClosedCode('PGRST000')).toBe(false);
    expect(examErrorMessage('OGR-EXAM-008')).toBe('Süre doldu; sonucu açıyorum.');
    expect(examErrorMessage(null)).toBe('Kaydedemedim. Bağlantını kontrol edip yeniden dene.');
    const fin = await finishExam(fake(() => ({ data: { id: 1 }, error: null })), qid(1));
    expect(fin.ok).toBe(true);
  });

  it('adresler', () => {
    expect(examIntroHref('E')).toBe('/ogrenci/sinav/E');
    expect(examPlayHref('E', 'S')).toBe('/ogrenci/sinav/E/S');
    expect(examResultHref('S')).toBe('/ogrenci/sonuc?deneme=S');
  });
});
