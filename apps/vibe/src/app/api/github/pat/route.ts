import { NextResponse } from "next/server";

import { encryptSecret } from "@/lib/crypto";
import { fetchGithubUser } from "@/lib/github";
import { getVibeActor } from "@/lib/session";
import { mutateVibeDocument } from "@/lib/vibe-store";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const actor = await getVibeActor();
  if (!actor) {
    return NextResponse.json({ error: "sign in required" }, { status: 401 });
  }
  let body: { token?: string } = {};
  try {
    body = (await request.json()) as { token?: string };
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const token = body.token?.trim();
  if (!token) {
    return NextResponse.json({ error: "token required" }, { status: 400 });
  }
  try {
    const user = await fetchGithubUser(token);
    const document = await mutateVibeDocument(actor, (doc) => ({
      ...doc,
      github: {
        ...doc.github,
        login: user.login,
        user_id: user.id,
        access_token_enc: encryptSecret(token),
        token_kind: "pat",
        last_sync_error: null,
      },
    }));
    return NextResponse.json({
      ok: true,
      login: document.github.login,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "GitHub rejected the token";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
