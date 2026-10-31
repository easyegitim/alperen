/**
 * Prompt derleme: şablonlar modül yüklenirken bir kez parçalanır (CPU bütçesi), her turda yalnız
 * birleştirilir. prompt_version = dosya adı; prompt_hash = sha256(prompt_text). `prompt_text`
 * TEMİZLENMİŞ tam prompt'tur (sistem + bağlam + öğrenci mesajı) ve bot_responses'a böyle yazılır.
 */
import { sha256Hex } from '@ogrenmen/pii';
import socratic from './socratic.v3.md';
import direct from './direct.v2.md';
import group from './group.v1.md';
import diagnosticSummary from './diagnostic-summary.v1.md';

type Part = { text: string } | { key: string };

function compile(src: string): Part[] {
  const parts: Part[] = [];
  const re = /\{\{(\w+)\}\}/g;
  let last = 0;
  for (let m = re.exec(src); m !== null; m = re.exec(src)) {
    parts.push({ text: src.slice(last, m.index) });
    parts.push({ key: m[1] ?? '' });
    last = m.index + m[0].length;
  }
  parts.push({ text: src.slice(last) });
  return parts;
}

export const PROMPT_SOURCES = {
  'socratic.v3': socratic,
  'direct.v2': direct,
  'group.v1': group,
  'diagnostic-summary.v1': diagnosticSummary,
} as const;
export type PromptVersion = keyof typeof PROMPT_SOURCES;

const COMPILED: Record<PromptVersion, Part[]> = {
  'socratic.v3': compile(socratic),
  'direct.v2': compile(direct),
  'group.v1': compile(group),
  'diagnostic-summary.v1': compile(diagnosticSummary),
};

export function render(version: PromptVersion, vars: Record<string, string>): string {
  let out = '';
  for (const p of COMPILED[version]) out += 'text' in p ? p.text : (vars[p.key] ?? '');
  return out.trim();
}

export interface ChatPromptInput {
  baseVersion: string;
  mode: 'socratic' | 'direct';
  hintLevel: number;
  profile: string;
  misconceptions: string;
  facts: string;
  recent: string;
  question: string;
  solution: string | null;
  group: { username: string | null } | null;
  studentText: string;
}

export interface BuiltPrompt {
  system: string;
  user: string;
  promptText: string;
  promptVersion: string;
  promptHash: string;
}

const HINT_GUIDE = ['soruyla yönlendir', 'ilk adımı göster', 'yarısına kadar çöz', 'tamamla ama kontrol sorusu ekle'];

export function buildChatPrompt(i: ChatPromptInput): BuiltPrompt {
  const base: PromptVersion = i.mode === 'direct' ? 'direct.v2' : i.baseVersion === 'socratic.v3' ? 'socratic.v3' : 'socratic.v3';
  const level = Math.max(0, Math.min(3, i.hintLevel));
  const vars: Record<string, string> = {
    mode: i.mode === 'direct' ? 'doğrudan' : 'sokratik',
    hint_level: `${level} (${HINT_GUIDE[level] ?? ''})`,
    profile: i.profile,
    misconceptions: i.misconceptions,
    facts: i.facts,
    recent: i.recent,
    question: i.question,
    solution: i.solution ?? 'yok',
  };
  let system = render(base, vars);
  let version: string = base;
  if (i.group !== null) {
    // Kullanıcı adı LLM'e gitmez: model `[KULLANICI]` etiketini yazar, Worker gönderimden önce
    // etiketi `@kullanıcı_adı` ile değiştirir (fillUsername). Ad hiç yoktur.
    system += '\n' + render('group.v1', { username: i.group.username === null ? 'kullanıcı adı yok, "sen" de' : '[KULLANICI] etiketiyle; etiketi aynen yaz' });
    version = `${base}+group.v1`;
  }
  const user = `Öğrenci: ${i.studentText}`;
  const promptText = `${system}\n\n${user}`;
  return { system, user, promptText, promptVersion: version, promptHash: sha256Hex(promptText) };
}

/**
 * Teşhis özeti (yalnız `runtime_flags.diag_summary_llm=true`, §5.5): sayılar sunucudan gelir, model yalnız
 * anlatır. `reliable=false` kazanımlarda yüzde alanı hiç gönderilmez.
 */
export function buildDiagnosticSummaryPrompt(result: { weakest: readonly string[]; skills: ReadonlyArray<{ name: string; reliable: boolean; percent: string | null }> }): BuiltPrompt {
  const payload = {
    en_zayif: result.weakest,
    kazanimlar: result.skills.map((s) => (s.reliable && s.percent !== null ? { ad: s.name, reliable: true, yuzde: s.percent } : { ad: s.name, reliable: false })),
  };
  const system = render('diagnostic-summary.v1', { result: JSON.stringify(payload) });
  const user = 'Teşhis sonucunu bana anlat.';
  const promptText = `${system}\n\n${user}`;
  return { system, user, promptText, promptVersion: 'diagnostic-summary.v1', promptHash: sha256Hex(promptText) };
}

const USER_TAG = /\[KULLANICI\]/g;

/** Grup cevabında `[KULLANICI]` etiketini öğrencinin kullanıcı adıyla doldurur; etiket yoksa başa ekler. */
export function fillUsername(parts: readonly string[], username: string | null): string[] {
  if (username === null) return parts.map((p) => p.replace(USER_TAG, 'sen').replace(/^sen, /u, ''));
  const handle = '@' + username;
  const tagged = parts.some((p) => p.includes('[KULLANICI]'));
  const out = parts.map((p) => p.replace(USER_TAG, handle));
  if (!tagged && out.length > 0) out[0] = `${handle}, ${out[0] ?? ''}`;
  return out;
}
