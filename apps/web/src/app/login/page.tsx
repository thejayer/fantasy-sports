import { redirect } from "next/navigation";
import { auth, signIn } from "@/auth";

type Props = {
  searchParams: Promise<{ callbackUrl?: string; error?: string }>;
};

export default async function LoginPage({ searchParams }: Props) {
  const session = await auth();
  const { callbackUrl = "/", error } = await searchParams;

  if (process.env.AUTH_DEV_BYPASS === "1") {
    redirect(callbackUrl);
  }

  if (session?.user) {
    redirect(callbackUrl);
  }

  return (
    <main className="login-page">
      <div className="login-panel">
        <div className="pill">Members only</div>
        <h1>Strictly Jayers</h1>
        <p className="muted">
          Sign in with a Google account on the Strictly Jayers allowlist to open
          leagues, teams, and players.
        </p>
        {error ? (
          <p className="muted" style={{ color: "var(--ember)" }}>
            Sign-in was denied. Use an allowlisted Google account.
          </p>
        ) : null}
        <form
          action={async () => {
            "use server";
            await signIn("google", { redirectTo: callbackUrl });
          }}
        >
          <button className="button" type="submit" style={{ width: "100%" }}>
            Continue with Google
          </button>
        </form>
      </div>
    </main>
  );
}
