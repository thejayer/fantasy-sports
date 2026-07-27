"use client";

import { useEffect } from "react";

/**
 * Route-level error boundary. Cloud Run already ships stderr to Cloud Logging;
 * logging the error here is enough for Error Reporting to pick it up without a
 * third-party SDK. Sentry (or similar) can wrap `reportClientError` later.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[sj-hub]", error);
  }, [error]);

  return (
    <main>
      <section className="login-panel">
        <div className="pill">Something went wrong</div>
        <h1>This page hit an error.</h1>
        <p className="muted">
          Try again in a moment. If it keeps happening, the sync pipeline or the
          snapshot store may be down — check <code>/api/health</code>.
        </p>
        <div className="cta-row">
          <button className="button" type="button" onClick={() => reset()}>
            Try again
          </button>
        </div>
        {error.digest ? (
          <p className="muted" style={{ marginTop: "1rem", fontSize: "0.85rem" }}>
            Ref {error.digest}
          </p>
        ) : null}
      </section>
    </main>
  );
}
