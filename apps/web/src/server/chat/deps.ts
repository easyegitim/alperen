/**
 * Koç sohbeti bağımlılıkları (sunucuya özel). Seçim ortamdan (store-kind.ts):
 *   - `OGRENMEN_CHAT_STORE=memory` → süreç içi depo; yalnız `OGRENMEN_LLM=fake` ile açılır (E2E, yerel geliştirme).
 *   - `OGRENMEN_WEB_COACH_KEY` → `SupabaseChatStore`: istek başına kullanıcının JWT'li Supabase istemcisi + 0028 koç
 *     RPC'leri; güvenilir yazımlar bu anahtarla basılan sunucu jetonuyla. service_role ve doğrudan Postgres bağlantısı yok.
 *   - ikisi de yoksa koç kapalıdır (503, arayüz sade bir hata gösterir).
 * LLM taşıması `OGRENMEN_LLM` (fake | anthropic; anthropic için ANTHROPIC_API_KEY ortamdan okunur) süreç boyunca tektir;
 * geçit istek başına kurulur (defter yazıcısı isteğin kullanıcısına bağlıdır).
 */
import 'server-only';
import { createTransport, Gateway, type LlmTransport } from '@ogrenmen/llm';
import { loadPrompt, type VersionSources } from '@ogrenmen/prompts';
import { MemoryChatStore } from './memory-store';
import { COACH_KEY_ENV } from './server-token';
import { RETIRED_COACH_ENV, storeKindFor } from './store-kind';
import { SupabaseChatStore, type CoachDbClient } from './supabase-store';
import { ChatError, type CoachRoute, type ProductPrompt, type TurnDeps } from './turn';

type Env = Record<string, string | undefined>;

const G = Symbol.for('ogrenmen.chat.deps');
interface Shared {
  transport?: Promise<LlmTransport>;
  /** Bellek kipinin geçidi (defter süreç içi). */
  memoryGateway?: Promise<Gateway>;
  products: Map<CoachRoute, ProductPrompt>;
  /** Prompt sürüm kaynakları (coach_prompt_sources; 60 sn önbellek). */
  sources?: { at: number; value: VersionSources };
  warned?: boolean;
}
function shared(): Shared {
  const g = globalThis as typeof globalThis & { [G]?: Shared };
  g[G] ??= { products: new Map() };
  return g[G];
}

export const PROMPT_SOURCES_TTL_MS = 60_000;

export function coachProduct(route: CoachRoute): ProductPrompt {
  const s = shared();
  let p = s.products.get(route);
  if (!p) {
    const loaded = loadPrompt(route);
    p = { text: loaded.text, version: loaded.meta.version };
    s.products.set(route, p);
  }
  return p;
}

/** coach_prompt_sources → {pinned, active} (yalnız sürüm deseni uyanlar); hata olursa son bilinen ya da boş. */
async function promptSources(store: SupabaseChatStore, now: number): Promise<VersionSources> {
  const s = shared();
  if (s.sources && now - s.sources.at < PROMPT_SOURCES_TTL_MS) return s.sources.value;
  try {
    const raw = (await store.call('coach_prompt_sources')) as { pinned?: Record<string, unknown>; active?: Record<string, unknown> } | null;
    const pick = (o: Record<string, unknown> | undefined) =>
      Object.fromEntries(Object.entries(o ?? {}).filter((e): e is [string, string] => typeof e[1] === 'string'));
    s.sources = { at: now, value: { pinned: pick(raw?.pinned), active: pick(raw?.active) } };
  } catch (err) {
    console.warn('OGR-CHAT-013 prompt sürüm kaynakları okunamadı; kilit varsayılanı kullanılıyor.', err);
    s.sources = { at: now, value: s.sources?.value ?? {} };
  }
  return s.sources.value;
}

/** İstek başına bağımlılıklar. `user` kullanıcının JWT'li Supabase sunucu istemcisidir. */
export async function chatDeps(user: CoachDbClient | null, env: Env = process.env): Promise<TurnDeps> {
  const kind = storeKindFor(env);
  if (!kind) throw new ChatError('not_configured', 503, 'Koç şu an kullanılamıyor.');
  const s = shared();
  if (!s.warned && RETIRED_COACH_ENV.some((k) => env[k])) {
    s.warned = true;
    console.warn(`OGR-CHAT-012 ${RETIRED_COACH_ENV.join(', ')} artık okunmaz; koç yalnız kullanıcının JWT'si ve ${COACH_KEY_ENV} ile çalışır.`);
  }
  if (kind === 'memory') {
    const store = new MemoryChatStore();
    s.memoryGateway ??= (async () => new Gateway({ transport: await transportOf(env), ledger: store.ledger() }))();
    return { store, gateway: await s.memoryGateway, product: coachProduct };
  }
  if (!user) throw new ChatError('unauthenticated', 401, 'Oturumun kapanmış. Yeniden giriş yap.');
  const store = new SupabaseChatStore(user, env[COACH_KEY_ENV]!);
  const gateway = new Gateway({ transport: await transportOf(env), ledger: store.ledger() });
  // Sürüm sabitlemesi ve geri alma (PLAN §6) koç rotalarına da ulaşır (coach_prompt_sources, 60 sn önbellek).
  const product = async (route: CoachRoute): Promise<ProductPrompt> => {
    const loaded = loadPrompt(route, { sources: await promptSources(store, Date.now()) });
    return { text: loaded.text, version: loaded.meta.version };
  };
  return { store, gateway, product };
}

function transportOf(env: Env): Promise<LlmTransport> {
  const s = shared();
  s.transport ??= createTransport({ env }).catch((err: unknown) => {
    s.transport = undefined;
    throw err;
  });
  return s.transport;
}
