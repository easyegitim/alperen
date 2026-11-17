/** notification-copy — Haiku 5.5 bildirim metni (PLAN-v2 §10): saygılı, alarm vermeyen, somut adım; ünlem ve emoji yok. */
import { z } from 'zod';
import { defineContract } from './kit.js';

export const notificationCopy = defineContract({
  name: 'notification-copy',
  title: 'NotificationCopy',
  description: 'Bildirim başlığı, gövdesi ve isteğe bağlı eylem etiketi. Ünlemsiz, emojisiz.',
  llmOutput: true,
  build: (c) =>
    z.strictObject({
      title: c.uiText({ min: 3, max: 60 }),
      body: c.uiText({ min: 10, max: 240 }),
      action_label: c.uiText({ max: 30 }).nullable().describe('Düğme etiketi; eylem yoksa null'),
    }),
});

export type NotificationCopy = z.output<typeof notificationCopy.strict>;
