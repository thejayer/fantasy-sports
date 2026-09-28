/** Shared loading skeleton used by route `loading.tsx` files (roadmap 3.6). */
export function LoadingSkeleton({ label = "Loading" }: { label?: string }) {
  return (
    <main className="section" aria-busy="true" aria-label={label}>
      <div className="skeleton skeleton-kicker" />
      <div className="skeleton skeleton-title" />
      <div className="skeleton skeleton-lede" />
      <div className="skeleton-row">
        <div className="skeleton skeleton-chip" />
        <div className="skeleton skeleton-chip" />
        <div className="skeleton skeleton-chip" />
      </div>
      <div className="skeleton skeleton-panel" />
      <div className="skeleton skeleton-panel short" />
    </main>
  );
}
