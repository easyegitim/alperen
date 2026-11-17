import 'server-only';
import { cache } from 'react';
import { firstName } from '@/lib/format';
import { isUuid, type RpcClient } from '@/server/practice/rpc';
import { listChildren } from '@/server/queries';
import { createSupabaseServerClient } from '@/server/supabase';

export interface Child {
  id: string;
  name: string;
}

/** Velinin aktif çocukları (guardian_links; RLS). */
export const parentChildren = cache(async (parentId: string): Promise<Child[]> => {
  const list = await listChildren(parentId);
  return list.map((c) => ({ id: c.id, name: firstName(c.name) || c.name }));
});

/** `?cocuk=<id>` seçimi: geçerli ve velinin çocuğu ise o, değilse ilk çocuk. */
export function pickChild(children: readonly Child[], wanted: string | string[] | undefined): Child | null {
  const id = Array.isArray(wanted) ? wanted[0] : wanted;
  return (isUuid(id) ? children.find((c) => c.id === id) : undefined) ?? children[0] ?? null;
}

export async function parentDb(): Promise<RpcClient> {
  return (await createSupabaseServerClient()) as unknown as RpcClient;
}
