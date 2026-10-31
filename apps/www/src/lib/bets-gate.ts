import { isCasinoConfigured, isCasinoPath } from "@/lib/casino";

/** Paths that must sit behind the Strictly Jayers allowlist. */

export function isBetsProtectedPath(pathname: string): boolean {
  if (pathname === "/bets" || pathname.startsWith("/bets/")) return true;
  if (pathname === "/api/bets" || pathname.startsWith("/api/bets/")) return true;
  return false;
}

/** The signed-in member's own profile page. */
export function isProfilePath(pathname: string): boolean {
  return pathname === "/profile" || pathname.startsWith("/profile/");
}

/** /bets and /profile always; /casino only when CASINO_URL is set (else /casino is a 404). */
export function isMembersProtectedPath(pathname: string): boolean {
  if (isBetsProtectedPath(pathname)) return true;
  if (isProfilePath(pathname)) return true;
  return isCasinoConfigured() && isCasinoPath(pathname);
}

export function isBetsAuthPublicPath(pathname: string): boolean {
  if (pathname === "/login" || pathname.startsWith("/login/")) return true;
  if (pathname.startsWith("/api/auth")) return true;
  return false;
}

export function membersLoginTitle(callbackUrl: string): string {
  if (isCasinoPath(callbackUrl.split("?")[0] ?? callbackUrl)) {
    return "Sign in to Casino";
  }
  if (isProfilePath(callbackUrl.split("?")[0]?.split("#")[0] ?? callbackUrl)) {
    return "Sign in to your profile";
  }
  return "Sign in to Bets";
}
