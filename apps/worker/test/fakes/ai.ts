/**
 * Sahte Workers AI bağlaması: `env.AI.run(model, input)` imzası. Yanıt §2.3 seçim kuralıyla
 * fixtures/llm/chat'ten seçilir (prompt_text = sistem + "\n\n" + mesajlar). `workers-ai.ts` bu nesneyi
 * gerçek bağlama sanar; çağrılar `aiCalls`'a yazılır.
 */
import type { AiBinding } from '../../src/env.ts';
import { loadLlmFixtures } from './llm-fixtures.ts';
import { selectFixture } from './providers.ts';
import { estimateTokens } from '../../src/util.ts';

export interface AiCall {
  model: string;
  input: Record<string, unknown>;
}

export function makeFakeAi(opts: { failWith?: string } = {}): AiBinding & { calls: AiCall[] } {
  const fixtures = loadLlmFixtures();
  const calls: AiCall[] = [];
  return {
    calls,
    async run(model: string, input: Record<string, unknown>): Promise<unknown> {
      calls.push({ model, input });
      if (opts.failWith !== undefined) throw new Error(opts.failWith);
      const msgs = (input.messages as Array<{ role: string; content: string }> | undefined) ?? [];
      const promptText = msgs.map((m) => m.content).join('\n\n');
      const file = selectFixture(fixtures, 'chat', promptText);
      const response = JSON.stringify(file.data);
      return { response, usage: { prompt_tokens: estimateTokens(promptText), completion_tokens: estimateTokens(response) } };
    },
  };
}

/** BLUEPRINT §5.11 adı: `miniflare.bindings.AI = { run: fakeAiRun }` eşleniği. */
export const fakeAiRun = makeFakeAi().run;
