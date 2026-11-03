import { NextResponse, type NextRequest } from 'next/server';
import { decideRoute } from './lib/routing';
import { updateSession } from './lib/supabase/session';
import { isSupabaseConfigured } from './lib/env';

/**
 * Next.js 16 proxy (eski middleware): her sayfa isteğinde Supabase oturumunu yeniler ve rol yönlendirmesini yapar.
 * Karar saf işlev `decideRoute` içindedir (test/routing.test.ts). Yetki asıl olarak sunucu bileşenlerinde
 * `requireRole` ile yeniden doğrulanır; proxy iyimser bir ilk kapıdır.
 */
export async function proxy(request: NextRequest) {
  // Supabase yapılandırılmadıysa (ör. ilk kurulum) yalnız sağlık ucu ve çevrimdışı sayfa çalışır; gerisi açıklayıcı hata verir.
  if (!isSupabaseConfigured()) {
    const { pathname } = request.nextUrl;
    if (pathname === '/api/health' || pathname === '/cevrimdisi' || pathname === '/giris') return NextResponse.next();
    return new NextResponse('Öğrenmen yapılandırılmadı: NEXT_PUBLIC_SUPABASE_URL ve NEXT_PUBLIC_SUPABASE_ANON_KEY tanımla.', {
      status: 503,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
  }

  const session = await updateSession(request);
  const decision = decideRoute({
    pathname: request.nextUrl.pathname,
    authed: session.userId !== null,
    role: session.role,
    onboarded: session.onboarded,
    search: request.nextUrl.search,
  });
  if (decision.type === 'next') return session.response;

  // API uçları oturumsuzken girişe yönlenmez: fetch yönlendirmeyi izleyip HTML alır ve istemci "bağlantı" hatası
  // gösterirdi. Bunun yerine JSON 401 (istemci "Oturumun kapanmış" der).
  if (session.userId === null && request.nextUrl.pathname.startsWith('/api/')) {
    const res = NextResponse.json(
      { error: { code: 'unauthenticated', message: 'Oturumun kapanmış. Yeniden giriş yap.' } },
      { status: 401, headers: { 'Cache-Control': 'no-store' } },
    );
    for (const cookie of session.response.cookies.getAll()) res.cookies.set(cookie);
    return res;
  }

  const target = new URL(decision.to, request.url);
  const redirect = NextResponse.redirect(target);
  // Yenilenen oturum çerezleri yönlendirme yanıtına da taşınır.
  for (const cookie of session.response.cookies.getAll()) redirect.cookies.set(cookie);
  return redirect;
}

export const config = {
  // Statik dosyalar, görsel eniyileme, servis çalışanı ve simgeler dışındaki her şey.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|sw.js|swe-worker-.*\\.js|icons/|.*\\.(?:png|jpg|jpeg|webp|svg|ico|woff2|map)$).*)'],
};
