import { redirect } from "next/navigation";
import { cache } from "react";
import type { Session } from "next-auth";

import { auth } from "@/auth";

/**
 * Authorization backstop for the data layer.
 *
 * `middleware.ts` is the first line of defence and owns the user-facing
 * redirect (including `callbackUrl`). It is not sufficient on its own: it is a
 * single check, and middleware/proxy bypass is a recurring vulnerability class
 * in this framework. So the snapshot readers gate themselves too -- if a
 * request ever reaches a page without passing middleware, it still gets no
 * league data.
 *
 * This deliberately does not rebuild the `callbackUrl` flow. Reaching here
 * means middleware was skipped, which is not a path real members take.
 */

export function devBypassEnabled(): boolean {
  return process.env.AUTH_DEV_BYPASS === "1";
}

/**
 * Resolve the session, or redirect to the login page.
 *
 * Memoised per request so gating several data reads in one render costs a
 * single session decrypt. Returns `null` when `AUTH_DEV_BYPASS=1`, matching
 * how the rest of the app treats local development.
 */
export const requireSession = cache(async (): Promise<Session | null> => {
  if (devBypassEnabled()) {
    return null;
  }
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }
  return session;
});
