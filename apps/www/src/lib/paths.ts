import path from "path";

/**
 * Hub-native members file (read-only here). Prod mounts the same GCS bucket
 * as sj-hub at `/app/data/sj` and sets `SJ_HUB_DIR` there.
 */
export function hubDataRoot(): string {
  if (process.env.SJ_HUB_DIR) return process.env.SJ_HUB_DIR;
  if (process.env.SJ_DATA_DIR) {
    return path.resolve(process.env.SJ_DATA_DIR);
  }
  return path.resolve(process.cwd(), "../../data/sj");
}

/**
 * Bet tracker JSON (`bets.json` / `summary.json` / `parlay_legs.json` /
 * `public_warnings.json` / `record_splits.json` / `tailing_legs.json` /
 * `bot/board.json`). Prod: `{SJ_HUB_DIR}/bets` on the hub bucket.
 * Local / CI: committed fixtures.
 */
export function betsDataRoots(): string[] {
  const roots: string[] = [];
  if (process.env.SJ_BETS_DIR) roots.push(process.env.SJ_BETS_DIR);
  if (process.env.SJ_HUB_DIR) {
    roots.push(path.join(process.env.SJ_HUB_DIR, "bets"));
  }
  if (process.env.SJ_DATA_DIR) {
    roots.push(path.join(process.env.SJ_DATA_DIR, "bets"));
  }
  roots.push(path.resolve(process.cwd(), "fixtures/bets"));
  roots.push(path.resolve(process.cwd(), "apps/www/fixtures/bets"));
  roots.push(path.resolve(process.cwd(), "../../apps/www/fixtures/bets"));
  return roots;
}
