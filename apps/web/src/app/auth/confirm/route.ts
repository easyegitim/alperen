import type { EmailOtpType } from '@supabase/supabase-js';
import { NextResponse, type NextRequest } from 'next/server';
import { safeNextPath } from '@/lib/routing';
import { createSupabaseServerClient } from '@/server/supabase';
import { getSiteUrl } from '@/server/site-url';

const OTP_TYPES: readonly EmailOtpType[] = ['signup', 'invite', 'magiclink', 'recovery', 'email_change', 'email'];

/** E-posta şablonu `token_hash` ile bağlantı verirse (tarayıcı farkından bağımsız çalışır): doğrular ve yönlendirir. */
export async function GET(request: NextRequest) {
  const site = await getSiteUrl();
  const { searchParams } = request.nextUrl;
  const tokenHash = searchParams.get('token_hash');
  const type = searchParams.get('type') as EmailOtpType | null;
  const next = safeNextPath(searchParams.get('next'));
  if (!tokenHash || !type || !OTP_TYPES.includes(type)) return NextResponse.redirect(`${site}/giris?hata=baglanti`);
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
  if (error) return NextResponse.redirect(`${site}/giris?hata=baglanti`);
  return NextResponse.redirect(`${site}${next}`);
}
