import * as Sentry from "@sentry/nextjs";

export function register() {
  if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
    Sentry.init({ dsn: process.env.NEXT_PUBLIC_SENTRY_DSN });
  }
}

export const onRequestError: typeof Sentry.captureRequestError = (...args) => {
  if (process.env.NEXT_PUBLIC_SENTRY_DSN) return Sentry.captureRequestError(...args);
};
