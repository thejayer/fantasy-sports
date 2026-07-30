import Link from "next/link";

/**
 * League tab strip (roadmap 7.5).
 *
 * Ten same-shaped lowercase pills in one row was most of a mobile viewport and
 * gave nothing visual priority. This shows the tabs members use every visit and
 * files the rest behind a disclosure, with real labels instead of route slugs.
 * `<details>` keeps `LeagueView` a server component.
 */

export type LeagueTab = {
  id: string;
  label: string;
  href: string;
};

/** Tabs worth a permanent slot; everything else goes to the overflow. */
const PRIMARY = new Set([
  "standings",
  "matchups",
  "teams",
  "players",
  "activity",
  "tools",
  "lineup",
  "scoreboard",
  "schedule",
]);

const LABELS: Record<string, string> = {
  standings: "Standings",
  teams: "Teams",
  players: "Players",
  matchups: "Matchups",
  draft: "Draft",
  activity: "Feed",
  waivers: "Waivers",
  history: "History",
  projections: "Projections",
  tools: "Tools",
  settings: "Settings",
  schedule: "Schedule",
  lineup: "Lineup",
  scoreboard: "Scoreboard",
  auction: "Auction",
};

export function tabLabel(id: string): string {
  return LABELS[id] ?? id.charAt(0).toUpperCase() + id.slice(1);
}

/**
 * Split tabs into the visible row and the overflow. The active tab is always
 * visible — an overflow tab that is currently open would otherwise look
 * unselected.
 */
export function splitTabs(
  tabs: LeagueTab[],
  active: string,
): { shown: LeagueTab[]; hidden: LeagueTab[] } {
  const shown: LeagueTab[] = [];
  const hidden: LeagueTab[] = [];
  for (const tab of tabs) {
    if (PRIMARY.has(tab.id) || tab.id === active) shown.push(tab);
    else hidden.push(tab);
  }
  return { shown, hidden };
}

export function LeagueTabs({
  tabs,
  active,
}: {
  tabs: LeagueTab[];
  active: string;
}) {
  const { shown, hidden } = splitTabs(tabs, active);
  return (
    <nav className="tabs league-tabs" aria-label="League sections">
      {shown.map((tab) => (
        <Link
          key={tab.id}
          href={tab.href}
          className={`tab${active === tab.id ? " active" : ""}`}
          aria-current={active === tab.id ? "page" : undefined}
        >
          {tab.label}
        </Link>
      ))}
      {hidden.length ? (
        <details className="chip-overflow">
          <summary className="tab">More</summary>
          <div className="chip-overflow-menu">
            {hidden.map((tab) => (
              <Link key={tab.id} href={tab.href} className="tab">
                {tab.label}
              </Link>
            ))}
          </div>
        </details>
      ) : null}
    </nav>
  );
}
