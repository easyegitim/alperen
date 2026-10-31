/**
 * Bağlam kurma (§5.5 adım 4, §5.7): son mesajlar (6) + hafıza olguları (5, hibrit skor; embedding
 * hatasında FTS) + profil (`profile_for_prompt`: yüzde ve p yok; yalnız güvenilir kazanımların bandı)
 * + bekleyen soru (şıklar ETİKETSİZ, `questions_public`). Giriş ≤ settings.chat_budget_tokens_in;
 * aşarsa son mesajlar 4'e, olgular 3'e iner.
 */
import type { Db, MemoryHit, PromptProfile, RecentMessage, SessionRow } from '../data/repo.ts';
import { EMBED_MIN_CHARS, type Embedder } from '../data/embeddings.ts';

export interface ChatContext {
  profile: PromptProfile | null;
  facts: MemoryHit[];
  recent: RecentMessage[];
  question: string;
  solution: string | null;
}

export interface ContextInput {
  db: Db;
  chatId: number;
  enrollmentId: string | null;
  studentText: string;
  excludeMessageIds: ReadonlySet<number>;
  session: SessionRow | null;
  embed: Embedder;
  recentN: number;
  memoryK: number;
}

export async function buildContext(i: ContextInput): Promise<ChatContext> {
  const recent = (await i.db.recentMessages(i.chatId, i.recentN + i.excludeMessageIds.size)).filter((m) => i.excludeMessageIds.has(m.id) === false).slice(0, i.recentN);
  let facts: MemoryHit[] = [];
  let profile: PromptProfile | null = null;
  if (i.enrollmentId !== null) {
    const isCommand = i.studentText.trim().startsWith('/');
    const emb = i.studentText.trim().length < EMBED_MIN_CHARS || isCommand ? null : await i.embed(i.studentText).catch(() => null);
    facts = await i.db.retrieveMemory(emb, i.studentText, i.memoryK);
    profile = await i.db.profileForPrompt(i.enrollmentId);
  }
  let question = 'yok';
  let solution: string | null = null;
  const pending = i.session?.pending_question_id ?? null;
  if (pending !== null) {
    const q = await i.db.questionPublic(pending);
    if (q !== null) question = `${q.stem}${q.options === null ? '' : ' ' + q.options.map((o) => `${o.key}) ${o.text}`).join(' ')}`;
    if (i.session?.direct_once === true && i.enrollmentId !== null) solution = await i.db.revealSolution(i.enrollmentId, pending);
  }
  return { profile, facts, recent, question, solution };
}

export function renderProfile(p: PromptProfile | null): string {
  if (p === null || p.weak.length === 0) return 'henüz ölçülmedi';
  const weak = p.weak.map((w) => `${w.name} (${w.band})`).join('; ');
  const extra = [p.prereq_hint, p.explanation_notes === null ? null : `işe yarayan: ${p.explanation_notes}`, p.weekly_line].filter((x): x is string => x !== null);
  return extra.length === 0 ? weak : `${weak}. ${extra.join('. ')}`;
}

export function renderMisconceptions(p: PromptProfile | null): string {
  return p === null || p.misconceptions.length === 0 ? 'yok' : p.misconceptions.join('; ');
}

export function renderFacts(facts: readonly MemoryHit[]): string {
  return facts.length === 0 ? '[]' : facts.map((f) => `[#${f.fact_id}] ${f.text}`).join(' ');
}

export function renderRecent(recent: readonly RecentMessage[]): string {
  if (recent.length === 0) return '[]';
  return [...recent]
    .reverse()
    .map((m) => `${m.sender_role === 'student' ? 'öğrenci' : m.sender_role === 'bot' ? 'sen' : 'hoca'}: ${m.text}`)
    .join(' | ');
}
