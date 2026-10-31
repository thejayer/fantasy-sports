import Link from "next/link";

import { auth, signOut } from "@/auth";
import { SideProfile } from "@/components/SideProfile";
import { getVibeSiteConfig } from "@/lib/site";
import { AppSwitcher } from "@/components/AppSwitcher";

type Props = {
  current: "home" | "history" | "settings";
  children: React.ReactNode;
};

export async function Chrome({ current, children }: Props) {
  const session = await auth().catch(() => null);
  const { communitySiteUrl, fantasyHubUrl, fitnessUrl, vibeUrl } =
    getVibeSiteConfig();
  return (
    <div className="shell">
      <header className="topbar sj-side">
        <Link className="brand brand-mark" href="/">
          Strictly Jayers
        </Link>
        <div className="sj-side-group sj-side-group-apps">
          <p className="sj-side-label">Apps</p>
          <AppSwitcher
            current="vibe"
            hubUrl={fantasyHubUrl}
            betsUrl={`${communitySiteUrl}/bets`}
            fitnessUrl={fitnessUrl}
            vibeUrl={vibeUrl}
          />
        </div>
        <div className="sj-side-group sj-side-desktop-only">
          <p className="sj-side-label">Vibe</p>
          <nav className="sj-side-nav" aria-label="App">
            <Link
              className="sj-side-item"
              href="/"
              aria-current={current === "home" ? "page" : undefined}
            >
              Home
            </Link>
            <Link
              className="sj-side-item"
              href="/leaderboard"
              aria-current={current === "history" ? "page" : undefined}
            >
              History
            </Link>
            <Link
              className="sj-side-item"
              href="/settings"
              aria-current={current === "settings" ? "page" : undefined}
            >
              Settings
            </Link>
          </nav>
        </div>
        <div className="sj-side-foot">
          <SideProfile
            profileUrl={`${communitySiteUrl}/profile`}
            initialUser={session?.user ?? null}
          />
          <form
            action={async () => {
              "use server";
              await signOut({ redirectTo: "/login" });
            }}
          >
            <button className="sj-side-signout" type="submit">
              Sign out
            </button>
          </form>
        </div>
      </header>
      <div>{children}</div>
      <nav className="bottom-nav" aria-label="App sections">
        <Link href="/" aria-current={current === "home" ? "page" : undefined}>
          Home
        </Link>
        <Link
          href="/leaderboard"
          aria-current={current === "history" ? "page" : undefined}
        >
          History
        </Link>
        <Link
          href="/settings"
          aria-current={current === "settings" ? "page" : undefined}
        >
          Settings
        </Link>
      </nav>
      <footer className="login-foot">
        <a href={communitySiteUrl}>Portal</a>
        <a href={fantasyHubUrl}>Fantasy</a>
        <a href={fitnessUrl}>Fitness</a>
        <span aria-current="page">Vibe</span>
      </footer>
    </div>
  );
}
