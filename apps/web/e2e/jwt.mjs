// Sahte oturum üretimi: HS256 biçiminde (imza doğrulanmaz; sahte Supabase /auth/v1/user ile doğrular).
import { FAKE_URL } from './fixtures.mjs';

const b64url = (input) => Buffer.from(input).toString('base64url');

export function makeJwt(user, { expiresInSec = 3600 } = {}) {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = b64url(
    JSON.stringify({
      sub: user.id,
      email: user.email,
      role: 'authenticated',
      aud: 'authenticated',
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + expiresInSec,
    }),
  );
  return `${header}.${payload}.${b64url('e2e-signature')}`;
}

export function makeSession(user) {
  const access_token = makeJwt(user);
  return {
    access_token,
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    refresh_token: `refresh-${user.id}`,
    user: userObject(user),
  };
}

export function userObject(user) {
  return {
    id: user.id,
    aud: 'authenticated',
    role: 'authenticated',
    email: user.email,
    app_metadata: { provider: 'email' },
    user_metadata: {},
    created_at: '2026-10-01T00:00:00Z',
  };
}

/** @supabase/ssr çerez adı: sb-<proje-kodu>-auth-token; proje kodu = ana makine adının ilk parçası. */
export function cookieName() {
  return `sb-${new URL(FAKE_URL).hostname.split('.')[0]}-auth-token`;
}

/** Tarayıcıya yazılacak oturum çerezi değeri ("base64-" + base64url(JSON)). */
export function sessionCookieValue(user) {
  return `base64-${b64url(JSON.stringify(makeSession(user)))}`;
}
