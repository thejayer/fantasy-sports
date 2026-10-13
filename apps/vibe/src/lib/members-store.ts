/**
 * Read-only hub_members.json — the same file the fantasy hub writes.
 * Fitness never creates members; it only consults the allowlist.
 */

import { promises as fs } from "fs";
import path from "path";

import type { MembersFile } from "@/lib/allowlist";
import { hubDataRoot } from "@/lib/paths";

export function hubMembersPath(root = hubDataRoot()): string {
  return path.join(root, "hub_members.json");
}

export async function readHubMembers(): Promise<MembersFile | null> {
  const filePath = hubMembersPath();
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as MembersFile;
    if (!parsed || !Array.isArray(parsed.members)) return { members: [] };
    return { members: parsed.members };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return null;
    throw err;
  }
}
