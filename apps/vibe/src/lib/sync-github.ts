import { decryptSecret } from "@/lib/crypto";
import {
  fetchGithubEvents,
  fetchGithubUser,
  fillCommitStats,
  githubIsStale,
  mergeCodingEvents,
  searchGithubCommits,
} from "@/lib/github";
import { scoreWorkouts } from "@/lib/score";
import type { VibeActor } from "@/lib/session";
import { mutateVibeDocument, readVibeDocument } from "@/lib/vibe-store";
import type { VibeDocument } from "@/lib/vibe-document";

export async function syncGithubForActor(
  actor: VibeActor,
  opts?: { force?: boolean; now?: Date },
): Promise<VibeDocument> {
  const now = opts?.now ?? new Date();
  const existing = await readVibeDocument(actor.email);
  if (!existing?.github.access_token_enc) {
    return mutateVibeDocument(actor, (doc) => ({
      ...doc,
      github: {
        ...doc.github,
        last_sync_error: "GitHub is not connected",
      },
    }));
  }
  if (!opts?.force && !githubIsStale(existing.github.last_sync_at, now.getTime())) {
    return existing;
  }

  try {
    const token = decryptSecret(existing.github.access_token_enc);
    const user = await fetchGithubUser(token);
    const from = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
    const [events, commits] = await Promise.all([
      fetchGithubEvents(token),
      searchGithubCommits(
        token,
        user.login,
        from.toISOString(),
        now.toISOString(),
      ),
    ]);
    let incoming = mergeCodingEvents(existing.events, [...events, ...commits]);
    const overlapping = scoreWorkouts(
      existing.workouts,
      incoming,
      existing.agent_runs,
      existing.settings.buffer_minutes,
    ).flatMap((row) => row.events.filter((event) => event.kind === "commit"));
    incoming = mergeCodingEvents(
      incoming,
      await fillCommitStats(token, overlapping, { limit: 25 }),
    );
    return mutateVibeDocument(actor, (doc) => {
      if (!doc.github.access_token_enc) return doc;
      return {
        ...doc,
        github: {
          ...doc.github,
          login: user.login,
          user_id: user.id,
          last_sync_at: now.toISOString(),
          last_sync_error: null,
        },
        events: mergeCodingEvents(doc.events, incoming),
      };
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "GitHub sync failed";
    return mutateVibeDocument(actor, (doc) => ({
      ...doc,
      github: {
        ...doc.github,
        last_sync_at: now.toISOString(),
        last_sync_error: message,
      },
    }));
  }
}
