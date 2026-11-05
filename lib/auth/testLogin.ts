/**
 * Yalnız yerel/ekip içi test: e-posta + şifre ile giriş formu. Supabase e-posta sağlayıcısı şifreli girişi API düzeyinde
 * zaten destekler; bu bayrak yalnız arayüzde formu gösterir. Üretimde tanımlı değildir (varsayılan kapalı), KB §3.1'deki
 * Google/Apple + e-posta kodu akışı değişmez. Değer derleme anında gömülür (NEXT_PUBLIC_).
 */
export function testPasswordLoginEnabled(value: string | undefined): boolean {
  return value === "true";
}

export const TEST_PASSWORD_MIN_LENGTH = 8;
