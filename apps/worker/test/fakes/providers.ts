/**
 * Deterministik sahte LLM arka ucu (BLUEPRINT §2.3; `ogrenmen_common.fakes.FakeLLM` ile BİREBİR aynı
 * seçim kuralı): `fixtures/llm/<amaç>/*.json` dosyaları ada göre sıralanır, `bad-schema*.json` dışarıda
 * bırakılır, `i = int(sha256(prompt_text)[:8], 16) mod n`. `prompt_text` = sistem + "\n\n" + mesajlar
 * ("\n\n" ile) — Worker'ın `bot_responses.prompt_text`'e yazdığı metnin aynısı.
 * `failWith: {429: [0]}` → 0. çağrı 429; `badOutputEvery: n` → her n. çağrı bad-schema.json;
 * `providerStatus: {'gemini-paid': 401}` → o sağlayıcı her çağrıda bu durumu döner. Token sayacı:
 * 4 karakter ≈ 1 token (Worker bütçe kırpmasıyla aynı kural).
 */
import { sha256Hex } from '@ogrenmen/pii';
import type { FakeBackend } from '../../src/llm/providers/fake.ts';
import { FakeProvider } from '../../src/llm/providers/fake.ts';
import type { CompleteRequest, CompleteResult, Provider, ProviderId } from '../../src/llm/providers/types.ts';
import { estimateTokens } from '../../src/util.ts';

export interface LlmFixture {
  name: string;
  data: unknown;
}

export type LlmFixtures = Record<string, LlmFixture[]>;

export interface FakeCall {
  index: number;
  provider: ProviderId;
  model: string;
  purpose: string;
  promptText: string;
  file: string | null;
  status: number;
  tokensIn: number;
  tokensOut: number;
}

export interface FakeLlmOptions {
  failWith?: Record<number, number[]>;
  badOutputEvery?: number;
  providerStatus?: Partial<Record<ProviderId, number>>;
  /** Belirli bir dosyayı zorla (ör. 'chat/05-escalate.json'); seçim kuralını atlar. */
  pick?: string | null;
}

/** Python `sorted(..., key=lambda p: p.name)` ile aynı: kod noktası sırası. */
function byName(a: LlmFixture, b: LlmFixture): number {
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
}

export function candidates(fixtures: LlmFixtures, purpose: string): LlmFixture[] {
  return [...(fixtures[purpose] ?? [])].sort(byName).filter((f) => f.name.startsWith('bad-schema') === false);
}

/** §2.3 seçim kuralı: dosya adı. */
export function selectFixture(fixtures: LlmFixtures, purpose: string, promptText: string): LlmFixture {
  const files = candidates(fixtures, purpose);
  if (files.length === 0) throw new Error(`fixtures/llm/${purpose} boş`);
  const i = parseInt(sha256Hex(promptText).slice(0, 8), 16) % files.length;
  return files[i] as LlmFixture;
}

export function promptTextOf(req: CompleteRequest): string {
  return `${req.system}\n\n${req.messages.map((m) => m.content).join('\n\n')}`;
}

export class FakeLlm implements FakeBackend {
  readonly calls: FakeCall[] = [];
  options: FakeLlmOptions;

  constructor(
    private readonly fixtures: LlmFixtures,
    options: FakeLlmOptions = {},
  ) {
    this.options = options;
  }

  /** Başarılı (200) çağrılar. */
  get okCalls(): FakeCall[] {
    return this.calls.filter((c) => c.status === 200);
  }

  async complete(provider: ProviderId, req: CompleteRequest): Promise<CompleteResult> {
    const index = this.calls.length;
    const purpose = req.purpose ?? 'chat';
    const promptText = promptTextOf(req);
    const tokensIn = estimateTokens(promptText);
    const forced = this.options.providerStatus?.[provider];
    let status = forced ?? 200;
    for (const [code, idxs] of Object.entries(this.options.failWith ?? {})) if (idxs.includes(index)) status = Number(code);
    if (status !== 200) {
      this.calls.push({ index, provider, model: req.model, purpose, promptText, file: null, status, tokensIn: 0, tokensOut: 0 });
      if (status === 429) return { ok: false, error: 'rate_limited', status, retryAfterMs: 30_000, latencyMs: 5 };
      if (status === 400 || status === 401 || status === 403) return { ok: false, error: 'config', status, latencyMs: 5 };
      if (status === 408) return { ok: false, error: 'timeout', latencyMs: 8000 };
      return { ok: false, error: 'server', status, latencyMs: 5 };
    }
    let file: LlmFixture;
    const every = this.options.badOutputEvery ?? 0;
    if (every > 0 && (index + 1) % every === 0) {
      file = (this.fixtures[purpose] ?? []).find((f) => f.name.startsWith('bad-schema')) ?? selectFixture(this.fixtures, purpose, promptText);
    } else if (this.options.pick) {
      const [dir, name] = this.options.pick.split('/');
      file = (this.fixtures[dir ?? ''] ?? []).find((f) => f.name === name) ?? selectFixture(this.fixtures, purpose, promptText);
    } else {
      file = selectFixture(this.fixtures, purpose, promptText);
    }
    const text = JSON.stringify(file.data);
    const tokensOut = estimateTokens(text);
    this.calls.push({ index, provider, model: req.model, purpose, promptText, file: file.name, status, tokensIn, tokensOut });
    return { ok: true, text, tokensIn, tokensOut, latencyMs: 12 };
  }
}

/** Her sağlayıcı kimliği için sahte sağlayıcı (zincir mantığı gerçek kimliklerle sınanır). */
export function fakeProviders(backend: FakeBackend): Map<string, Provider> {
  const ids: Array<[ProviderId, boolean]> = [
    ['gemini-paid', true],
    ['gemini-free', false],
    ['groq', false],
    ['cf-ai', false],
    ['openrouter', false],
  ];
  return new Map(ids.map(([id, paid]) => [id, new FakeProvider(id, paid, backend)]));
}
