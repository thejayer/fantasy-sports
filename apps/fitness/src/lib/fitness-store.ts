/**
 * Per-user athlete JSON on disk (GCS FUSE in prod, local data/fitness in dev).
 * Paths are derived only from the signed-in email — never from the request body.
 */

import { promises as fs } from "fs";
import path from "path";

import {
  emptyFitnessDocument,
  hasLoggedTraining,
  normalizeFitnessDocument,
  normalizeSlices,
  type FitnessDocument,
  type FitnessSlices,
} from "@/lib/fitness-document";
import { fitnessDataRoot } from "@/lib/paths";
import type { FitnessActor } from "@/lib/session";
import { userKeyFromEmail } from "@/lib/user-key";

export class FitnessConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FitnessConflictError";
  }
}

function athletePathForEmail(email: string, root = fitnessDataRoot()): string {
  const key = userKeyFromEmail(email);
  return path.join(root, "users", key, "athlete.json");
}

async function atomicWrite(filePath: string, payload: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  await fs.rename(tmp, filePath);
}

export async function readAthleteDocument(
  email: string,
): Promise<FitnessDocument | null> {
  const filePath = athletePathForEmail(email);
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return normalizeFitnessDocument(JSON.parse(raw), email);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return null;
    throw err;
  }
}

export async function writeAthleteDocument(
  document: FitnessDocument,
): Promise<FitnessDocument> {
  await atomicWrite(athletePathForEmail(document.email), document);
  return document;
}

const mutationChains = new Map<string, Promise<unknown>>();

function enqueueForUser<T>(email: string, work: () => Promise<T>): Promise<T> {
  const key = userKeyFromEmail(email);
  const prior = mutationChains.get(key) ?? Promise.resolve();
  const run = prior.then(work, work);
  mutationChains.set(
    key,
    run.then(
      () => undefined,
      () => undefined,
    ),
  );
  return run;
}

/** First sign-in: create an empty profile so every allowlisted member has one. */
export async function ensureAthleteDocument(
  actor: FitnessActor,
): Promise<FitnessDocument> {
  return enqueueForUser(actor.email, async () => {
    const existing = await readAthleteDocument(actor.email);
    if (existing) {
      let next = existing;
      if (actor.name && next.display_name !== actor.name) {
        next = { ...next, display_name: actor.name };
      }
      if (actor.image && next.image_url !== actor.image) {
        next = { ...next, image_url: actor.image };
      }
      if (next !== existing) {
        next = { ...next, updated_at: new Date().toISOString() };
        await writeAthleteDocument(next);
      }
      return next;
    }
    const created = emptyFitnessDocument(actor.email, {
      displayName: actor.name,
      imageUrl: actor.image,
    });
    await writeAthleteDocument(created);
    return created;
  });
}

export async function saveAthleteSlices(
  actor: FitnessActor,
  rawSlices: unknown,
  opts?: { migrate?: boolean },
): Promise<FitnessDocument> {
  const slices = normalizeSlices(rawSlices);
  return enqueueForUser(actor.email, async () => {
    const existing =
      (await readAthleteDocument(actor.email)) ??
      emptyFitnessDocument(actor.email, {
        displayName: actor.name,
        imageUrl: actor.image,
      });

    if (opts?.migrate) {
      if (existing.migrated_from_anonymous || hasLoggedTraining(existing.slices)) {
        throw new FitnessConflictError(
          "anonymous log already migrated or this profile has training",
        );
      }
    }

    const next: FitnessDocument = {
      ...existing,
      display_name: actor.name || existing.display_name,
      image_url: actor.image ?? existing.image_url,
      updated_at: new Date().toISOString(),
      migrated_from_anonymous:
        existing.migrated_from_anonymous || opts?.migrate === true,
      slices,
    };
    await writeAthleteDocument(next);
    return next;
  });
}

/** Test helper — expose the on-disk path so isolation tests can assert it. */
export function athleteDocumentPath(email: string, root?: string): string {
  return athletePathForEmail(email, root ?? fitnessDataRoot());
}

export type { FitnessDocument, FitnessSlices };
