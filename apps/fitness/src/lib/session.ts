import type { Session } from "next-auth";

import { auth } from "@/auth";
import { normalizeEmail } from "@/lib/allowlist";

export type FitnessActor = {
  email: string;
  name: string;
  image: string | null;
  source: "session" | "bypass";
};

export function devBypassEnabled(): boolean {
  return process.env.AUTH_DEV_BYPASS === "1";
}

export function bypassActor(): FitnessActor {
  const email = normalizeEmail(
    process.env.SJ_DEV_VIEWER_EMAIL?.trim() || "demo@example.com",
  );
  return {
    email,
    name: "Dev member",
    image: null,
    source: "bypass",
  };
}

function actorFromSession(session: Session): FitnessActor | null {
  const email = session.user?.email?.trim();
  if (!email) return null;
  const name =
    (typeof session.user?.name === "string" && session.user.name.trim()) ||
    email.split("@")[0] ||
    "Member";
  const image =
    typeof session.user?.image === "string" && session.user.image.trim()
      ? session.user.image.trim()
      : null;
  return {
    email: normalizeEmail(email),
    name,
    image,
    source: "session",
  };
}

/**
 * API / PWA identity. AUTH_DEV_BYPASS uses SJ_DEV_VIEWER_EMAIL (same as hub)
 * so local and Playwright share one namespaced store — not a guest demo log.
 */
export async function getFitnessActor(): Promise<FitnessActor | null> {
  if (devBypassEnabled()) {
    return bypassActor();
  }
  const session = await auth();
  if (!session?.user) return null;
  return actorFromSession(session);
}
