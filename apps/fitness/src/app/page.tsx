/**
 * Fallback if the `/` → `/app.html` rewrite is skipped. The live fitness
 * host serves the PWA document from middleware.
 */
export default function FitnessFallbackPage() {
  return (
    <main>
      <p>
        <a href="/app.html">Open Fitness</a>
      </p>
    </main>
  );
}
