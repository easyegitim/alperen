import { NextResponse } from 'next/server';
import { isSupabaseConfigured } from '@/lib/env';

// Önbelleğe alınmaz; sürüm ve yapılandırma durumu için hafif bir uç. Gizli değer ya da kullanıcı verisi döndürmez.
export const dynamic = 'force-dynamic';

export function GET() {
  return NextResponse.json(
    {
      status: 'ok',
      service: 'ogrenmen-web',
      time: new Date().toISOString(),
      supabase: isSupabaseConfigured() ? 'configured' : 'missing',
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
