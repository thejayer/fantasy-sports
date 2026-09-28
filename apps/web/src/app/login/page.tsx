import { redirect } from "next/navigation";

import { auth, signIn } from "@/auth";
import { GoogleSignInButton } from "@/components/GoogleSignInButton";
import { safeCallbackUrl } from "@/lib/safe-redirect";
import { getHubSiteConfig } from "@/lib/site";

type Props = {
  searchParams: Promise<{ callbackUrl?: string; error?: string }>;
};

export default async function LoginPage({ searchParams }: Props) {
  const session = await auth();
  const { callbackUrl: requestedCallbackUrl, error } = await searchParams;
  // Attacker-controlled: never hand this to redirect() or signIn() unlaundered.
  const callbackUrl = safeCallbackUrl(requestedCallbackUrl);
  const { communitySiteUrl, fitnessUrl, discordInviteUrl } = getHubSiteConfig();

  if (process.env.AUTH_DEV_BYPASS === "1") {
    redirect(callbackUrl);
  }

  if (session?.user) {
    redirect(callbackUrl);
  }

  return (
    <main className="login-page">
      <header className="login-brand">
        <a href={communitySiteUrl} rel="noopener noreferrer">
          Strictly Jayers
        </a>
        <nav aria-label="Strictly Jayers">
          <a href={communitySiteUrl} rel="noopener noreferrer">
            Portal
          </a>
          <span aria-current="page">Fantasy</span>
          <a href={fitnessUrl} rel="noopener noreferrer">
            Fitness
          </a>
        </nav>
      </header>

      <div className="login-shell">
        <aside className="login-aside" aria-hidden>
          <p className="login-aside-kicker">Fantasy hub</p>
          <p className="login-aside-mark">SJ</p>
          <p className="login-aside-copy">
            Same crew. Same Google allowlist. Leagues, tools, and the feed.
          </p>
        </aside>
        <div className="login-panel">
          <h1>Sign in to Fantasy</h1>
          <p className="login-copy">
            Use the same Strictly Jayers Google allowlist — one account across
            Fantasy and Fitness.
          </p>
          {error ? (
            <p className="login-error">
              Sign-in was denied. Use an allowlisted Google account.
            </p>
          ) : null}
          <form
            action={async () => {
              "use server";
              await signIn("google", { redirectTo: callbackUrl });
            }}
          >
            <GoogleSignInButton />
          </form>
          {discordInviteUrl ? (
            <p className="login-help">
              Not on the list?{" "}
              <a href={discordInviteUrl} rel="noopener noreferrer">
                Ask in Discord
              </a>
            </p>
          ) : (
            <p className="login-help">
              Not on the list?{" "}
              <a href={communitySiteUrl} rel="noopener noreferrer">
                Open the portal
              </a>
            </p>
          )}
        </div>
      </div>

      <footer className="login-foot">
        <a href={communitySiteUrl} rel="noopener noreferrer">
          Portal
        </a>
        <span aria-current="page">Fantasy</span>
        <a href={fitnessUrl} rel="noopener noreferrer">
          Fitness
        </a>
      </footer>
    </main>
  );
}
