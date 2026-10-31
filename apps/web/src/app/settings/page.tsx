import type { Metadata } from "next";
import Link from "next/link";

import { AppearanceSettings } from "@/components/AppearanceSettings";
import { MemberAvatar } from "@/components/MemberAvatar";
import { ProfileAvatarForm } from "@/components/ProfileAvatarForm";
import { ProfileBioForm } from "@/components/ProfileBioForm";
import { ProfileUsernameForm } from "@/components/ProfileUsernameForm";
import { auth } from "@/auth";
import { SignOutButton } from "@/components/SignOutDialog";
import { getViewer } from "@/lib/viewer";
import { requireSession, devBypassEnabled } from "@/lib/session";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Profile",
  description: "Profile & settings for every Strictly Jayers app.",
};

export default async function SettingsPage() {
  const bypass = devBypassEnabled();
  if (!bypass) await requireSession();

  const viewer = await getViewer();
  const session = bypass ? null : await auth();
  const googleName = session?.user?.name ?? null;
  const email = viewer.email;

  return (
    <main className="section profile-settings">
      <div className="section-head">
        <div>
          <h2>Profile &amp; settings</h2>
          <p className="lede">
            One page for every Strictly Jayers app — Hub, Bets, Fitness, and
            Vibe. Your name, avatar, and bio are saved to your member profile;
            theme applies across all four sites on this browser.
          </p>
        </div>
        <Link className="button secondary" href="/">
          ← Home
        </Link>
      </div>

      <section className="panel profile-section" aria-labelledby="account-heading">
        <h3 id="account-heading" className="roster-group-title">
          Account
        </h3>
        <div className="profile-avatar-row">
          <MemberAvatar
            name={viewer.name || googleName || email || "Member"}
            imageUrl={viewer.imageUrl}
            size="lg"
          />
          <div>
            <p className="league-meta" style={{ margin: 0 }}>
              {viewer.avatarOverride
                ? "Custom avatar — shown across the apps and in the feed."
                : viewer.imageUrl
                  ? "Photo from your Google account — set a custom avatar below."
                  : "Sign in with Google, or set a custom avatar below."}
            </p>
            {viewer.handle ? (
              <p className="league-meta" style={{ margin: "0.35rem 0 0" }}>
                Public page:{" "}
                <Link href={`/u/${viewer.handle}`}>/u/{viewer.handle}</Link>
                {!viewer.displayName ? (
                  <> — set a username below so the slug is yours, not your email prefix.</>
                ) : null}
              </p>
            ) : null}
          </div>
        </div>
        {email || bypass ? (
          <>
            <ProfileUsernameForm
              initialUsername={viewer.displayName}
              googleName={googleName || (bypass ? email : null)}
            />
            <ProfileAvatarForm initialUrl={viewer.avatarOverride} />
            <ProfileBioForm initialBio={viewer.bio} />
          </>
        ) : (
          <p className="league-meta">Sign in to set a username and bio.</p>
        )}
        <dl className="profile-identity">
          {email ? (
            <div>
              <dt>Email</dt>
              <dd>{email}</dd>
            </div>
          ) : (
            <div>
              <dt>Email</dt>
              <dd className="muted">
                {bypass ? "Dev bypass (set SJ_DEV_VIEWER_EMAIL to edit)" : "—"}
              </dd>
            </div>
          )}
          {googleName ? (
            <div>
              <dt>Google name</dt>
              <dd>{googleName}</dd>
            </div>
          ) : null}
        </dl>
        {viewer.franchises.length ? (
          <>
            <p className="league-meta profile-franchise-lede">
              Linked franchises
              {viewer.isAdmin ? (
                <>
                  {" — "}
                  <Link href="/admin">edit in Admin</Link>
                </>
              ) : null}
            </p>
            <ul className="profile-franchises">
              {viewer.franchises.map((f) => (
                <li key={f.league_id}>
                  <Link href={`/leagues/${f.league_id}`}>
                    {f.league_name || f.league_id}
                  </Link>
                  <span className="league-meta">
                    {" · "}
                    {f.team_name || `Team #${f.team_id}`}
                  </span>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="league-meta">
            {viewer.isAdmin ? (
              <>
                No franchise linked yet —{" "}
                <Link href="/admin">link one in Admin</Link>.
              </>
            ) : (
              "No franchise linked yet. Ask an admin to connect your email to a team."
            )}
          </p>
        )}
      </section>

      <section
        className="panel profile-section"
        aria-labelledby="appearance-heading"
      >
        <h3 id="appearance-heading" className="roster-group-title">
          Appearance
        </h3>
        <p className="league-meta" style={{ marginTop: 0 }}>
          Saved on this browser for all four Strictly Jayers sites — not synced
          across devices.
        </p>
        <AppearanceSettings />
      </section>

      {!bypass ? (
        <SignOutButton
          action="/api/auth/signout-all"
          className="button secondary"
        />
      ) : null}
    </main>
  );
}
