import { redirect } from "next/navigation";

import { auth, signIn } from "@/auth";
import { GoogleSignInButton } from "@/components/GoogleSignInButton";
import { getFitnessSiteConfig } from "@/lib/site";
import { safeCallbackUrl } from "@/lib/safe-redirect";

export const dynamic = "force-dynamic";

type Props = {
  searchParams: Promise<{ callbackUrl?: string; error?: string }>;
};

export default async function LoginPage({ searchParams }: Props) {
  const session = await auth();
  const { callbackUrl: requestedCallbackUrl, error } = await searchParams;
  const callbackUrl = safeCallbackUrl(requestedCallbackUrl);
  const { communitySiteUrl, fantasyHubUrl, discordInviteUrl } =
    getFitnessSiteConfig();

  if (process.env.AUTH_DEV_BYPASS === "1") {
    redirect(callbackUrl);
  }

  if (session?.user) {
    redirect(callbackUrl);
  }

  return (
    <main className="login-page">
      <header className="login-brand">
        <a href={communitySiteUrl}>Strictly Jayers</a>
        <nav aria-label="Strictly Jayers">
          <a href={communitySiteUrl}>Portal</a>
          <a href={fantasyHubUrl}>Fantasy</a>
          <span aria-current="page">Fitness</span>
        </nav>
      </header>
      <div className="login-shell">
        <aside className="login-aside" aria-hidden>
          <p className="login-aside-kicker">Training log</p>
          <p className="login-aside-mark">SJ</p>
          <p className="login-aside-copy">
            Same crew. Same Google allowlist. Sessions stay on your profile.
          </p>
        </aside>
        <div className="login-panel">
          <h1>Sign in to Fitness</h1>
          <p className="login-copy">
            Use the same Strictly Jayers Google allowlist — one account across
            Fantasy and Fitness.
          </p>
          {error ? (
            <p className="login-error">
              Sign-in was denied. Use an allowlisted Strictly Jayers Google
              account.
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
              <a href={communitySiteUrl}>Open the portal</a>
            </p>
          )}
        </div>
      </div>
      <footer className="login-foot">
        <a href={communitySiteUrl}>Portal</a>
        <a href={fantasyHubUrl}>Fantasy</a>
        <span aria-current="page">Fitness</span>
      </footer>
    </main>
  );
}
