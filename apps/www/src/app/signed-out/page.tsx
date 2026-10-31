import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Signed out",
  robots: { index: false, follow: false },
};

export default function SignedOutPage() {
  return (
    <main className="acct-page acct-signed-out" id="main">
      <h1>Signed out of all Strictly Jayers sites</h1>
      <p>Your session is cleared on www, the fantasy hub, fitness and vibe on this browser.</p>
      <div className="acct-actions">
        <Link className="acct-btn acct-btn-primary" href="/login?callbackUrl=/">
          Sign in again
        </Link>
        <Link className="acct-btn" href="/">
          Home
        </Link>
      </div>
    </main>
  );
}
