/** Runtime gate, deliberately independent of bucket/identity configuration. */
export const GOLF_WRITES_PAUSED = "Golf changes are temporarily paused.";

export function golfWritesEnabled(): boolean {
  return process.env.SJ_GOLF_WRITES_ENABLED === "1";
}

export class GolfWritesPausedError extends Error {
  constructor() { super(GOLF_WRITES_PAUSED); }
}

export function assertGolfWritesEnabled(): void {
  if (!golfWritesEnabled()) throw new GolfWritesPausedError();
}
