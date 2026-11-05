// Uygulama içi sınav oynatıcısının durum makinesi (saf; istemci useReducer ile çalıştırır, test/exam-machine.test.ts sınar).
// Test oynatıcısından farkı: sorular arasında serbestçe gezilir, cevap değiştirilir ya da boşa çekilir, soru işaretlenir;
// kayıt her değişiklikte kuyruğa yazılır (queue.ts) — durum makinesi yalnız ekran durumunu tutar.
// Evreler: answering → (ASK_FINISH) confirming → (CONFIRM_FINISH) finishing → FINISHED done; süre dolunca TIME_UP doğrudan
// finishing. Bitiş hatası 'error' evresine geçer ve RETRY_FINISH ile yeniden denenir.

export type ExamPhase = 'answering' | 'confirming' | 'finishing' | 'done' | 'error';

export interface ExamSlot {
  no: number;
  questionId: string;
  answer: string | null;
  flagged: boolean;
  /** Karalama tuvalinden kayıt var. */
  hasWork: boolean;
  /** Bu soruda geçen süre (sn, sunucuya gider). */
  spentSec: number;
}

export interface ExamState {
  slots: ExamSlot[];
  /** slots içindeki konum. */
  index: number;
  phase: ExamPhase;
  /** "Sorular" ızgarası alt sayfası açık mı. */
  gridOpen: boolean;
  error: string | null;
  /** Şu anki sorunun gösterildiği an (istemci ms; geçen süreyi ölçer). */
  shownAt: number;
}

export type ExamEvent =
  /** Yazılan cevap (sayısal ya da açık uçlu): değer aynen yazılır. */
  | { type: 'SELECT'; value: string | null; at: number }
  /** Şık dokunuşu: aynı şıkka yeniden dokunmak cevabı geri alır (boş bırakmak sınavda geçerli bir tercih). */
  | { type: 'CHOOSE'; value: string; at: number }
  | { type: 'TOGGLE_FLAG'; at: number }
  | { type: 'WORK_SAVED'; at: number }
  | { type: 'GO'; no: number; at: number }
  | { type: 'NEXT'; at: number }
  | { type: 'PREV'; at: number }
  | { type: 'OPEN_GRID' }
  | { type: 'CLOSE_GRID' }
  | { type: 'ASK_FINISH'; at: number }
  | { type: 'CANCEL_FINISH'; at: number }
  | { type: 'CONFIRM_FINISH'; at: number }
  | { type: 'TIME_UP'; at: number }
  | { type: 'FINISHED' }
  | { type: 'FINISH_FAILED'; message: string }
  | { type: 'RETRY_FINISH' };

export interface InitialAnswer {
  no: number;
  questionId: string;
  answer?: string | null;
  flagged?: boolean;
  hasWork?: boolean;
}

export function initExam(items: InitialAnswer[], now: number, opts: { expired?: boolean } = {}): ExamState {
  const slots = [...items]
    .sort((a, b) => a.no - b.no)
    .map((i) => ({ no: i.no, questionId: i.questionId, answer: nonEmpty(i.answer), flagged: i.flagged ?? false, hasWork: i.hasWork ?? false, spentSec: 0 }));
  // açılışta ilk boş soru (devam edenler kaldığı yerden): hepsi doluysa ilk soru
  const firstBlank = slots.findIndex((s) => s.answer === null);
  return { slots, index: firstBlank === -1 ? 0 : firstBlank, phase: opts.expired ? 'finishing' : 'answering', gridOpen: false, error: null, shownAt: now };
}

function nonEmpty(v: string | null | undefined): string | null {
  return v != null && v.trim() !== '' ? v : null;
}

/** Şu anki soruya geçen süreyi ekler ve sayacı sıfırlar. */
function tick(state: ExamState, at: number): ExamState {
  const dt = Math.max(0, Math.round((at - state.shownAt) / 1000));
  if (dt === 0 && at >= state.shownAt) return { ...state, shownAt: at };
  const slots = state.slots.map((s, i) => (i === state.index ? { ...s, spentSec: s.spentSec + dt } : s));
  return { ...state, slots, shownAt: at };
}

function moveTo(state: ExamState, index: number, at: number): ExamState {
  const t = tick(state, at);
  const bounded = Math.max(0, Math.min(t.slots.length - 1, index));
  return { ...t, index: bounded, gridOpen: false, error: null };
}

const editable = (s: ExamState) => s.phase === 'answering';

export function examReducer(state: ExamState, event: ExamEvent): ExamState {
  switch (event.type) {
    case 'SELECT': {
      if (!editable(state)) return state;
      const t = tick(state, event.at);
      return { ...t, slots: t.slots.map((s, i) => (i === state.index ? { ...s, answer: nonEmpty(event.value) } : s)), error: null };
    }
    case 'CHOOSE': {
      if (!editable(state)) return state;
      const cur = state.slots[state.index];
      if (!cur) return state;
      const next = cur.answer === event.value ? null : event.value;
      const t = tick(state, event.at);
      return { ...t, slots: t.slots.map((s, i) => (i === state.index ? { ...s, answer: next } : s)), error: null };
    }
    case 'TOGGLE_FLAG': {
      if (!editable(state)) return state;
      const t = tick(state, event.at);
      return { ...t, slots: t.slots.map((s, i) => (i === state.index ? { ...s, flagged: !s.flagged } : s)) };
    }
    case 'WORK_SAVED': {
      if (!editable(state)) return state;
      const t = tick(state, event.at);
      return { ...t, slots: t.slots.map((s, i) => (i === state.index ? { ...s, hasWork: true } : s)) };
    }
    case 'GO': {
      if (!editable(state)) return state;
      const at = state.slots.findIndex((s) => s.no === event.no);
      return at === -1 ? state : moveTo(state, at, event.at);
    }
    case 'NEXT':
      return editable(state) ? moveTo(state, state.index + 1, event.at) : state;
    case 'PREV':
      return editable(state) ? moveTo(state, state.index - 1, event.at) : state;
    case 'OPEN_GRID':
      return editable(state) ? { ...state, gridOpen: true } : state;
    case 'CLOSE_GRID':
      return { ...state, gridOpen: false };
    case 'ASK_FINISH':
      return editable(state) ? { ...tick(state, event.at), phase: 'confirming', gridOpen: false } : state;
    case 'CANCEL_FINISH':
      return state.phase === 'confirming' ? { ...state, phase: 'answering', shownAt: event.at } : state;
    case 'CONFIRM_FINISH':
      return state.phase === 'confirming' ? { ...tick(state, event.at), phase: 'finishing', error: null } : state;
    case 'TIME_UP':
      // süre dolunca cevaplar kilitlenir ve oturum kendiliğinden biter (onay sorulmaz)
      return state.phase === 'answering' || state.phase === 'confirming' ? { ...tick(state, event.at), phase: 'finishing', gridOpen: false, error: null } : state;
    case 'FINISHED':
      return state.phase === 'finishing' ? { ...state, phase: 'done', error: null } : state;
    case 'FINISH_FAILED':
      return state.phase === 'finishing' ? { ...state, phase: 'error', error: event.message } : state;
    case 'RETRY_FINISH':
      return state.phase === 'error' ? { ...state, phase: 'finishing', error: null } : state;
    default:
      return state;
  }
}

export type GridStatus = 'blank' | 'answered' | 'flagged';

/** Izgara durumu: bayrak her şeyin önünde (bayraklı soru cevaplı da olabilir; sayımlar ayrı). */
export function gridItems(state: ExamState): Array<{ no: number; status: GridStatus }> {
  return state.slots.map((s) => ({ no: s.no, status: s.flagged ? 'flagged' : s.answer !== null ? 'answered' : 'blank' }));
}

export interface ExamCounts {
  total: number;
  answered: number;
  flagged: number;
  blank: number;
}

export function examCounts(state: ExamState): ExamCounts {
  const total = state.slots.length;
  const answered = state.slots.filter((s) => s.answer !== null).length;
  return { total, answered, flagged: state.slots.filter((s) => s.flagged).length, blank: total - answered };
}

/** Izgara alt sayfası özeti, kelimeyle: "6 cevaplı, 1 işaretli, 3 boş". */
export function countsLine(c: ExamCounts): string {
  return `${c.answered} cevaplı, ${c.flagged} işaretli, ${c.blank} boş`;
}

/** Bitir onayı: boş sayısını söyler. */
export function confirmText(c: ExamCounts): string {
  if (c.blank === 0) return 'Tüm soruları cevapladın. Sınavı bitirelim mi?';
  return `${c.blank} soru boş. Yine de bitirmek istiyor musun?`;
}

export function currentSlot(state: ExamState): ExamSlot | undefined {
  return state.slots[state.index];
}

export function isLastQuestion(state: ExamState): boolean {
  return state.index === state.slots.length - 1;
}

/** Sunucuya gidecek anlık görüntü (cevabın tamamı). */
export function snapshotOf(slot: ExamSlot): { questionId: string; answer: string | null; flagged: boolean; timeSpentSec: number } {
  return { questionId: slot.questionId, answer: slot.answer, flagged: slot.flagged, timeSpentSec: slot.spentSec };
}
