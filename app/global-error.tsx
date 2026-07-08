"use client";
import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

export default function GlobalError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    if (process.env.NEXT_PUBLIC_SENTRY_DSN) Sentry.captureException(error);
  }, [error]);

  return (
    // global-error replaces the root layout, so it must render html/body.
    <html lang="en">
      <body>
        <h2>Something went wrong.</h2>
        <button onClick={() => unstable_retry()}>Try again</button>
      </body>
    </html>
  );
}
