import { redirect } from "next/navigation";
import type { Session } from "next-auth";

import { auth } from "@/auth";
import { normalizeEmail } from "@/lib/allowlist";
import { DEFAULT_CALLBACK_URL, safeCallbackUrl } from "@/lib/safe-redirect";

export type BetsActor = {
  email: string;
  name: string;
  image: string | null;
  source: "session" | "bypass";
};

export function devBypassEnabled(): boolean {
  return process.env.AUTH_DEV_BYPASS === "1";
}

export function bypassActor(): BetsActor {
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

function actorFromSession(session: Session): BetsActor | null {
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

export async function getBetsActor(): Promise<BetsActor | null> {
  if (devBypassEnabled()) {
    return bypassActor();
  }
  const session = await auth();
  if (!session?.user) return null;
  return actorFromSession(session);
}

/** Second authorization layer — pages must not rely on middleware alone. */
export async function requireBetsActor(
  callbackUrl: string = DEFAULT_CALLBACK_URL,
): Promise<BetsActor> {
  const actor = await getBetsActor();
  if (actor) return actor;
  const next = safeCallbackUrl(callbackUrl);
  redirect(`/login?callbackUrl=${encodeURIComponent(next)}`);
}
