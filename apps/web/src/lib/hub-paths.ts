/**
 * Snapshot vs hub-native store roots.
 *
 * ESPN sync owns `SJ_DATA_DIR` (often a read-only GCS mount in prod).
 * Hub-native golf / members / auction rooms write under `SJ_HUB_DIR` so
 * sync/backfill never share an index or season directory with them.
 */

import path from "path";

/** Writable hub-native root (golf, hub_members, auction_room). */
export function hubDataRoot(): string {
  if (process.env.SJ_HUB_DIR) return process.env.SJ_HUB_DIR;
  if (process.env.SJ_DATA_DIR) {
    return path.resolve(process.env.SJ_DATA_DIR, "..", "hub");
  }
  return path.resolve(process.cwd(), "../../data/hub");
}

/** ESPN / synced snapshot roots (read-mostly). */
export function snapshotDataRoots(): string[] {
  const roots = [
    process.env.SJ_DATA_DIR,
    path.resolve(process.cwd(), "../../data/sj"),
    path.resolve(process.cwd(), "../../fixtures/sj"),
    path.resolve(process.cwd(), "fixtures/sj"),
  ].filter((value): value is string => Boolean(value));
  return [...new Set(roots)];
}

/**
 * All roots to search for league data.
 * Hub root is first so hub-native golf wins over a stale fixture copy.
 */
export function dataRoots(): string[] {
  return [...new Set([hubDataRoot(), ...snapshotDataRoots()])];
}
