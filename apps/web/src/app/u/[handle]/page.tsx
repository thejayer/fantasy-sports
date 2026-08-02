import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { EmptyState } from "@/components/EmptyState";
import { MemberAvatar } from "@/components/MemberAvatar";
import { getLeagueHistoryArchive, getLeagueIndex } from "@/lib/data";
import {
  findMemberByHandle,
  memberProfileHandle,
  resolveMemberDisplayName,
  slugifyProfileHandle,
} from "@/lib/hub-members";
import { readHubMembers } from "@/lib/hub-members-store";
import {
  formatPoints,
  formatWinPct,
  franchiseCareer,
  recordLabelFromCounts,
} from "@/lib/history";
import { getViewer } from "@/lib/viewer";
import { requireSession, devBypassEnabled } from "@/lib/session";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ handle: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { handle } = await params;
  const file = await readHubMembers().catch(() => null);
  const member = findMemberByHandle(file, handle);
  const name = member
    ? resolveMemberDisplayName(member, memberProfileHandle(member))
    : slugifyProfileHandle(handle);
  return {
    title: name,
    description: `${name}'s Strictly Jayers profile`,
  };
}

export default async function MemberProfilePage({ params }: Props) {
  const bypass = devBypassEnabled();
  if (!bypass) await requireSession();

  const { handle: rawHandle } = await params;
  const file = await readHubMembers().catch(() => null);
  const member = findMemberByHandle(file, rawHandle);
  if (!member) notFound();

  const handle = memberProfileHandle(member);
  const displayName = resolveMemberDisplayName(member, handle);
  const viewer = await getViewer();
  const isSelf =
    viewer.email != null &&
    viewer.email.toLowerCase() === member.email.toLowerCase();

  const index = await getLeagueIndex();
  const leagueNameById = new Map(
    index.map((row) => [row.league_id, row.name] as const),
  );

  const careers = await Promise.all(
    member.teams.map(async (link) => {
      const archive = await getLeagueHistoryArchive(link.league_id);
      const career = archive
        ? franchiseCareer(archive, link.team_id)
        : null;
      return { link, career };
    }),
  );

  return (
    <main className="section profile-public">
      <div className="section-head">
        <div className="profile-public-hero">
          <MemberAvatar
            name={displayName}
            imageUrl={member.image_url}
            size="lg"
          />
          <div>
            <h2>{displayName}</h2>
            <p className="lede" style={{ marginBottom: 0 }}>
              @{handle}
              {member.role === "admin" ? " · Admin" : ""}
              {isSelf ? " · This is you" : ""}
            </p>
          </div>
        </div>
        <div className="cta-row">
          {isSelf ? (
            <Link className="button secondary" href="/settings">
              Edit profile
            </Link>
          ) : null}
          <Link className="button secondary" href="/">
            ← Home
          </Link>
        </div>
      </div>

      <section className="panel profile-section" aria-labelledby="franchises-heading">
        <h3 id="franchises-heading" className="roster-group-title">
          Franchises
        </h3>
        {!member.teams.length ? (
          <EmptyState title="No franchises linked">
            An admin can connect this member to a team in each league.
          </EmptyState>
        ) : (
          <ul className="profile-franchises profile-franchise-cards">
            {careers.map(({ link, career }) => {
              const leagueName =
                link.league_name ||
                leagueNameById.get(link.league_id) ||
                link.league_id;
              const teamName =
                career?.name || link.team_name || `Team #${link.team_id}`;
              return (
                <li key={link.league_id}>
                  <Link href={`/leagues/${link.league_id}`}>{leagueName}</Link>
                  <span className="league-meta">
                    {" · "}
                    <Link
                      href={`/leagues/${link.league_id}/teams/${link.team_id}`}
                    >
                      {teamName}
                    </Link>
                  </span>
                  {career?.totals ? (
                    <div className="league-meta profile-career-line">
                      {career.seasons.length} season
                      {career.seasons.length === 1 ? "" : "s"} ·{" "}
                      {recordLabelFromCounts(
                        career.totals.wins,
                        career.totals.losses,
                        career.totals.ties,
                      )}{" "}
                      ({formatWinPct(career.totals.winPct)})
                      {career.totals.championships
                        ? ` · ${career.totals.championships}× #1`
                        : ""}
                      {career.totals.pointsFor > 0
                        ? ` · ${formatPoints(career.totals.pointsFor)} PF`
                        : ""}
                    </div>
                  ) : career ? (
                    <div className="league-meta profile-career-line">
                      {career.seasons.length} season
                      {career.seasons.length === 1 ? "" : "s"} on disk
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <p className="league-meta">
        Username and photo sync from Profile settings. Trophy depth grows when
        past seasons are backfilled into the league history archive.
      </p>
    </main>
  );
}
