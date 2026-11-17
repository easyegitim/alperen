/**
 * proposal-review — Sonnet 5.5 gece Batch: müfredat önerilerinin (curriculum_proposals) incelenmesi (PLAN-v2 §5).
 * Her öneri için bir karar; `needs_instructor` eğitmen onayına bırakır.
 */
import { z } from 'zod';
import { addIssue, defineContract } from './kit.js';

export const PROPOSAL_ACTIONS = ['accept', 'reject', 'needs_instructor'] as const;

export const proposalReview = defineContract({
  name: 'proposal-review',
  title: 'ProposalReview',
  description: 'Müfredat önerisi incelemesi: öneri başına karar (kabul, ret, eğitmene bırak), güven ve gerekçe.',
  llmOutput: true,
  build: (c) =>
    z.strictObject({
      decisions: c.arr(
        z.strictObject({
          proposal_id: c.uuid('İncelenen önerinin kimliği'),
          action: z.enum(PROPOSAL_ACTIONS),
          confidence: c.prob('Kararın güveni 0..1'),
          rationale: c.str({ min: 5, max: 600, desc: 'Kısa gerekçe' }),
        }),
        { min: 1, max: 100 },
      ),
    }),
  refine: (v, ctx) => {
    const seen = new Set<string>();
    v.decisions.forEach((d, i) => {
      if (seen.has(d.proposal_id)) addIssue(ctx, ['decisions', i, 'proposal_id'], `yinelenen öneri: ${d.proposal_id}`);
      seen.add(d.proposal_id);
    });
  },
});

export type ProposalReview = z.output<typeof proposalReview.strict>;
