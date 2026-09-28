/**
 * Snapshot JSON read helpers (roadmap 3.6).
 * Missing files and corrupt payloads must not look the same to callers.
 */

export class CorruptSnapshotError extends Error {
  readonly path: string;

  constructor(filePath: string, options?: { cause?: unknown }) {
    super(`Corrupt snapshot JSON: ${filePath}`, options);
    this.name = "CorruptSnapshotError";
    this.path = filePath;
  }
}

/** Parse snapshot JSON; throws CorruptSnapshotError on SyntaxError. */
export function parseSnapshotJson<T>(raw: string, filePath: string): T {
  try {
    return JSON.parse(raw) as T;
  } catch (cause) {
    throw new CorruptSnapshotError(filePath, { cause });
  }
}

export function isNotFoundFsError(err: unknown): boolean {
  return Boolean(
    err &&
      typeof err === "object" &&
      "code" in err &&
      (err as { code?: string }).code === "ENOENT",
  );
}
