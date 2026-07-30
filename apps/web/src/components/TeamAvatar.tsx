/**
 * Team crest with a monogram fallback (roadmap 7.3).
 *
 * `Team.logo_url` has been synced since phase 2 and was rendered nowhere, so
 * every team on every screen was a bare text string. ESPN hosts arbitrary
 * uploads, so this uses a plain `img` rather than `next/image` to avoid
 * whitelisting remote hosts for user-supplied league art.
 */

export function teamMonogram(name: string): string {
  const words = name
    .split(/[\s·—-]+/)
    .map((word) => word.replace(/[^A-Za-z0-9]/g, ""))
    .filter(Boolean);
  if (!words.length) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

export function TeamAvatar({
  name,
  logoUrl,
  size = "md",
}: {
  name: string;
  logoUrl?: string | null;
  size?: "sm" | "md" | "lg";
}) {
  const url = logoUrl?.trim();
  const usable = url && /^https?:\/\//i.test(url);
  return (
    <span className={`team-avatar team-avatar-${size}`} aria-hidden>
      {usable ? (
        // eslint-disable-next-line @next/next/no-img-element -- remote ESPN uploads, no known host list
        <img src={url} alt="" loading="lazy" />
      ) : (
        <span className="team-avatar-monogram">{teamMonogram(name)}</span>
      )}
    </span>
  );
}

/** Avatar + linked name, the pairing used in every table and card. */
export function TeamIdentity({
  name,
  logoUrl,
  size = "sm",
  children,
}: {
  name: string;
  logoUrl?: string | null;
  size?: "sm" | "md" | "lg";
  /** The name element (usually a Link) plus any badges. */
  children: React.ReactNode;
}) {
  return (
    <span className="team-identity">
      <TeamAvatar name={name} logoUrl={logoUrl} size={size} />
      <span className="team-identity-body">{children}</span>
    </span>
  );
}
