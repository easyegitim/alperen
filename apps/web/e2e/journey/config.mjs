// P1 yolculuk E2E'si (e2e/p1-journey.spec.ts) için sabitler. Sahte E2E'den (fixtures.mjs: 54399/3101) ayrı portlar:
// iki takım aynı makinede birbirinin sunucusuna bağlanmasın. Gerçek kimlik/sır içermez.
export const BRIDGE_PORT = Number(process.env.JOURNEY_SUPABASE_PORT || 54398);
export const BRIDGE_URL = `http://127.0.0.1:${BRIDGE_PORT}`;
export const JOURNEY_WEB_PORT = Number(process.env.JOURNEY_WEB_PORT || 3102);
export const JOURNEY_WEB_URL = `http://127.0.0.1:${JOURNEY_WEB_PORT}`;
export const WORKER_HEALTH_PORT = Number(process.env.JOURNEY_WORKER_PORT || 3103);
export const JOURNEY_OTP = '246810';
// Yerel köprünün JWT imza anahtarı (yalnız 127.0.0.1'de dinleyen geçici sınama köprüsü; sır değildir).
export const JOURNEY_JWT_SECRET = 'journey-local-hs256-not-a-secret';
export const LESSON_SERVICE_PORT = Number(process.env.JOURNEY_LESSON_PORT || 8712);
