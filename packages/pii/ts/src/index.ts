// @ogrenmen/pii — PII temizleyici ve ad-token hash yardımcıları.
// Python eşleniği: packages/pii/py (ogrenmen_pii); iki uygulama aynı cases.json'u geçer.
export {
  ANSWER_WORDS,
  ERROR_CODES,
  FOLD_FROM,
  FOLD_TO,
  KINDS,
  LOW_STOP,
  PATTERNS,
  PLACEHOLDERS,
  ROLE_LABELS,
  RULES_VERSION,
  SCHOOL_WORDS,
  STOP_CAP,
  SUBJECTS,
  VERDICT_WORDS,
  config,
  isValidTckn,
  nameTokenHashes,
  normalizeToken,
  scrub,
  tokenHash,
  totalReplacements,
} from './scrub.js';
export type { Kind, PatternName, Replacement, RoleLabel, ScrubOptions, ScrubResult } from './scrub.js';
export { sha256Hex, sha256HexBytes } from './sha256.js';
