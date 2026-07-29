/**
 * Server-only hub_members.json persistence.
 * Lives beside league snapshots under SJ_DATA_DIR (writable local / seed store).
 * Production GCS mounts are often read-only — admin writes need a writable root.
 */

import { promises as fs } from "fs";
import path from "path";

import {
  emptyMembersFile,
  type HubMembersFile,
} from "@/lib/hub-members";

function writableDataRoot(): string {
  if (process.env.SJ_DATA_DIR) return process.env.SJ_DATA_DIR;
  return path.resolve(process.cwd(), "../../data/sj");
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
