/**
 * Per-member fitness document (profile, settings, logged training).
 * Slices match the PWA store in public/store.js / app.js.
 */

export const FITNESS_SCHEMA_VERSION = 1 as const;

export type FitnessSlices = {
  sessions: unknown[];
  plannedSessions: unknown[];
  recovery: unknown[];
  customDrills: unknown[];
  readinessCheckins: unknown[];
  athleteProfile: Record<string, unknown> | null;
  activeGoalId: string | null;
  activeProgramId: string | null;
  golfClubBag: unknown[] | null;
  gpsRound: Record<string, unknown> | null;
};

export type FitnessDocument = {
  schema_version: typeof FITNESS_SCHEMA_VERSION;
  email: string;
  display_name: string;
  image_url: string | null;
  created_at: string;
  updated_at: string;
  migrated_from_anonymous: boolean;
  slices: FitnessSlices;
};

export function emptySlices(): FitnessSlices {
  return {
    sessions: [],
    plannedSessions: [],
    recovery: [],
    customDrills: [],
    readinessCheckins: [],
    athleteProfile: null,
    activeGoalId: null,
    activeProgramId: null,
    golfClubBag: null,
    gpsRound: null,
  };
}

export function emptyFitnessDocument(
  email: string,
  opts?: { displayName?: string; imageUrl?: string | null; now?: Date },
): FitnessDocument {
  const now = (opts?.now ?? new Date()).toISOString();
  return {
    schema_version: FITNESS_SCHEMA_VERSION,
    email,
    display_name: opts?.displayName?.trim() || email.split("@")[0] || "Member",
    image_url: opts?.imageUrl ?? null,
    created_at: now,
    updated_at: now,
    migrated_from_anonymous: false,
    slices: emptySlices(),
  };
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asNullableString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

export function normalizeSlices(raw: unknown): FitnessSlices {
  const source =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  return {
    sessions: asArray(source.sessions),
    plannedSessions: asArray(source.plannedSessions),
    recovery: asArray(source.recovery),
    customDrills: asArray(source.customDrills),
    readinessCheckins: asArray(source.readinessCheckins),
    athleteProfile: asRecord(source.athleteProfile),
    activeGoalId: asNullableString(source.activeGoalId),
    activeProgramId: asNullableString(source.activeProgramId),
    golfClubBag: Array.isArray(source.golfClubBag) ? source.golfClubBag : null,
    gpsRound: asRecord(source.gpsRound),
  };
}

/** True when this member has not logged training yet (migration may apply). */
export function hasLoggedTraining(slices: FitnessSlices): boolean {
  return (
    slices.sessions.length > 0 ||
    slices.plannedSessions.length > 0 ||
    slices.recovery.length > 0 ||
    slices.customDrills.length > 0 ||
    slices.readinessCheckins.length > 0
  );
}

export function normalizeFitnessDocument(
  raw: unknown,
  fallbackEmail: string,
): FitnessDocument | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const doc = raw as Record<string, unknown>;
  if (!Array.isArray((doc.slices as FitnessSlices | undefined)?.sessions) && !doc.slices) {
    return null;
  }
  const email =
    typeof doc.email === "string" && doc.email.trim()
      ? doc.email.trim().toLowerCase()
      : fallbackEmail;
  return {
    schema_version: FITNESS_SCHEMA_VERSION,
    email,
    display_name:
      (typeof doc.display_name === "string" && doc.display_name.trim()) ||
      email.split("@")[0] ||
      "Member",
    image_url:
      typeof doc.image_url === "string" && doc.image_url.startsWith("https://")
        ? doc.image_url
        : null,
    created_at:
      typeof doc.created_at === "string" ? doc.created_at : new Date().toISOString(),
    updated_at:
      typeof doc.updated_at === "string" ? doc.updated_at : new Date().toISOString(),
    migrated_from_anonymous: doc.migrated_from_anonymous === true,
    slices: normalizeSlices(doc.slices),
  };
}
