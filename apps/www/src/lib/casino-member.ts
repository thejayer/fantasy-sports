import { auth } from "@/auth";
import type { CasinoMember } from "@/lib/casino-identity";

/**
 * The signed-in member from the Auth.js session, or null when signed out.
 * Same session read as the /casino proxy's Route Handler (kept separate so
 * that handler stays untouched); used by the home-page summary route.
 */
export async function getCasinoMember(): Promise<CasinoMember | null> {
  if (process.env.AUTH_DEV_BYPASS === "1") {
    return { id: "dev-bypass", name: "Dev" };
  }
  const session = await auth();
  if (!session) return null;
  const user = (session.user ?? {}) as CasinoMember;
  return {
    googleSub: user.googleSub,
    id: user.id,
    name: user.name,
    username: user.username,
    email: user.email,
  };
}
