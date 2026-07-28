import Link from "next/link";

export default function NotFound() {
  return (
    <main>
      <section className="state-panel">
        <Link href="/" className="brand-mark state-brand">
          Strictly Jayers
        </Link>
        <div className="pill">Not found</div>
        <h1>That page is not here.</h1>
        <p className="muted">
          It may have moved, the season is missing from the snapshot store, or
          the link is wrong.
        </p>
        <div className="cta-row">
          <Link className="button" href="/">
            Home
          </Link>
          <Link className="button secondary" href="/leagues">
            Leagues
          </Link>
        </div>
      </section>
    </main>
  );
}
