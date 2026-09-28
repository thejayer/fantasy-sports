/**
 * Crawler / browser chrome that must never hit the login wall.
 * Next metadata routes return PNG; a session redirect turns them into HTML.
 */
export function isPublicMetadataPath(pathname: string): boolean {
  if (pathname === "/favicon.ico") return true;
  return /\/(opengraph-image|twitter-image|icon|apple-icon)(\/|$|-)/.test(
    pathname,
  );
}
