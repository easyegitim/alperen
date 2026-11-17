import * as Sentry from "@sentry/nextjs";
import { SENTRY_COMMON } from "@/lib/monitoring/sentry";

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
if (dsn) {
  Sentry.init({ dsn, ...SENTRY_COMMON, environment: process.env.NODE_ENV });
}
