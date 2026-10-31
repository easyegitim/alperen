/** /yardim — komut listesi + kota + "Verilerin nasıl kullanılıyor?". */
import { texts } from '../../texts.ts';
import { say, type Ctx } from '../context.ts';

export async function run(ctx: Ctx): Promise<void> {
  await say(ctx, texts.help);
}
