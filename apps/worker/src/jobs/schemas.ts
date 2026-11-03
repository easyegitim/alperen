import { z } from 'zod';

/** Gevşek UUID (sürüm/varyant denetimi yok: fikstürlerde 0000…0001 gibi kimlikler de geçer). */
export const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, 'uuid bekleniyor');
