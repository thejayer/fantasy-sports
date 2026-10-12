import { normalizeEmail } from "@/lib/allowlist";
import { DEFAULT_TIMEZONE, isValidTimeZone } from "@/lib/timezone";

export const SCHEMA_VERSION = 1;
export const DEFAULT_BUFFER_MINUTES = 15;
export const MIN_BUFFER_MINUTES = 0;
export const MAX_BUFFER_MINUTES = 60;

export type WorkoutSource =
  | "health_auto_export"
  | "apple_health"
  | "hevy"
  | "manual";

export type CodingKind =
  | "commit"
  | "push"
  | "pr_opened"
  | "pr_merged"
  | "review"
  | "comment";

export type Workout = {
  id: string;
  source: WorkoutSource;
  source_id: string;
  name: string;
  type: string;
  start: string;
  end: string;
  duration_sec: number;
  active_energy_kcal: number | null;
  distance_m: number | null;
  avg_hr: number | null;
  max_hr: number | null;
};

export type CodingEvent = {
  id: string;
  kind: CodingKind;
  at: string;
  repo: string;
  title: string;
  url: string;
  additions: number | null;
  deletions: number | null;
  sha: string | null;
};

export type AgentRun = {
  id: string;
  start: string;
  end: string;
  label: string | null;
  source: "ingest" | "csv";
};

export type VibeSettings = {
  buffer_minutes: number;
  timezone: string;
};

export type IngestState = {
  token_hash: string | null;
  token_prefix: string | null;
  created_at: string | null;
};

export type GithubState = {
  login: string | null;
  user_id: number | null;
  access_token_enc: string | null;
  token_kind: "oauth" | "pat" | null;
  last_sync_at: string | null;
  last_sync_error: string | null;
};

export type VibeDocument = {
  schema_version: number;
  email: string;
  display_name: string;
  image_url: string | null;
  created_at: string;
  updated_at: string;
  settings: VibeSettings;
  ingest: IngestState;
  github: GithubState;
  workouts: Workout[];
  events: CodingEvent[];
  agent_runs: AgentRun[];
};

function clampBuffer(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return DEFAULT_BUFFER_MINUTES;
  return Math.min(
    MAX_BUFFER_MINUTES,
    Math.max(MIN_BUFFER_MINUTES, Math.round(n)),
  );
}

function optionalNumber(raw: unknown): number | null {
  if (raw == null || raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function optionalString(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  return value || null;
}

const WORKOUT_SOURCES = new Set<WorkoutSource>([
  "health_auto_export",
  "apple_health",
  "hevy",
  "manual",
]);

const CODING_KINDS = new Set<CodingKind>([
  "commit",
  "push",
  "pr_opened",
  "pr_merged",
  "review",
  "comment",
]);

export function normalizeWorkout(raw: unknown): Workout | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const id = optionalString(row.id);
  const source_id = optionalString(row.source_id);
  const start = optionalString(row.start);
  const end = optionalString(row.end);
  if (!id || !source_id || !start || !end) return null;
  const source = WORKOUT_SOURCES.has(row.source as WorkoutSource)
    ? (row.source as WorkoutSource)
    : "manual";
  const name = optionalString(row.name) || "Workout";
  const type = optionalString(row.type) || name;
  const duration = optionalNumber(row.duration_sec);
  const startMs = Date.parse(start);
  const endMs = Date.parse(end);
  const duration_sec =
    duration && duration > 0
      ? Math.round(duration)
      : Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > startMs
        ? Math.round((endMs - startMs) / 1000)
        : 0;
  return {
    id,
    source,
    source_id,
    name,
    type,
    start,
    end,
    duration_sec,
    active_energy_kcal: optionalNumber(row.active_energy_kcal),
    distance_m: optionalNumber(row.distance_m),
    avg_hr: optionalNumber(row.avg_hr),
    max_hr: optionalNumber(row.max_hr),
  };
}

export function normalizeEvent(raw: unknown): CodingEvent | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const id = optionalString(row.id);
  const at = optionalString(row.at);
  if (!id || !at) return null;
  const kind = CODING_KINDS.has(row.kind as CodingKind)
    ? (row.kind as CodingKind)
    : "commit";
  return {
    id,
    kind,
    at,
    repo: optionalString(row.repo) || "unknown",
    title: optionalString(row.title) || kind,
    url: optionalString(row.url) || "",
    additions: optionalNumber(row.additions),
    deletions: optionalNumber(row.deletions),
    sha: optionalString(row.sha),
  };
}

export function normalizeAgentRun(raw: unknown): AgentRun | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const id = optionalString(row.id);
  const start = optionalString(row.start);
  const end = optionalString(row.end);
  if (!id || !start || !end) return null;
  return {
    id,
    start,
    end,
    label: optionalString(row.label),
    source: row.source === "csv" ? "csv" : "ingest",
  };
}

export function emptyVibeDocument(
  email: string,
  opts?: { displayName?: string | null; imageUrl?: string | null },
): VibeDocument {
  const now = new Date().toISOString();
  return {
    schema_version: SCHEMA_VERSION,
    email: normalizeEmail(email),
    display_name: opts?.displayName?.trim() || email.split("@")[0] || "Member",
    image_url: opts?.imageUrl ?? null,
    created_at: now,
    updated_at: now,
    settings: {
      buffer_minutes: DEFAULT_BUFFER_MINUTES,
      timezone: DEFAULT_TIMEZONE,
    },
    ingest: {
      token_hash: null,
      token_prefix: null,
      created_at: null,
    },
    github: {
      login: null,
      user_id: null,
      access_token_enc: null,
      token_kind: null,
      last_sync_at: null,
      last_sync_error: null,
    },
    workouts: [],
    events: [],
    agent_runs: [],
  };
}

export function normalizeVibeDocument(
  raw: unknown,
  email: string,
): VibeDocument {
  const base = emptyVibeDocument(email);
  if (!raw || typeof raw !== "object") return base;
  const row = raw as Record<string, unknown>;
  const settingsIn =
    row.settings && typeof row.settings === "object"
      ? (row.settings as Record<string, unknown>)
      : {};
  const ingestIn =
    row.ingest && typeof row.ingest === "object"
      ? (row.ingest as Record<string, unknown>)
      : {};
  const githubIn =
    row.github && typeof row.github === "object"
      ? (row.github as Record<string, unknown>)
      : {};
  const tzRaw =
    typeof settingsIn.timezone === "string" ? settingsIn.timezone : "";
  return {
    schema_version: SCHEMA_VERSION,
    email: normalizeEmail(email),
    display_name:
      (typeof row.display_name === "string" && row.display_name.trim()) ||
      base.display_name,
    image_url:
      typeof row.image_url === "string" && row.image_url.trim()
        ? row.image_url.trim()
        : null,
    created_at:
      typeof row.created_at === "string" ? row.created_at : base.created_at,
    updated_at:
      typeof row.updated_at === "string" ? row.updated_at : base.updated_at,
    settings: {
      buffer_minutes: clampBuffer(settingsIn.buffer_minutes),
      timezone: isValidTimeZone(tzRaw) ? tzRaw : DEFAULT_TIMEZONE,
    },
    ingest: {
      token_hash:
        typeof ingestIn.token_hash === "string" ? ingestIn.token_hash : null,
      token_prefix:
        typeof ingestIn.token_prefix === "string"
          ? ingestIn.token_prefix
          : null,
      created_at:
        typeof ingestIn.created_at === "string" ? ingestIn.created_at : null,
    },
    github: {
      login: typeof githubIn.login === "string" ? githubIn.login : null,
      user_id:
        typeof githubIn.user_id === "number" && Number.isFinite(githubIn.user_id)
          ? githubIn.user_id
          : null,
      access_token_enc:
        typeof githubIn.access_token_enc === "string"
          ? githubIn.access_token_enc
          : null,
      token_kind:
        githubIn.token_kind === "oauth" || githubIn.token_kind === "pat"
          ? githubIn.token_kind
          : null,
      last_sync_at:
        typeof githubIn.last_sync_at === "string"
          ? githubIn.last_sync_at
          : null,
      last_sync_error:
        typeof githubIn.last_sync_error === "string"
          ? githubIn.last_sync_error
          : null,
    },
    workouts: Array.isArray(row.workouts)
      ? row.workouts.map(normalizeWorkout).filter((w): w is Workout => !!w)
      : [],
    events: Array.isArray(row.events)
      ? row.events.map(normalizeEvent).filter((e): e is CodingEvent => !!e)
      : [],
    agent_runs: Array.isArray(row.agent_runs)
      ? row.agent_runs
          .map(normalizeAgentRun)
          .filter((a): a is AgentRun => !!a)
      : [],
  };
}

export function clampBufferMinutes(raw: unknown): number {
  return clampBuffer(raw);
}
