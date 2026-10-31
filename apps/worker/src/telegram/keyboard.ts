/**
 * Inline klavye kuralları (telegram.md "Düğmeler"): bir mesajda en çok 3 düğme, tek satır,
 * etiket ≤ 20 karakter, fiille başlar; asıl eylem solda. Şık klavyesi A · B · C · D ayrı kuraldır.
 * `callback_data` Telegram sınırı 64 bayttır.
 */
import type { TgInlineButton, TgReplyMarkup } from './types.ts';

export interface Button {
  text: string;
  data: string;
}

export const MAX_BUTTONS = 3;
export const MAX_LABEL = 20;
export const MAX_CALLBACK_BYTES = 64;

const enc = new TextEncoder();

export class KeyboardError extends Error {}

function check(b: Button): TgInlineButton {
  if (Array.from(b.text).length > MAX_LABEL) throw new KeyboardError(`OGR-KB-001 düğme etiketi 20 karakteri aşıyor: ${b.text}`);
  if (enc.encode(b.data).length > MAX_CALLBACK_BYTES) throw new KeyboardError(`OGR-KB-002 callback_data 64 baytı aşıyor: ${b.data}`);
  return { text: b.text, callback_data: b.data };
}

/** Eylem düğmeleri: ≤ 3 düğme, tek satır. */
export function actionKeyboard(buttons: readonly Button[]): TgReplyMarkup {
  if (buttons.length === 0 || buttons.length > MAX_BUTTONS) throw new KeyboardError('OGR-KB-003 bir mesajda 1–3 düğme olur');
  return { inline_keyboard: [buttons.map(check)] };
}

export const OPTION_KEYS = ['A', 'B', 'C', 'D'] as const;
export type OptionKey = (typeof OPTION_KEYS)[number];

/** Çoktan seçmeli şık klavyesi: A · B · C · D (şık metinleri mesaj gövdesindedir). */
export function optionKeyboard(dataFor: (key: OptionKey) => string): TgReplyMarkup {
  return { inline_keyboard: [OPTION_KEYS.map((k) => check({ text: k, data: dataFor(k) }))] };
}

/** Kilitli klavye (düğmeler kaldırılır). */
export const LOCKED: TgReplyMarkup = { inline_keyboard: [] };

/** UUID ↔ 22 karakterlik base64url (callback_data 64 bayt sınırı; fixtures README sapma #1). */
export function uuidToB64(uuid: string): string {
  const hex = uuid.replace(/-/g, '');
  if (!/^[0-9a-f]{32}$/i.test(hex)) throw new KeyboardError('OGR-KB-004 geçersiz uuid');
  let bin = '';
  for (let i = 0; i < 32; i += 2) bin += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function b64ToUuid(s: string): string | null {
  if (!/^[A-Za-z0-9_-]{22}$/.test(s)) return null;
  let bin: string;
  try {
    bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==');
  } catch {
    return null;
  }
  if (bin.length !== 16) return null;
  let hex = '';
  for (let i = 0; i < 16; i++) hex += bin.charCodeAt(i).toString(16).padStart(2, '0');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export interface AnswerCallback {
  session: string;
  question: string;
  key: OptionKey;
}

export function encodeAnswer(session: string, question: string, key: OptionKey): string {
  return `ans:${uuidToB64(session)}:${uuidToB64(question)}:${key}`;
}

export function decodeAnswer(data: string): AnswerCallback | null {
  const m = /^ans:([A-Za-z0-9_-]+):([A-Za-z0-9_-]+):([ABCD])$/.exec(data);
  if (m === null) return null;
  const session = b64ToUuid(m[1] ?? '');
  const question = b64ToUuid(m[2] ?? '');
  if (session === null || question === null) return null;
  return { session, question, key: m[3] as OptionKey };
}
