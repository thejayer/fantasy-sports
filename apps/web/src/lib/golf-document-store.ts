/** Authoritative golf document mutations. Never read mutable state via Next/FUSE caches. */
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { hubDataRoot } from "@/lib/hub-paths";
import { assertGolfWritesEnabled } from "@/lib/golf-rollout-gate";

type Mutation<T, R> = { value?: T; result: R };
type Token = { access_token: string; expires_in: number };
let token: { value: string; expires: number } | undefined;

async function headers(): Promise<Record<string, string>> {
  if (!token || token.expires <= Date.now()) {
    const response = await fetch(
      "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token",
      { headers: { "Metadata-Flavor": "Google" }, cache: "no-store", signal: AbortSignal.timeout(5000) },
    );
    if (!response.ok) throw new Error(`golf storage identity unavailable (${response.status})`);
    const body = await response.json() as Token;
    if (!body.access_token || !Number.isFinite(body.expires_in)) {
      throw new Error("invalid golf storage identity response");
    }
    token = { value: body.access_token, expires: Date.now() + Math.max(0, body.expires_in - 60) * 1000 };
  }
  return { Authorization: `Bearer ${token.value}` };
}

function objectName(relative: string): string {
  if (relative.startsWith("/") || relative.split(/[\\/]/).some(p => p === "..")) {
    throw new Error("invalid golf document path");
  }
  return relative.replaceAll("\\", "/");
}

async function cloudMutation<T, R>(
  bucket: string,
  name: string,
  mutate: (current: T | null) => Mutation<T, R>,
): Promise<R> {
  const objectUrl = `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(name)}`;
  for (let attempt = 0; attempt < 12; attempt++) {
    const auth = await headers();
    const options = { headers: auth, cache: "no-store" as const, signal: AbortSignal.timeout(10000) };
    const metadata = await fetch(`${objectUrl}?fields=generation`, options);
    let generation = "0";
    let current: T | null = null;
    if (metadata.ok) {
      generation = String((await metadata.json()).generation);
      if (!/^\d+$/.test(generation) || generation === "0") throw new Error("invalid golf object generation");
      const media = await fetch(`${objectUrl}?alt=media&ifGenerationMatch=${generation}`, {
        ...options, signal: AbortSignal.timeout(10000),
      });
      if (media.status === 404 || media.status === 412) continue;
      if (!media.ok) throw new Error(`golf document read failed (${media.status})`);
      current = await media.json() as T;
    } else if (metadata.status !== 404) {
      throw new Error(`golf document metadata failed (${metadata.status})`);
    }
    // Callbacks may be replayed after a conflict: keep them synchronous and pure.
    const next = mutate(current);
    if (next.value === undefined) return next.result;
    const query = new URLSearchParams({ uploadType: "media", name, ifGenerationMatch: generation });
    const write = await fetch(
      `https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(bucket)}/o?${query}`,
      {
        method: "POST", headers: { ...auth, "Content-Type": "application/json" },
        body: JSON.stringify(next.value), cache: "no-store", signal: AbortSignal.timeout(10000),
      },
    );
    if (write.ok) return next.result;
    if (write.status !== 412) throw new Error(`golf document write failed (${write.status})`);
    await delay(10 + Math.floor(Math.random() * 30));
  }
  throw new Error("golf document changed too often; retry the request");
}

async function localMutation<T, R>(name: string, mutate: (current: T | null) => Mutation<T, R>): Promise<R> {
  const file = path.join(hubDataRoot(), name);
  await fs.mkdir(path.dirname(file), { recursive: true });
  const lock = `${file}.lock`;
  // Local files only. Never use exclusive-create locks on a GCS FUSE mount.
  let handle;
  for (let attempt = 0; attempt < 250; attempt++) {
    try { handle = await fs.open(lock, "wx"); break; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      await delay(20);
    }
  }
  if (!handle) throw new Error("golf document busy; retry the request (check abandoned local lock after a crash)");
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    let current: T | null;
    try { current = JSON.parse(await fs.readFile(file, "utf8")) as T; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      current = null;
    }
    const next = mutate(current);
    if (next.value !== undefined) {
      await fs.writeFile(temporary, `${JSON.stringify(next.value, null, 2)}\n`, "utf8");
      await fs.rename(temporary, file);
    }
    return next.result;
  } finally {
    await fs.rm(temporary, { force: true });
    await handle.close();
    await fs.unlink(lock);
  }
}

export async function mutateGolfDocument<T, R>(
  relative: string,
  mutate: (current: T | null) => Mutation<T, R>,
): Promise<R> {
  // Check before identity lookup, lock creation, reads, callbacks, or writes.
  assertGolfWritesEnabled();
  const name = objectName(relative);
  const bucket = process.env.SJ_HUB_GCS_BUCKET?.trim();
  if (bucket) return cloudMutation(bucket, name, mutate);
  if (process.env.K_SERVICE) {
    throw new Error("SJ_HUB_GCS_BUCKET is required for concurrent golf writes on Cloud Run");
  }
  return localMutation(name, mutate);
}

/** Paused auction reads must neither tick timers nor enter a mutation path. */
export async function readGolfDocument<T>(relative: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(path.join(hubDataRoot(), objectName(relative)), "utf8")) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}
