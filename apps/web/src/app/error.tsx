"use client";

import Link from "next/link";
import { useEffect } from "react";

/**
 * Route-level error boundary. Cloud Run already ships stderr to Cloud Logging;
 * logging the error here is enough for Error Reporting to pick it up without a
 * third-party SDK. Corrupt snapshots throw here instead of looking "missing"
 * (roadmap 3.6).
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

  const corrupt = error.name === "CorruptSnapshotError";

  return (
    <main>
      <section className="state-panel">
        <Link href="/" className="brand-mark state-brand">
          Strictly Jayers
        </Link>
        <div className="pill">{corrupt ? "Corrupt snapshot" : "Something went wrong"}</div>
        <h1>{corrupt ? "This league data could not be read." : "This page hit an error."}</h1>
        <p className="muted">
          {corrupt
            ? "A snapshot on disk looks damaged. Re-run sync or seed, then try again."
            : "Try again in a moment. If it keeps happening, the sync pipeline or the snapshot store may be down — check /api/health."}
        </p>
        <div className="cta-row">
          <button className="button" type="button" onClick={() => reset()}>
            Try again
          </button>
          <Link className="button secondary" href="/leagues">
            Leagues
          </Link>
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
