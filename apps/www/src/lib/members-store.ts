/**
 * Read-only hub_members.json — the same file the fantasy hub writes.
 * The portal never creates members; it only consults the allowlist.
 */

import path from "path";

import type { MembersFile } from "@/lib/allowlist";
import { hubMembersRelPath, readHubText } from "@/lib/data-source";
import { hubDataRoot } from "@/lib/paths";

export function hubMembersPath(root = hubDataRoot()): string {
  return path.join(root, hubMembersRelPath());
}

export async function readHubMembers(): Promise<MembersFile | null> {
  const raw = await readHubText();
  if (raw === null) return null;
  const parsed = JSON.parse(raw) as MembersFile;
  if (!parsed || !Array.isArray(parsed.members)) return { members: [] };
  return { members: parsed.members };
}
