import { auth } from "@/auth";
import { meResponse, safeAvatar, type MeResponse, type MenuUser } from "@/lib/account-menu";
import { getSiteConfig } from "@/lib/site";

/** Display name and avatar of whoever is signed in, from the session only. Null when signed out. */
export async function currentMenuUser(): Promise<MenuUser | null> {
  if (process.env.AUTH_DEV_BYPASS === "1") return { name: "Dev member", image: null };
  try {
    const session = await auth();
    return menuUserFromSession(session?.user);
  } catch {
    // A bad or unreadable cookie is just "signed out" here.
    return null;
  }
}

function menuUserFromSession(
  user: { name?: string | null; email?: string | null; image?: string | null } | undefined | null,
): MenuUser | null {
  if (!user) return null;
  const name =
    (typeof user.name === "string" && user.name.trim()) ||
    (typeof user.email === "string" && user.email.split("@")[0]) ||
    "Member";
  return { name, image: safeAvatar(user.image) };
}

export async function getMe(): Promise<MeResponse> {
  const { fantasyHubUrl, casinoEnabled } = getSiteConfig();
  return meResponse(await currentMenuUser(), { fantasyHubUrl, casinoEnabled });
}
