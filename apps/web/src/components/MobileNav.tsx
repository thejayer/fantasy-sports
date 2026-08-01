import Link from "next/link";

/**
 * Mobile bottom bar (roadmap 7.5).
 *
 * The header nav sits above ~500px of league chrome, so on a phone it scrolls
 * out of reach immediately. This is a phone-first audience on a desktop layout
 * that reflows; a fixed bar is the minimum fix. Hidden at desktop widths by CSS.
 */
export function MobileNav({
  showAdmin,
  showProfile = false,
}: {
  showAdmin: boolean;
  showProfile?: boolean;
}) {
  return (
    <nav className="mobile-nav" aria-label="Primary">
      <Link href="/">Home</Link>
      <Link href="/leagues">Leagues</Link>
      {showAdmin ? <Link href="/admin">Admin</Link> : null}
      {showProfile ? <Link href="/settings">Profile</Link> : null}
    </nav>
  );
}
