import type { Metadata } from "next";
import Link from "next/link";

import { AppearanceSettings } from "@/components/AppearanceSettings";
import { ProfileUsernameForm } from "@/components/ProfileUsernameForm";
import { auth, signOut } from "@/auth";
import { getViewer } from "@/lib/viewer";
import { requireSession, devBypassEnabled } from "@/lib/session";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Profile",
  description: "Your Strictly Jayers account and appearance settings.",
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
          <h2>Profile</h2>
          <p className="lede">
            Your public username, account details, and how the hub looks on this
            device.
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
        {email || bypass ? (
          <ProfileUsernameForm
            initialUsername={viewer.displayName}
            googleName={googleName || (bypass ? email : null)}
          />
        ) : (
          <p className="league-meta">Sign in to set a username.</p>
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
          Saved on this browser only — not synced across devices.
        </p>
        <AppearanceSettings />
      </section>

      {!bypass ? (
        <form
          action={async () => {
            "use server";
            await signOut({ redirectTo: "/login" });
          }}
        >
          <button className="button secondary" type="submit">
            Sign out
          </button>
        </form>
      ) : null}
    </main>
  );
}
