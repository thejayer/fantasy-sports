/** Paths that must sit behind the Strictly Jayers allowlist. */

export function isBetsProtectedPath(pathname: string): boolean {
  if (pathname === "/bets" || pathname.startsWith("/bets/")) return true;
  if (pathname === "/api/bets" || pathname.startsWith("/api/bets/")) return true;
  return false;
}

export function isBetsAuthPublicPath(pathname: string): boolean {
  if (pathname === "/login" || pathname.startsWith("/login/")) return true;
  if (pathname.startsWith("/api/auth")) return true;
  return false;
}
