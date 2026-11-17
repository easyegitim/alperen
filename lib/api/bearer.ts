// SPEC-MOBILE M2: mobil istemci oturumu çerez yerine "Authorization: Bearer <access_token>" ile taşır.
// Saf yardımcı; birim testi var. Token doğrulaması Supabase Auth'ta (auth.getUser(token)) yapılır.
const JWT_RE = /^[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}$/;

/** "Bearer x.y.z" → "x.y.z"; biçim JWT'ye benzemiyorsa null (boş/yanlış başlık çerez akışına düşer). */
export function parseBearer(header: string | null | undefined): string | null {
  if (!header) return null;
  const m = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!m) return null;
  const token = m[1].trim();
  return JWT_RE.test(token) ? token : null;
}
