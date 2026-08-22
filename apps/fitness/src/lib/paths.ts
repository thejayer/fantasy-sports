import path from "path";

/**
 * Hub-native members file (read-only here). Prod mounts the same GCS bucket
 * as sj-hub at `/app/data/sj` and sets `SJ_HUB_DIR` there.
 */
export function hubDataRoot(): string {
  if (process.env.SJ_HUB_DIR) return process.env.SJ_HUB_DIR;
  if (process.env.SJ_DATA_DIR) {
    return path.resolve(process.env.SJ_DATA_DIR, "..", "hub");
  }
  return path.resolve(process.cwd(), "../../data/hub");
}

/**
 * Per-user fitness documents. Prod: `/app/data/sj/fitness` on the hub bucket
 * (`fitness/` prefix so ESPN sync never sees these files).
 *
 * Do not mkdir/stat this path in the Cloud Run entrypoint — a slow FUSE
 * mount hangs the port probe. Create dirs lazily on first write.
 */
export function fitnessDataRoot(): string {
  if (process.env.SJ_FITNESS_DIR) return process.env.SJ_FITNESS_DIR;
  if (process.env.SJ_HUB_DIR) {
    return path.join(process.env.SJ_HUB_DIR, "fitness");
  }
  return path.resolve(process.cwd(), "../../data/fitness");
}
