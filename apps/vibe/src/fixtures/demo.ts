import { zonedLocalToUtc, zonedParts } from "@/lib/timezone";
import type {
  AgentRun,
  CodingEvent,
  VibeDocument,
  Workout,
} from "@/lib/vibe-document";
import { emptyVibeDocument } from "@/lib/vibe-document";

const TZ = "America/Chicago";
const REPO = "thejayer/fantasy-sports-analytics";

function at(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
): string {
  return zonedLocalToUtc(TZ, year, month, day, hour, minute, 0).toISOString();
}

function workout(
  partial: Omit<Workout, "source" | "source_id" | "distance_m" | "avg_hr" | "max_hr" | "active_energy_kcal"> &
    Partial<Pick<Workout, "distance_m" | "avg_hr" | "max_hr" | "active_energy_kcal">>,
): Workout {
  return {
    source: "health_auto_export",
    source_id: partial.id,
    distance_m: null,
    avg_hr: 136,
    max_hr: 168,
    active_energy_kcal: 380,
    ...partial,
  };
}

function commit(
  id: string,
  iso: string,
  message: string,
  sha: string,
  additions: number,
  deletions: number,
): CodingEvent {
  return {
    id: `gh:commit:${id}`,
    kind: "commit",
    at: iso,
    repo: REPO,
    title: message,
    url: `https://github.com/${REPO}/commit/${sha}`,
    additions,
    deletions,
    sha,
  };
}

/**
 * Realistic Austin-shaped fixture keyed off `now` so "this week" is never
 * empty in local / Playwright / screenshot runs.
 */
export function buildDemoDocument(
  email: string,
  now = new Date(),
): VibeDocument {
  const z = zonedParts(now, TZ);
  const y = z.year;
  const m = z.month;
  const d = z.day;
  const weekday = z.weekday;
  const sunday = d - weekday;

  const mon = sunday + 1;
  const wed = sunday + 3;
  const fri = sunday + 5;
  const lastSat = sunday - 1;
  const lastWed = sunday - 4;
  const twoFri = sunday - 9;

  const workouts: Workout[] = [
    workout({
      id: "w-mon",
      name: "Traditional Strength Training",
      type: "Traditional Strength Training",
      start: at(y, m, mon, 6, 2),
      end: at(y, m, mon, 7, 18),
      duration_sec: 76 * 60,
      active_energy_kcal: 428,
      avg_hr: 141,
      max_hr: 174,
    }),
    workout({
      id: "w-wed",
      name: "Indoor Cycle",
      type: "Indoor Cycle",
      start: at(y, m, wed, 6, 5),
      end: at(y, m, wed, 6, 52),
      duration_sec: 47 * 60,
      active_energy_kcal: 390,
      avg_hr: 148,
      max_hr: 171,
    }),
    workout({
      id: "w-fri",
      name: "Functional Strength Training",
      type: "Functional Strength Training",
      start: at(y, m, fri, 5, 48),
      end: at(y, m, fri, 7, 4),
      duration_sec: 76 * 60,
      active_energy_kcal: 451,
      avg_hr: 139,
      max_hr: 169,
    }),
    workout({
      id: "w-last-sat",
      name: "Traditional Strength Training",
      type: "Traditional Strength Training",
      start: at(y, m, lastSat, 8, 10),
      end: at(y, m, lastSat, 9, 40),
      duration_sec: 90 * 60,
      active_energy_kcal: 512,
      avg_hr: 144,
      max_hr: 178,
    }),
    workout({
      id: "w-last-wed",
      name: "Traditional Strength Training",
      type: "Traditional Strength Training",
      start: at(y, m, lastWed, 6, 0),
      end: at(y, m, lastWed, 7, 5),
      duration_sec: 65 * 60,
      active_energy_kcal: 360,
    }),
    workout({
      id: "w-legend",
      name: "Traditional Strength Training",
      type: "Traditional Strength Training",
      start: at(y, m, twoFri, 5, 30),
      end: at(y, m, twoFri, 7, 45),
      duration_sec: 135 * 60,
      active_energy_kcal: 610,
      avg_hr: 146,
      max_hr: 181,
    }),
  ];

  const events: CodingEvent[] = [
    commit(
      "mon-1",
      at(y, m, mon, 6, 22),
      "fix(hub): keep SeasonSwitcher team URLs under /teams",
      "a1b2c3d4e5f6",
      48,
      12,
    ),
    commit(
      "mon-2",
      at(y, m, mon, 6, 41),
      "test(web): cover hockey group labels on Waivers",
      "b2c3d4e5f607",
      86,
      4,
    ),
    commit(
      "mon-3",
      at(y, m, mon, 7, 8),
      "docs: note FUSE mkdir hang on Cloud Run entrypoint",
      "c3d4e5f60718",
      21,
      3,
    ),
    {
      id: "gh:pr_opened:mon",
      kind: "pr_opened",
      at: at(y, m, mon, 7, 11),
      repo: REPO,
      title: "Hockey group labels on Waivers",
      url: `https://github.com/${REPO}/pull/142`,
      additions: null,
      deletions: null,
      sha: null,
    },
    commit(
      "wed-1",
      at(y, m, wed, 6, 19),
      "chore(ci): bump Playwright browsers cache key",
      "d4e5f6071829",
      6,
      2,
    ),
    commit(
      "fri-1",
      at(y, m, fri, 6, 4),
      "feat(vibe): overlap buffer around workout windows",
      "e5f60718293a",
      214,
      18,
    ),
    commit(
      "fri-2",
      at(y, m, fri, 6, 27),
      "feat(vibe): Health Auto Export ingest token",
      "f60718293a4b",
      133,
      9,
    ),
    commit(
      "fri-3",
      at(y, m, fri, 6, 49),
      "test(vibe): DST midnight workout fixtures",
      "0718293a4b5c",
      97,
      5,
    ),
    {
      id: "gh:pr_opened:fri",
      kind: "pr_opened",
      at: at(y, m, fri, 6, 58),
      repo: REPO,
      title: "Vibe Split overlap model",
      url: `https://github.com/${REPO}/pull/168`,
      additions: null,
      deletions: null,
      sha: null,
    },
    {
      id: "gh:review:fri",
      kind: "review",
      at: at(y, m, fri, 7, 2),
      repo: REPO,
      title: "Review approved",
      url: `https://github.com/${REPO}/pull/161#pullrequestreview-1`,
      additions: null,
      deletions: null,
      sha: null,
    },
    commit(
      "sat-1",
      at(y, m, lastSat, 8, 28),
      "fix(sync): retry ESPN 5xx with backoff",
      "18293a4b5c6d",
      41,
      11,
    ),
    commit(
      "sat-2",
      at(y, m, lastSat, 8, 55),
      "feat(hub): Hall of Shame claimed-after note",
      "293a4b5c6d7e",
      77,
      14,
    ),
    {
      id: "gh:pr_merged:sat",
      kind: "pr_merged",
      at: at(y, m, lastSat, 9, 12),
      repo: REPO,
      title: "Hall of Shame claimed-after",
      url: `https://github.com/${REPO}/pull/155`,
      additions: null,
      deletions: null,
      sha: null,
    },
    commit(
      "legend-1",
      at(y, m, twoFri, 5, 44),
      "feat(nhl): Daily Faceoff line parser",
      "3a4b5c6d7e8f",
      340,
      22,
    ),
    commit(
      "legend-2",
      at(y, m, twoFri, 6, 12),
      "feat(nhl): starting goalies for +2 days",
      "4b5c6d7e8f90",
      188,
      7,
    ),
    commit(
      "legend-3",
      at(y, m, twoFri, 6, 38),
      "test(nhl): SampleDfo fixture through live parsers",
      "5c6d7e8f9012",
      256,
      13,
    ),
    commit(
      "legend-4",
      at(y, m, twoFri, 7, 5),
      "feat(hub): Role / PP / Linemates on roster",
      "6d7e8f901234",
      129,
      16,
    ),
    commit(
      "legend-5",
      at(y, m, twoFri, 7, 28),
      "docs: H4 Daily Faceoff afternoon refresh",
      "7e8f90123456",
      64,
      2,
    ),
    {
      id: "gh:pr_opened:legend",
      kind: "pr_opened",
      at: at(y, m, twoFri, 7, 31),
      repo: REPO,
      title: "H4 Daily Faceoff lines",
      url: `https://github.com/${REPO}/pull/118`,
      additions: null,
      deletions: null,
      sha: null,
    },
    {
      id: "gh:pr_merged:legend",
      kind: "pr_merged",
      at: at(y, m, twoFri, 7, 40),
      repo: REPO,
      title: "H4 Daily Faceoff lines",
      url: `https://github.com/${REPO}/pull/118`,
      additions: null,
      deletions: null,
      sha: null,
    },
    {
      id: "gh:comment:legend",
      kind: "comment",
      at: at(y, m, twoFri, 7, 22),
      repo: REPO,
      title: "Need the DFO throttle at 2s",
      url: `https://github.com/${REPO}/pull/118#discussion_r1`,
      additions: null,
      deletions: null,
      sha: null,
    },
    commit(
      "last-wed-1",
      at(y, m, lastWed, 6, 18),
      "refactor(sj): share attach_baseball_roster_limits",
      "8f9012345678",
      55,
      40,
    ),
  ];

  const agent_runs: AgentRun[] = [
    {
      id: "agent:fri-cloud",
      start: at(y, m, fri, 6, 10),
      end: at(y, m, fri, 6, 55),
      label: "cursor cloud · vibe overlap",
      source: "ingest",
    },
    {
      id: "agent:legend",
      start: at(y, m, twoFri, 5, 50),
      end: at(y, m, twoFri, 6, 40),
      label: "cursor cloud · nhl lines",
      source: "csv",
    },
  ];

  const base = emptyVibeDocument(email, {
    displayName: "Austin Wiley",
  });
  return {
    ...base,
    settings: { buffer_minutes: 15, timezone: TZ },
    github: {
      login: "thejayer",
      user_id: 1,
      access_token_enc: null,
      token_kind: "pat",
      last_sync_at: now.toISOString(),
      last_sync_error: null,
    },
    workouts,
    events,
    agent_runs,
  };
}
