/** dev:fake için sahte, yalnız yerel değerler (gerçek anahtar değildir; wrangler.dev.toml ile aynı). */
export const DEV_SECRETS = {
  TELEGRAM_BOT_TOKEN: 'yerel-sahte-token',
  TELEGRAM_WEBHOOK_SECRET: 'yerel-webhook-gizi',
  WEBHOOK_SECRET_PATH: 'yerel-gizli-yol',
} as const;
