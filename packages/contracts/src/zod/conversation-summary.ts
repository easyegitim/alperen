/** conversation-summary — Haiku 5.5 sohbet özeti (PLAN-v2 §3.4): son 30 mesajdan eskisi özetlenir (conversations.summary). */
import { z } from 'zod';
import { skillCode } from './common.js';
import { defineContract } from './kit.js';

export const conversationSummary = defineContract({
  name: 'conversation-summary',
  title: 'ConversationSummary',
  description: 'Eski sohbet mesajlarının özeti: düzyazı özet, açık kalan konular ve değinilen kazanımlar.',
  llmOutput: true,
  build: (c) =>
    z.strictObject({
      summary: c.str({ min: 10, max: 1500, desc: 'Üçüncü tekil, isimsiz özet' }),
      open_threads: c.arr(c.str({ min: 1, max: 200 }), { max: 6 }),
      skill_ids: c.arr(skillCode(c), { max: 8 }),
    }),
});

export type ConversationSummary = z.output<typeof conversationSummary.strict>;
