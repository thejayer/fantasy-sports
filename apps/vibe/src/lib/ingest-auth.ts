import {
  extractIngestToken,
  ingestTokenMatches,
} from "@/lib/ingest-token";
import type { VibeActor } from "@/lib/session";
import { listVibeUserEmails, readVibeDocument } from "@/lib/vibe-store";

export async function actorForIngestRequest(
  request: Request,
): Promise<VibeActor | null> {
  const token = extractIngestToken(request);
  if (!token) return null;
  const emails = await listVibeUserEmails();
  for (const email of emails) {
    const doc = await readVibeDocument(email);
    if (!doc) continue;
    if (ingestTokenMatches(token, doc.ingest.token_hash)) {
      return {
        email,
        name: doc.display_name,
        image: doc.image_url,
        source: "session",
      };
    }
  }
  return null;
}
