import { createBrowserClient } from '@supabase/ssr';
import { getPublicEnv } from '../env';
import type { Database } from './types';

/** Tarayıcı istemcisi (yalnız 'use client' bileşenlerinde). Oturum çerezleri @supabase/ssr ile yönetilir. */
export function createSupabaseBrowserClient() {
  const env = getPublicEnv();
  return createBrowserClient<Database>(env.supabaseUrl, env.supabaseAnonKey);
}
