import { NextResponse } from 'next/server';
import { isSupabaseConfigured } from '@/lib/env';
import { isSiteUrlConfigured } from '@/server/site-url';

// Önbelleğe alınmaz; sürüm ve yapılandırma durumu için hafif bir uç. Gizli değer ya da kullanıcı verisi döndürmez.
export const dynamic = 'force-dynamic';

export function GET() {
  return NextResponse.json(
    {
      status: 'ok',
      service: 'ogrenmen-web',
      time: new Date().toISOString(),
      supabase: isSupabaseConfigured() ? 'configured' : 'missing',
      site_url: isSiteUrlConfigured() ? 'configured' : 'missing',
      llm: process.env.OGRENMEN_LLM === 'fake' ? 'fake' : 'real',
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
