/**
 * Per-user vibe JSON on disk (GCS FUSE in prod, local data/vibe in dev).
 * Paths are derived only from the signed-in email — never from the request body.
 */

import { promises as fs } from "fs";
import path from "path";

import { vibeDataRoot } from "@/lib/paths";
import type { VibeActor } from "@/lib/session";
import { userKeyFromEmail } from "@/lib/user-key";
import {
  emptyVibeDocument,
  normalizeVibeDocument,
  type AgentRun,
  type CodingEvent,
  type VibeDocument,
  type Workout,
} from "@/lib/vibe-document";

function vibePathForEmail(email: string, root = vibeDataRoot()): string {
  const key = userKeyFromEmail(email);
  return path.join(root, "users", key, "vibe.json");
}

async function atomicWrite(filePath: string, payload: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  await fs.rename(tmp, filePath);
}

export async function readVibeDocument(
  email: string,
): Promise<VibeDocument | null> {
  const filePath = vibePathForEmail(email);
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return normalizeVibeDocument(JSON.parse(raw), email);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return null;
    throw err;
  }
}

export async function writeVibeDocument(
  document: VibeDocument,
): Promise<VibeDocument> {
  await atomicWrite(vibePathForEmail(document.email), document);
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

export async function ensureVibeDocument(
  actor: VibeActor,
): Promise<VibeDocument> {
  return enqueueForUser(actor.email, async () => {
    const existing = await readVibeDocument(actor.email);
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
        await writeVibeDocument(next);
      }
      return next;
    }
    const created = emptyVibeDocument(actor.email, {
      displayName: actor.name,
      imageUrl: actor.image,
    });
    await writeVibeDocument(created);
    return created;
  });
}

export async function mutateVibeDocument(
  actor: VibeActor,
  mutator: (doc: VibeDocument) => VibeDocument | Promise<VibeDocument>,
): Promise<VibeDocument> {
  return enqueueForUser(actor.email, async () => {
    const existing =
      (await readVibeDocument(actor.email)) ??
      emptyVibeDocument(actor.email, {
        displayName: actor.name,
        imageUrl: actor.image,
      });
    const mutated = await mutator(existing);
    const next = {
      ...mutated,
      email: actor.email,
      updated_at: new Date().toISOString(),
    };
    await writeVibeDocument(next);
    return next;
  });
}

function mergeBySourceId<T extends { id: string; source_id?: string }>(
  existing: T[],
  incoming: T[],
  keyOf: (row: T) => string,
): T[] {
  const map = new Map<string, T>();
  for (const row of existing) map.set(keyOf(row), row);
  for (const row of incoming) {
    const key = keyOf(row);
    if (!map.has(key)) map.set(key, row);
  }
  return [...map.values()];
}

export function mergeWorkouts(
  existing: Workout[],
  incoming: Workout[],
): Workout[] {
  return mergeBySourceId(
    existing,
    incoming,
    (row) => `${row.source}:${row.source_id}`,
  ).sort((a, b) => b.start.localeCompare(a.start));
}

export function mergeAgentRuns(
  existing: AgentRun[],
  incoming: AgentRun[],
): AgentRun[] {
  const map = new Map<string, AgentRun>();
  for (const row of existing) map.set(row.id, row);
  for (const row of incoming) {
    if (!map.has(row.id)) map.set(row.id, row);
  }
  return [...map.values()].sort((a, b) => b.start.localeCompare(a.start));
}

export async function upsertWorkouts(
  actor: VibeActor,
  incoming: Workout[],
): Promise<{ document: VibeDocument; added: number }> {
  let added = 0;
  const document = await mutateVibeDocument(actor, (doc) => {
    const before = doc.workouts.length;
    const workouts = mergeWorkouts(doc.workouts, incoming);
    added = workouts.length - before;
    return { ...doc, workouts };
  });
  return { document, added };
}

export async function upsertEvents(
  actor: VibeActor,
  incoming: CodingEvent[],
): Promise<VibeDocument> {
  const { mergeCodingEvents } = await import("@/lib/github");
  return mutateVibeDocument(actor, (doc) => ({
    ...doc,
    events: mergeCodingEvents(doc.events, incoming),
  }));
}

export async function upsertAgentRuns(
  actor: VibeActor,
  incoming: AgentRun[],
): Promise<{ document: VibeDocument; added: number }> {
  let added = 0;
  const document = await mutateVibeDocument(actor, (doc) => {
    const before = doc.agent_runs.length;
    const agent_runs = mergeAgentRuns(doc.agent_runs, incoming);
    added = agent_runs.length - before;
    return { ...doc, agent_runs };
  });
  return { document, added };
}

export async function deleteVibeDocument(email: string): Promise<void> {
  const filePath = vibePathForEmail(email);
  try {
    await fs.unlink(filePath);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return;
    throw err;
  }
}

export async function listVibeUserEmails(
  root = vibeDataRoot(),
): Promise<string[]> {
  const usersDir = path.join(root, "users");
  let names: string[] = [];
  try {
    names = await fs.readdir(usersDir);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return [];
    throw err;
  }
  const emails: string[] = [];
  for (const name of names) {
    try {
      const raw = await fs.readFile(
        path.join(usersDir, name, "vibe.json"),
        "utf8",
      );
      const parsed = JSON.parse(raw) as { email?: string };
      if (parsed.email) emails.push(parsed.email);
    } catch {
      /* skip corrupt / missing */
    }
  }
  return emails;
}

/** Test helper — expose the on-disk path so isolation tests can assert it. */
export function vibeDocumentPath(email: string, root?: string): string {
  return vibePathForEmail(email, root ?? vibeDataRoot());
}

export type { VibeDocument };
