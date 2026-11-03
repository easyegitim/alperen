import { z } from 'zod';
import { isRouteName, ROUTES, type RouteName } from '@ogrenmen/llm';
import { PermanentJobError } from './errors.js';
import type { JobDefinition } from './types.js';

const payload = z.object({
  /** Senkron bir rota adı; varsayılan `coach_chat` (serbest metin, kısa). */
  route: z.string().default('coach_chat'),
  text: z.string().min(1).max(500).default('ping'),
  maxTokens: z.number().int().min(16).max(4000).default(128),
  /** `students.public_ref` (asla uuid). */
  studentRef: z.string().optional(),
});

export interface LlmPingResult {
  route: string;
  model: string;
  status: 'ok';
  text: string;
  costUsd: number;
  ledgerIds: number[];
  inputTokens: number;
  outputTokens: number;
}

const PRODUCT = 'Sen Öğrenmen çalışma asistanısın. Bu bir bağlantı denemesidir: tek kısa cümleyle yanıt ver.';

export const llmPingJob: JobDefinition<z.infer<typeof payload>, LlmPingResult> = {
  name: 'llm.ping',
  description: 'Anthropic geçidi üzerinden tek çağrı (fake ya da gerçek); sonuç llm_calls defterine yazılır.',
  process: 'worker',
  payload,
  concurrency: 1,
  // 429/529 gibi geçici hatalarda üstel geri çekilme (PLAN-v2.md §5).
  retry: { retryLimit: 3, retryDelay: 30, retryBackoff: true, retryDelayMax: 600, expireInSeconds: 300, deleteAfterSeconds: 86_400 },
  handler: async (p, ctx) => {
    if (!isRouteName(p.route)) throw new PermanentJobError(`bilinmeyen rota: ${p.route}`, 'OGR-JOB-101');
    const route: RouteName = p.route;
    if (ROUTES[route].mode === 'batch') throw new PermanentJobError(`${route} bir Batch rotasıdır; llm.ping senkron rota ister`, 'OGR-JOB-102');
    const gateway = await ctx.gateway();
    const res = await gateway.call(route, {
      system: { product: PRODUCT },
      user: p.text,
      maxTokens: p.maxTokens,
      purpose: 'llm.ping',
      studentRef: p.studentRef ?? null,
      ref: { table: 'pgboss.job', id: ctx.job.id },
      signal: ctx.signal,
    });
    return {
      route,
      model: res.model,
      status: 'ok',
      text: res.text,
      costUsd: res.costUsd,
      ledgerIds: res.ledgerIds,
      inputTokens: res.usage.input,
      outputTokens: res.usage.output,
    };
  },
};
