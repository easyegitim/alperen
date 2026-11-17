import { NextResponse, type NextRequest } from 'next/server';
import { safeNextPath } from '@/lib/routing';
import { createSupabaseServerClient } from '@/server/supabase';
import { getSiteUrl } from '@/server/site-url';

/**
 * PKCE dönüşü: e-posta bağlantısı ve Google, `?code=` ile buraya gelir. Kod oturuma çevrilir, çerezler yazılır ve
 * kullanıcı `?next=` yoluna (yoksa `/`; oradan proxy rol ana sayfasına yönlendirir) gönderilir.
 */
export async function GET(request: NextRequest) {
  const site = await getSiteUrl();
  const { searchParams } = request.nextUrl;
  const code = searchParams.get('code');
  const next = safeNextPath(searchParams.get('next'));
  if (!code) return NextResponse.redirect(`${site}/giris?hata=baglanti`);
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) return NextResponse.redirect(`${site}/giris?hata=baglanti`);
  return NextResponse.redirect(`${site}${next}`);
}
