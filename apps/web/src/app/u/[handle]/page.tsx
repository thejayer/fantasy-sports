import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { EmptyState } from "@/components/EmptyState";
import { MemberAvatar } from "@/components/MemberAvatar";
import {
  getLeagueHistoryArchive,
  getLeagueIndex,
  getLatestLeagues,
} from "@/lib/data";
import { readFeed } from "@/lib/feed-store";
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
import {
  collectMemberFeedActivity,
  formatActivityWhen,
  profileTrophyChips,
} from "@/lib/member-profile";
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
  const latest = await getLatestLeagues();
  const leagueNameById = new Map(
    index.map((row) => [row.league_id, row.name] as const),
  );
  const latestSeasonById = new Map(
    latest.map((row) => [row.league_id, row.season] as const),
  );

  const careers = await Promise.all(
    member.teams.map(async (link) => {
      const archive = await getLeagueHistoryArchive(link.league_id);
      const career = archive
        ? franchiseCareer(archive, link.team_id)
        : null;
      const season =
        latestSeasonById.get(link.league_id) ??
        archive?.seasons[archive.seasons.length - 1]?.season ??
        new Date().getFullYear();
      const leagueName =
        link.league_name ||
        leagueNameById.get(link.league_id) ||
        link.league_id;
      return { link, career, season, leagueName };
    }),
  );

  const trophyChips = profileTrophyChips(careers);

  const feedInputs = await Promise.all(
    member.teams.map(async (link) => {
      const season =
        latestSeasonById.get(link.league_id) ?? new Date().getFullYear();
      const feed = await readFeed(link.league_id, season);
      return {
        feed,
        leagueName:
          link.league_name ||
          leagueNameById.get(link.league_id) ||
          link.league_id,
      };
    }),
  );
  const activity = collectMemberFeedActivity(feedInputs, member.email, {
    limit: 8,
  });

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

      {trophyChips.length ? (
        <section
          className="profile-section"
          aria-labelledby="trophies-heading"
        >
          <h3 id="trophies-heading" className="roster-group-title">
            Trophy shelf
          </h3>
          <p className="league-meta" style={{ marginTop: 0 }}>
            Regular-season #1 finishes — open the league trophy case for the
            full shelf.
          </p>
          <div className="stat-chips profile-trophy-chips">
            {trophyChips.map((chip) => (
              <Link
                key={chip.leagueId}
                href={chip.href}
                className="stat-chip profile-trophy-chip"
              >
                <span className="profile-trophy-label">{chip.label}</span>
                <span className="profile-trophy-detail">{chip.detail}</span>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

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
            {careers.map(({ link, career, leagueName }) => {
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
                      {career.totals.playoffChampionships
                        ? ` · ${career.totals.playoffChampionships}× title${career.totals.playoffChampionships === 1 ? "" : "s"}`
                        : ""}
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

      <section
        className="panel profile-section"
        aria-labelledby="activity-heading"
      >
        <h3 id="activity-heading" className="roster-group-title">
          Recent activity
        </h3>
        {!activity.length ? (
          <EmptyState title="No feed activity yet">
            Comments, polls, and reactions from league feeds show up here.
          </EmptyState>
        ) : (
          <ul className="profile-activity-list">
            {activity.map((item) => (
              <li key={item.id}>
                <Link href={item.href} className="profile-activity-row">
                  <div className="profile-activity-meta">
                    <span>{item.title}</span>
                    <span>
                      {item.leagueName}
                      {formatActivityWhen(item.createdAt)
                        ? ` · ${formatActivityWhen(item.createdAt)}`
                        : ""}
                    </span>
                  </div>
                  {item.body ? (
                    <p className="profile-activity-body">{item.body}</p>
                  ) : null}
                </Link>
              </li>
            ))}
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
