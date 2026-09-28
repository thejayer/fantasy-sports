/**
 * Member face with a monogram fallback (roadmap 7.10b).
 *
 * Google Auth.js supplies `session.user.image`; after first sign-in we may also
 * persist `hub_members.image_url` so feed authors show a face for everyone who
 * has logged in. Remote hosts vary, so this uses a plain `img` (same pattern as
 * TeamAvatar) rather than `next/image`.
 */

import { teamMonogram } from "@/components/TeamAvatar";

export function MemberAvatar({
  name,
  imageUrl,
  size = "md",
}: {
  name: string;
  imageUrl?: string | null;
  size?: "sm" | "md" | "lg";
}) {
  const url = imageUrl?.trim();
  const usable = url && /^https:\/\//i.test(url);
  const label = name.trim() || "Member";
  return (
    <span className={`member-avatar member-avatar-${size}`} aria-hidden>
      {usable ? (
        // eslint-disable-next-line @next/next/no-img-element -- Google / arbitrary avatar hosts
        <img src={url} alt="" loading="lazy" referrerPolicy="no-referrer" />
      ) : (
        <span className="member-avatar-monogram">{teamMonogram(label)}</span>
      )}
    </span>
  );
}
