/**
 * Server-only hub_members.json persistence under SJ_HUB_DIR (hub-native store).
 * Kept out of the ESPN snapshot root so sync/backfill never touch it.
 */

import { promises as fs } from "fs";
import path from "path";

import {
  emptyMembersFile,
  type HubMembersFile,
} from "@/lib/hub-members";
import { hubDataRoot } from "@/lib/hub-paths";

function writableDataRoot(): string {
  return hubDataRoot();
}

export function hubMembersPath(root = writableDataRoot()): string {
  return path.join(root, "hub_members.json");
}

async function atomicWrite(filePath: string, payload: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  await fs.rename(tmp, filePath);
}

export async function readHubMembers(): Promise<HubMembersFile> {
  const filePath = hubMembersPath();
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as HubMembersFile;
    if (!parsed || !Array.isArray(parsed.members)) {
      return emptyMembersFile();
    }
    return {
      schema_version: 1,
      updated_at: parsed.updated_at || new Date().toISOString(),
      members: parsed.members,
    };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return emptyMembersFile();
    throw err;
  }
}

export async function writeHubMembers(
  file: HubMembersFile,
): Promise<HubMembersFile> {
  const next: HubMembersFile = {
    schema_version: 1,
    updated_at: file.updated_at || new Date().toISOString(),
    members: file.members,
  };
  await atomicWrite(hubMembersPath(), next);
  return next;
}

/**
 * Serialize read-modify-write of hub_members.json within this process so
 * overlapping profile/admin/auth updates cannot clobber each other.
 */
let membersMutationChain: Promise<unknown> = Promise.resolve();

export async function updateHubMembers(
  mutator: (file: HubMembersFile) => HubMembersFile,
): Promise<HubMembersFile> {
  const run = membersMutationChain.then(async () => {
    const file = await readHubMembers();
    const next = mutator(file);
    // Same-object no-op (e.g. unchanged avatar on sign-in) skips the write.
    if (next === file) return file;
    return writeHubMembers(next);
  });
  // Keep the chain alive after failures so later writers still queue.
  membersMutationChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}
