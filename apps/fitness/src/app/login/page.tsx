import { redirect } from "next/navigation";

import { auth, signIn } from "@/auth";
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
  const { communitySiteUrl, fantasyHubUrl } = getFitnessSiteConfig();

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
          <a href={communitySiteUrl}>Community</a>
          <a href={fantasyHubUrl}>Fantasy</a>
          <span aria-current="page">Fitness</span>
        </nav>
      </header>
      <div className="login-panel">
        <p className="login-kicker">Members only</p>
        <h1>Fitness</h1>
        <p className="login-copy">
          Sign in with the same Google account you use for Fantasy. Training
          logs stay on your profile — not a shared browser cache.
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
          <button className="login-button" type="submit">
            Continue with Google
          </button>
        </form>
      </div>
    </main>
  );
}
