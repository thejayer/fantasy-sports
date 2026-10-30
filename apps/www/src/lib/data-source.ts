/**
 * Read-only store access for the portal.
 *
 * `fs` (default) — Cloud Run FUSE + local/CI fixtures. Same paths and
 * missing-file behavior as before this module existed.
 * `gcs` — Vercel. Objects in SJ_GCS_BUCKET (optional SJ_GCS_PREFIX), then
 * the same local fixture fallback for bets.
 *
 * Per-request memo via React cache() (no-op outside RSC) so one page does
 * not refetch the same object. Public pages keep ISR revalidate=1800;
 * /bets stays force-dynamic.
 */

import { promises as fs } from "fs";
import path from "path";
import { cache } from "react";

import { betsDataRoots, hubDataRoot } from "@/lib/paths";

export type DataSourceMode = "fs" | "gcs";

export function dataSourceMode(): DataSourceMode {
  return process.env.SJ_DATA_SOURCE?.trim().toLowerCase() === "gcs"
    ? "gcs"
    : "fs";
}

export function gcsObjectKey(...parts: string[]): string {
  const prefix = (process.env.SJ_GCS_PREFIX || "")
    .trim()
    .replace(/^\/+|\/+$/g, "");
  const rest = parts
    .map((part) => part.trim().replace(/^\/+|\/+$/g, ""))
    .filter(Boolean);
  return [prefix, ...rest].filter(Boolean).join("/");
}

export function hubMembersRelPath(): string {
  return "hub_members.json";
}

const inflightFs = new Map<string, Promise<string | null>>();
const inflightGcs = new Map<string, Promise<string | null>>();

function coalesce(
  map: Map<string, Promise<string | null>>,
  key: string,
  read: () => Promise<string | null>,
): Promise<string | null> {
  const hit = map.get(key);
  if (hit) return hit;
  const pending = read().finally(() => {
    map.delete(key);
  });
  map.set(key, pending);
  return pending;
}

async function readFsFileUncached(absPath: string): Promise<string | null> {
  return coalesce(inflightFs, absPath, async () => {
    try {
      return await fs.readFile(absPath, "utf8");
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT") return null;
      throw err;
    }
  });
}

const readFsFile = cache(readFsFileUncached);

async function readGcsObjectUncached(objectKey: string): Promise<string | null> {
  return coalesce(inflightGcs, objectKey, async () => {
    const { downloadGcsObject } = await import("@/lib/gcs");
    return downloadGcsObject(objectKey);
  });
}

const readGcsObject = cache(readGcsObjectUncached);

export async function readHubText(): Promise<string | null> {
  if (dataSourceMode() === "gcs") {
    const fromGcs = await readGcsObject(gcsObjectKey(hubMembersRelPath()));
    if (fromGcs !== null) return fromGcs;
  }
  return readFsFile(path.join(hubDataRoot(), hubMembersRelPath()));
}

export async function readBetsText(name: string): Promise<string | null> {
  if (dataSourceMode() === "gcs") {
    const fromGcs = await readGcsObject(gcsObjectKey("bets", name));
    if (fromGcs !== null) return fromGcs;
  }
  for (const root of betsDataRoots()) {
    const raw = await readFsFile(path.join(root, name));
    if (raw !== null) return raw;
  }
  return null;
}

/**
 * A JSON snapshot file under the hub root (e.g. `index.json`,
 * `football-main/2026/manifest.json`), as text. `rel` is a relative path of
 * plain segments; anything else (`..`, absolute, odd characters) reads as
 * missing. Same gcs-then-fs order as the other readers.
 */
export async function readHubFile(rel: string): Promise<string | null> {
  const parts = rel.split("/");
  if (!parts.length || !parts.every((p) => /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(p) && p !== "..")) {
    return null;
  }
  if (dataSourceMode() === "gcs") {
    const fromGcs = await readGcsObject(gcsObjectKey(...parts));
    if (fromGcs !== null) return fromGcs;
  }
  return readFsFile(path.join(hubDataRoot(), ...parts));
}
