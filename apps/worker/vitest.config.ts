/**
 * İki proje (BLUEPRINT §5.11):
 *  - scenarios: @cloudflare/vitest-pool-workers (miniflare/workerd). wrangler.toml'un VARSAYILAN ortamı
 *    (environment: undefined) — üretim ortamı seçilmez, gerçek AI bağlaması yüklenmez. Senaryolar
 *    createApp'e sahte bağımlılıkları doğrudan verir; sahte `AI` nesnesi (`test/fakes/ai.ts` fakeAiRun)
 *    workers-ai.ts'e bağlama olarak geçirilir (miniflare.bindings yalnız JSON taşıdığı için işlev
 *    bağlaması orada verilemez; README "Kabul komutu notu").
 *  - unit: düz Node (cpu-budget dahil).
 */
import { defineWorkersProject } from '@cloudflare/vitest-pool-workers/config';
import { defineConfig, defineProject } from 'vitest/config';
import { hukukDocs, mdText } from './vitest.shared.ts';

const quietInfo = (log: string): false | undefined => (log.includes('"lvl":"info"') ? false : undefined);

export default defineConfig({
  test: {
    onConsoleLog: quietInfo,
    workspace: [
      defineWorkersProject({
        plugins: [mdText, hukukDocs],
        test: {
          name: 'scenarios',
          include: ['test/scenarios/**/*.test.ts'],
          poolOptions: {
            workers: {
              singleWorker: true,
              isolatedStorage: false,
              wrangler: { configPath: './wrangler.toml', environment: undefined },
              miniflare: {
                bindings: { ADAPTERS: 'fake', DB: 'fake' },
              },
            },
          },
        },
      }),
      defineProject({
        plugins: [mdText, hukukDocs],
        test: {
          name: 'unit',
          include: ['test/unit/**/*.test.ts'],
          environment: 'node',
        },
      }),
    ],
  },
});
