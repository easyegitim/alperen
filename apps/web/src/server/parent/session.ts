/**
 * Veli sohbeti bağımlılıkları ve oturum (sunucuya özel). Depo seçimi koçla aynıdır (chat/store-kind.ts):
 * `OGRENMEN_CHAT_STORE=memory` (yalnız OGRENMEN_LLM=fake) → bellek deposu; `OGRENMEN_WEB_COACH_KEY` → velinin JWT'li
 * Supabase istemcisi + parent_* RPC'leri; ikisi de yoksa 503. Yalnız `parent` rolü (admin ve öğrenci 403).
 */
import 'server-only';
import { createTransport, Gateway, type FakeTransport, type LlmTransport } from '@ogrenmen/llm';
import { loadPrompt } from '@ogrenmen/prompts';
import { getCurrentProfile } from '@/server/auth';
import { COACH_KEY_ENV } from '@/server/chat/server-token';
import { storeKindFor } from '@/server/chat/store-kind';
import { ChatError } from '@/server/chat/turn';
import { createSupabaseServerClient } from '@/server/supabase';
import { ParentChatError, PARENT_ROUTE, type ParentTurnDeps } from './agent';
import { DEMO_CHILD_ID, MemoryParentStore, SupabaseParentStore, type ParentDbClient } from './store';

type Env = Record<string, string | undefined>;

const G = Symbol.for('ogrenmen.parent.deps');
interface Shared {
  transport?: Promise<LlmTransport>;
  memory?: MemoryParentStore;
  memoryGateway?: Promise<Gateway>;
  product?: { text: string; version: string };
}
function shared(): Shared {
  const g = globalThis as typeof globalThis & { [G]?: Shared };
  g[G] ??= {};
  return g[G];
}

function transportOf(env: Env): Promise<LlmTransport> {
  const s = shared();
  s.transport ??= createTransport({ env }).catch((err: unknown) => {
    s.transport = undefined;
    throw err;
  });
  return s.transport;
}

export function parentProduct(): { text: string; version: string } {
  const s = shared();
  if (!s.product) {
    const p = loadPrompt(PARENT_ROUTE);
    s.product = { text: p.text, version: p.meta.version };
  }
  return s.product;
}

/** Sahte LLM'de veli turları için kısa betik: özet aracı + üç cümlelik yanıt (E2E deterministik). */
export function fakeParentScript(fake: FakeTransport, text: string): void {
  if (/rapor/i.test(text)) {
    fake.enqueue(PARENT_ROUTE, { toolUses: [{ name: 'request_report', input: { kind: 'weekly' } }] }, { text: 'Haftalık raporu hazırlatıyorum; hazır olunca bildirim gelecek.' });
    return;
  }
  fake.enqueue(
    PARENT_ROUTE,
    { toolUses: [{ name: 'get_child_summary', input: { period: 'week' } }] },
    { text: 'Bu hafta yaklaşık 4,5 saat çalıştı ve 38 soru çözdü. En çok rasyonel sayılara odaklandı; bu konudaki bandı orta. Bu hafta ona bir rasyonel sayı sorusunu size nasıl çözdüğünü anlatmasını isteyebilirsiniz.' },
  );
}

/** İstek başına bağımlılıklar. `user` velinin JWT'li Supabase sunucu istemcisidir. */
export async function parentDeps(user: ParentDbClient | null, env: Env = process.env): Promise<ParentTurnDeps> {
  let kind: ReturnType<typeof storeKindFor>;
  try {
    kind = storeKindFor(env);
  } catch (err) {
    if (err instanceof ChatError) throw new ParentChatError(err.code, err.status, 'Sohbet şu an kullanılamıyor.');
    throw err;
  }
  if (!kind) throw new ParentChatError('not_configured', 503, 'Sohbet şu an kullanılamıyor.');
  const transport = await transportOf(env);
  const onTurn = transport.kind === 'fake' ? ({ text }: { text: string }) => fakeParentScript(transport as FakeTransport, text) : undefined;
  if (kind === 'memory') {
    const s = shared();
    // E2E: bellek deposu örnek çocuğa ek olarak sahte Supabase'in çocuk kimliklerini kabul eder (OGRENMEN_PARENT_MEMORY_CHILDREN, virgülle).
    s.memory ??= new MemoryParentStore([DEMO_CHILD_ID, ...(env.OGRENMEN_PARENT_MEMORY_CHILDREN ?? '').split(',').map((x) => x.trim()).filter(Boolean)]);
    s.memoryGateway ??= Promise.resolve(new Gateway({ transport, ledger: s.memory.ledger() }));
    return { store: s.memory, gateway: await s.memoryGateway, product: parentProduct, ...(onTurn ? { onTurn } : {}) };
  }
  if (!user) throw new ParentChatError('unauthenticated', 401, 'Oturumunuz kapanmış. Yeniden giriş yapın.');
  const store = new SupabaseParentStore(user, env[COACH_KEY_ENV]!);
  return { store, gateway: new Gateway({ transport, ledger: store.ledger() }), product: parentProduct, ...(onTurn ? { onTurn } : {}) };
}

export interface ParentSession {
  deps: ParentTurnDeps;
  profileId: string;
}

export async function parentSession(): Promise<ParentSession> {
  const current = await getCurrentProfile();
  if (!current) throw new ParentChatError('unauthenticated', 401, 'Oturumunuz kapanmış. Yeniden giriş yapın.');
  if (current.profile?.role !== 'parent') throw new ParentChatError('forbidden', 403, 'Bu sohbet veli hesabında açılır.');
  const supabase = await createSupabaseServerClient();
  const deps = await parentDeps(supabase as unknown as ParentDbClient);
  return { deps, profileId: current.user.id };
}

export function parentErrorResponse(err: unknown): Response {
  if (err instanceof ParentChatError || err instanceof ChatError) {
    return Response.json({ error: { code: err.code, message: err.message } }, { status: err.status, headers: { 'Cache-Control': 'no-store' } });
  }
  console.error('OGR-PARENT-002 beklenmeyen hata', err);
  return Response.json({ error: { code: 'internal', message: 'Bir sorun oldu. Biraz sonra yeniden deneyin.' } }, { status: 500, headers: { 'Cache-Control': 'no-store' } });
}
