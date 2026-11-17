'use server';

import { redirect } from 'next/navigation';
import { safeNextPath } from '@/lib/routing';
import { parseEmail, parseOtpCode } from '@/lib/validation';
import { createSupabaseServerClient } from '@/server/supabase';
import { resolvePostLoginPath } from '@/server/post-login';
import { getSiteUrl } from '@/server/site-url';

export interface LoginState {
  step: 'email' | 'code';
  email?: string;
  next?: string;
  error?: string;
}

function messageFor(error: { status?: number; code?: string } | null): string {
  if (error?.status === 429 || error?.code === 'over_email_send_rate_limit' || error?.code === 'over_request_rate_limit') {
    return 'Çok sık denedin. Biraz bekleyip yeniden dene.';
  }
  return 'Giriş e-postası gönderilemedi. Adresi kontrol edip yeniden dene.';
}

/** 1. adım: e-postaya 6 haneli kod ve aynı anda sihirli bağlantı gönderir (şablon ikisini de içerir). */
async function requestOtp(formData: FormData): Promise<LoginState> {
  const next = safeNextPath(String(formData.get('next') ?? ''));
  const email = parseEmail(formData.get('email'));
  if (!email) return { step: 'email', next, error: 'Geçerli bir e-posta adresi yaz.' };
  const supabase = await createSupabaseServerClient();
  const site = await getSiteUrl();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: true, emailRedirectTo: `${site}/auth/callback?next=${encodeURIComponent(next)}` },
  });
  if (error) return { step: 'email', email, next, error: messageFor(error) };
  return { step: 'code', email, next };
}

/** 2. adım: e-postadaki kodu doğrular; başarılıysa oturum çerezi yazılır ve yönlendirilir. */
async function verifyCode(formData: FormData): Promise<LoginState> {
  const next = safeNextPath(String(formData.get('next') ?? ''));
  const email = parseEmail(formData.get('email'));
  const token = parseOtpCode(formData.get('code'));
  if (!email) return { step: 'email', next, error: 'Önce e-posta adresini yaz.' };
  if (!token) return { step: 'code', email, next, error: 'Kod 6 haneli bir sayıdır. E-postandaki kodu aynen yaz.' };
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.verifyOtp({ email, token, type: 'email' });
  if (error || !data.user) return { step: 'code', email, next, error: 'Kod geçersiz ya da süresi dolmuş. Yeni bir kod isteyebilirsin.' };
  redirect(await resolvePostLoginPath(supabase, data.user.id, next));
}

/**
 * Form eylemi: gizli `step` alanına göre kod gönderir ya da kodu doğrular. "Kodu yeniden gönder" düğmesi
 * `intent=resend` ile aynı e-postaya yeni kod ister.
 */
export async function loginStep(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const step = String(formData.get('step') ?? 'email');
  const intent = String(formData.get('intent') ?? '');
  if (step === 'code' && intent !== 'resend') return verifyCode(formData);
  return requestOtp(formData);
}

/** Google ile giriş: sağlayıcı adresine yönlendirir (PKCE; dönüş /auth/callback). */
export async function signInWithGoogle(formData: FormData): Promise<void> {
  const next = safeNextPath(String(formData.get('next') ?? ''));
  const supabase = await createSupabaseServerClient();
  const site = await getSiteUrl();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: `${site}/auth/callback?next=${encodeURIComponent(next)}` },
  });
  if (error || !data.url) redirect('/giris?hata=google');
  redirect(data.url);
}
