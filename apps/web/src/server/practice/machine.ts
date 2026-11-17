// Test oynatıcısının durum makinesi (saf; istemci useReducer ile çalıştırır, test/practice-machine.test.ts sınar).
// Akış: answering (şık seç) → SUBMIT → submitting (answer_practice_item) → ANSWERED → sıradaki cevapsız soru ya da
// finishing (finish_practice) → FINISHED → done. Ağ hatası soruda kalır (seçim korunur, yeniden denenir); bitiş hatası
// 'error' evresine geçer ve RETRY_FINISH ile yeniden denenir. Doğru/yanlış yalnız kaydedilir, soru başına gösterilmez
// (sade akış: soru, şekil, şıklar, ilerleme noktaları, Sonraki).

export type PlayerPhase = 'answering' | 'submitting' | 'finishing' | 'done' | 'error';

export interface PlayerSlot {
  no: number;
  answered: boolean;
  correct: boolean | null;
}

export interface PlayerState {
  slots: PlayerSlot[];
  /** slots içindeki konum (şu anki soru). */
  index: number;
  /** Seçilen şık anahtarı ya da yazılan sayısal cevap. */
  selected: string | null;
  phase: PlayerPhase;
  error: string | null;
  /** Şu anki sorunun gösterildiği an (ms; response_ms için). */
  shownAt: number;
}

export type PlayerEvent =
  | { type: 'SELECT'; value: string }
  | { type: 'SUBMIT' }
  | { type: 'ANSWERED'; no: number; correct: boolean; at: number }
  | { type: 'FAILED'; message: string }
  | { type: 'FINISHED' }
  | { type: 'FINISH_FAILED'; message: string }
  | { type: 'RETRY_FINISH' };

function firstOpen(slots: PlayerSlot[], from = 0): number {
  for (let i = 0; i < slots.length; i++) {
    const j = (from + i) % slots.length;
    if (!slots[j]!.answered) return j;
  }
  return -1;
}

export function initPlayer(slots: PlayerSlot[], now: number): PlayerState {
  const open = firstOpen(slots);
  return {
    slots,
    index: open === -1 ? Math.max(0, slots.length - 1) : open,
    selected: null,
    phase: open === -1 ? 'finishing' : 'answering',
    error: null,
    shownAt: now,
  };
}

export function playerReducer(state: PlayerState, event: PlayerEvent): PlayerState {
  switch (event.type) {
    case 'SELECT':
      if (state.phase !== 'answering') return state;
      return { ...state, selected: event.value, error: null };
    case 'SUBMIT':
      if (state.phase !== 'answering' || !state.selected || state.selected.trim() === '') return state;
      return { ...state, phase: 'submitting', error: null };
    case 'ANSWERED': {
      if (state.phase !== 'submitting') return state;
      const slots = state.slots.map((s) => (s.no === event.no ? { ...s, answered: true, correct: event.correct } : s));
      const open = firstOpen(slots, state.index + 1);
      if (open === -1) return { ...state, slots, selected: null, phase: 'finishing', error: null };
      return { ...state, slots, index: open, selected: null, phase: 'answering', error: null, shownAt: event.at };
    }
    case 'FAILED':
      if (state.phase !== 'submitting') return state;
      return { ...state, phase: 'answering', error: event.message };
    case 'FINISHED':
      if (state.phase !== 'finishing') return state;
      return { ...state, phase: 'done', error: null };
    case 'FINISH_FAILED':
      if (state.phase !== 'finishing') return state;
      return { ...state, phase: 'error', error: event.message };
    case 'RETRY_FINISH':
      if (state.phase !== 'error') return state;
      return { ...state, phase: 'finishing', error: null };
    default:
      return state;
  }
}

/** Şu anki soru cevaplanınca set biter mi (düğme "Bitir" olur). */
export function isLastOpen(state: PlayerState): boolean {
  return state.slots.every((s, i) => s.answered || i === state.index);
}

export function canSubmit(state: PlayerState): boolean {
  return state.phase === 'answering' && state.selected !== null && state.selected.trim() !== '';
}

/** İlerleme noktaları: cevaplanan, şu anki, sıradaki. */
export function dotStates(state: PlayerState): Array<'done' | 'current' | 'todo'> {
  return state.slots.map((s, i) => (i === state.index && state.phase !== 'done' && state.phase !== 'finishing' ? 'current' : s.answered ? 'done' : 'todo'));
}
