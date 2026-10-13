import { redirect } from "next/navigation";

import { auth, signIn } from "@/auth";
import { GoogleSignInButton } from "@/components/GoogleSignInButton";
import { getSiteConfig } from "@/lib/site";
import { safeCallbackUrl } from "@/lib/safe-redirect";

export const dynamic = "force-dynamic";

type Props = {
  searchParams: Promise<{ callbackUrl?: string; error?: string }>;
};

export default async function LoginPage({ searchParams }: Props) {
  const session = await auth();
  const { callbackUrl: requestedCallbackUrl, error } = await searchParams;
  const callbackUrl = safeCallbackUrl(requestedCallbackUrl);
  const { fantasyHubUrl, fitnessUrl, discordInviteUrl } = getSiteConfig();

  if (process.env.AUTH_DEV_BYPASS === "1") {
    redirect(callbackUrl);
  }

  if (session?.user) {
    redirect(callbackUrl);
  }

  return (
    <main className="login-page">
      <section className="page-hero" aria-label="Sign in">
        <p className="hero-kicker">Members</p>
        <h1>Sign in to Bets</h1>
        <p>
          Same Strictly Jayers Google allowlist as Fantasy and Fitness. The rest
          of the site stays public.
        </p>
      </section>
      <div className="login-panel">
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
        <p className="login-help">
          Not on the list?{" "}
          {discordInviteUrl ? (
            <a href={discordInviteUrl} rel="noopener noreferrer">
              Ask in Discord
            </a>
          ) : (
            <a href={fantasyHubUrl} rel="noopener noreferrer">
              Open Fantasy
            </a>
          )}
          {" · "}
          <a href={fitnessUrl} rel="noopener noreferrer">
            Fitness
          </a>
        </p>
      </div>
    </main>
  );
}
