/**
 * What the account (avatar) menu shows, in one place so the www sidebar, the
 * /profile page and the casino all agree. Served to the browser by /api/me;
 * the hub link comes from the site config so staging and prod stay right.
 */

export const SIGN_OUT_TITLE = "Sign out of all Strictly Jayers sites?";
export const SIGN_OUT_BODY = "You'll need to sign in with Google again.";

export const SIGN_OUT_ALL_PATH = "/api/signout-all";
export const PROFILE_PATH = "/profile";
export const LINK_TEAMS_PATH = "/profile#linked-teams";

export type MenuItemId = "profile" | "link-teams" | "settings";
export type MenuItem = { id: MenuItemId; label: string; href: string };

export type MenuUser = { name: string; image: string | null };

/** The reply of GET /api/me. Never carries an email or any id. */
export type MeResponse = {
  signedIn: boolean;
  user: MenuUser | null;
  items: MenuItem[];
  signIn: string;
  signOut: string;
};

/** Same order everywhere: Profile, Link teams, Settings. "Link teams" only exists while the casino does. */
export function accountMenuItems(config: {
  fantasyHubUrl: string;
  casinoEnabled: boolean;
}): MenuItem[] {
  const items: MenuItem[] = [{ id: "profile", label: "Profile", href: PROFILE_PATH }];
  if (config.casinoEnabled) {
    items.push({ id: "link-teams", label: "Link teams", href: LINK_TEAMS_PATH });
  }
  items.push({ id: "settings", label: "Settings", href: `${config.fantasyHubUrl}/settings` });
  return items;
}

export function meResponse(
  user: MenuUser | null,
  config: { fantasyHubUrl: string; casinoEnabled: boolean },
): MeResponse {
  return {
    signedIn: user !== null,
    user,
    items: accountMenuItems(config),
    signIn: "/login",
    signOut: SIGN_OUT_ALL_PATH,
  };
}

/** Only https avatars are ever rendered (Google profile pictures). */
export function safeAvatar(image: unknown): string | null {
  return typeof image === "string" && /^https:\/\//i.test(image.trim()) ? image.trim() : null;
}

export function initialsOf(name: string | null | undefined): string {
  return (name ?? "")
    .split(/[\s@._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}
