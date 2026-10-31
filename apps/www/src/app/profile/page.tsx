import type { Metadata } from "next";

import { CasinoStats } from "@/components/CasinoStats";
import { LinkedTeams } from "@/components/LinkedTeams";
import { ModLinks } from "@/components/ModLinks";
import { ProfileShell, type ProfileSection } from "@/components/ProfileShell";
import { SignOutButton } from "@/components/SignOutButton";
import { initialsOf, safeAvatar } from "@/lib/account-menu";
import { isCasinoMod } from "@/lib/profile-mod";
import { requireBetsActor } from "@/lib/session";
import { getSiteConfig } from "@/lib/site";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Profile",
  robots: { index: false, follow: false },
};

export default async function ProfilePage() {
  // Second sign-in check next to the middleware gate: this page never relies on middleware alone.
  const actor = await requireBetsActor("/profile");
  const { fantasyHubUrl, casinoEnabled } = getSiteConfig();
  // Asked of the casino on every request; the casino re-checks on every mod call too.
  const mod = casinoEnabled ? await isCasinoMod() : false;
  const name = actor.name?.trim() || actor.email.split("@")[0] || "Member";
  const image = safeAvatar(actor.image);

  const sections: ProfileSection[] = [
    {
      id: "overview",
      label: "Overview",
      blurb: "You and your account",
      panel: (
        <div className="acct-overview">
          <div className="acct-id">
            <span className="acct-avatar acct-avatar-xl" aria-hidden>
              {image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={image} alt="" referrerPolicy="no-referrer" />
              ) : (
                initialsOf(name) || "SJ"
              )}
            </span>
            <div>
              <p className="acct-id-name">{name}</p>
              <p className="acct-muted">Signed in with Google</p>
            </div>
          </div>
          <p className="acct-lede">
            One sign-in covers Strictly Jayers www, the fantasy hub, fitness and vibe.
          </p>
          <a className="acct-row-link" href={`${fantasyHubUrl}/settings`}>
            <span>
              <strong>Name, avatar and bio</strong>
              <span className="acct-muted">Edit how you show up on the hub</span>
            </span>
            <span aria-hidden>›</span>
          </a>
        </div>
      ),
    },
    ...(casinoEnabled
      ? ([
          {
            id: "linked-teams",
            label: "Linked teams",
            blurb: "Your team in each league",
            panel: <LinkedTeams />,
          },
          {
            id: "casino",
            label: "Casino stats",
            blurb: "Chips, streak and rank",
            panel: <CasinoStats />,
          },
        ] satisfies ProfileSection[])
      : []),
    ...(mod
      ? ([
          {
            id: "mods",
            label: "Mods only",
            blurb: "Review team links",
            panel: <ModLinks />,
          },
        ] satisfies ProfileSection[])
      : []),
    {
      id: "sign-out",
      label: "Sign out",
      blurb: "Leave every Strictly Jayers site",
      danger: true,
      panel: (
        <div className="acct-signout-panel">
          <p className="acct-lede">
            This signs you out of www, the fantasy hub, fitness and vibe on this browser.
          </p>
          <SignOutButton />
        </div>
      ),
    },
  ];

  return (
    <main className="acct-page" id="main">
      <header className="acct-page-head">
        <h1>Profile</h1>
      </header>
      <ProfileShell sections={sections} />
    </main>
  );
}
