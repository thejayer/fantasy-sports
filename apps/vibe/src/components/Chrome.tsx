import Link from "next/link";

import { signOut } from "@/auth";
import { getVibeSiteConfig } from "@/lib/site";
import { AppSwitcher } from "../../../../packages/sj-ui/app-switcher";

type Props = {
  current: "home" | "history" | "settings";
  children: React.ReactNode;
};

export function Chrome({ current, children }: Props) {
  const { communitySiteUrl, fantasyHubUrl, fitnessUrl, vibeUrl } =
    getVibeSiteConfig();
  return (
    <div className="shell">
      <header className="topbar">
        <Link className="brand" href="/">
          Vibe Split <small>SJ</small>
        </Link>
        <AppSwitcher
          current="vibe"
          hubUrl={fantasyHubUrl}
          betsUrl={`${communitySiteUrl}/bets`}
          fitnessUrl={fitnessUrl}
          vibeUrl={vibeUrl}
        />
        <nav className="top-nav" aria-label="App">
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
          <form
            action={async () => {
              "use server";
              await signOut({ redirectTo: "/login" });
            }}
          >
            <button type="submit">Sign out</button>
          </form>
        </nav>
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
