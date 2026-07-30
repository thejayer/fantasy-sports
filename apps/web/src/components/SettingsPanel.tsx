import { EmptyState } from "@/components/EmptyState";
import type { LeagueSnapshot } from "@/lib/data";
import { espnSettingsUrl } from "@/lib/espn-links";
import {
  hasEspnSettings,
  keeperFacts,
  settingsGroups,
} from "@/lib/league-settings";

/** Read-only view of the synced ESPN settings concern (roadmap 7.9). */
export function SettingsPanel({ league }: { league: LeagueSnapshot }) {
  const groups = settingsGroups(league);
  const keepers = keeperFacts(league);
  const espnUrl = espnSettingsUrl({
    sport: league.sport,
    espnLeagueId: league.espn_league_id,
    season: league.season,
  });

  // The "League" group comes from the manifest, so check the settings concern
  // itself rather than whether anything rendered.
  if (!hasEspnSettings(league)) {
    return (
      <EmptyState title="No settings in this snapshot">
        <code>settings.json</code> arrived with the roadmap 2.4 sync slice — this
        season predates it. Re-sync the season to populate roster slots, scoring,
        FAAB, keepers, and playoff structure.
      </EmptyState>
    );
  }

  return (
    <div className="settings-panel">
      <p className="lede">
        As ESPN reports them for {league.season}. The hub is read-only against
        ESPN — change settings there and the next sync picks them up.
      </p>

      {keepers.mismatch ? (
        <p className="muted">
          The registry declares this league <code>dynasty</code>, but ESPN
          reports no keeper slots for {league.season}. Keeper behaviour follows
          ESPN, not <code>configs/leagues.yaml</code>.
        </p>
      ) : null}

      <div className="settings-groups">
        {groups.map((group) => (
          <section key={group.title} className="panel">
            <h3 className="roster-group-title" style={{ padding: "0.85rem 1rem 0" }}>
              {group.title}
            </h3>
            <dl className="settings-grid">
              {group.rows.map((row) => (
                <div key={`${group.title}-${row.label}`} className="settings-row">
                  <dt>{row.label}</dt>
                  <dd>{row.value}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>

      {espnUrl ? (
        <p className="muted">
          <a href={espnUrl} rel="noreferrer noopener" target="_blank">
            Edit on ESPN ↗
          </a>{" "}
          — commissioner tools live there, not here.
        </p>
      ) : null}
    </div>
  );
}
