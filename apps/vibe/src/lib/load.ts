import { buildDemoDocument } from "@/fixtures/demo";
import { scoreWorkouts, type WorkoutVibe } from "@/lib/score";
import { getVibeActor, type VibeActor } from "@/lib/session";
import {
  ensureVibeDocument,
  writeVibeDocument,
} from "@/lib/vibe-store";
import type { VibeDocument } from "@/lib/vibe-document";

export type LoadedVibe = {
  actor: VibeActor;
  document: VibeDocument;
  rows: WorkoutVibe[];
};

export async function loadVibe(): Promise<LoadedVibe | null> {
  const actor = await getVibeActor();
  if (!actor) return null;
  let document = await ensureVibeDocument(actor);
  if (
    actor.source === "bypass" &&
    document.workouts.length === 0 &&
    process.env.SJ_VIBE_SEED !== "0"
  ) {
    document = {
      ...buildDemoDocument(actor.email),
      ingest: document.ingest,
    };
    await writeVibeDocument(document);
  }
  const rows = scoreWorkouts(
    document.workouts,
    document.events,
    document.agent_runs,
    document.settings.buffer_minutes,
  );
  return { actor, document, rows };
}

export function publicGithub(document: VibeDocument) {
  return {
    login: document.github.login,
    connected: Boolean(document.github.access_token_enc || document.github.login),
    token_kind: document.github.token_kind,
    last_sync_at: document.github.last_sync_at,
    last_sync_error: document.github.last_sync_error,
  };
}
