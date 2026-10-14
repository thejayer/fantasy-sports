"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Remote team crest that falls back to the monogram when the image fails
 * (dead ESPN upload / 403), so standings never show an empty broken circle.
 * The effect also catches loads that failed before hydration attached onError.
 * Failure is keyed by `src` so a new URL remounts the image instead of staying
 * on the monogram (avoids setState-in-effect reset lint).
 */
export function TeamLogoImg({ src, monogram }: { src: string; monogram: string }) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const ref = useRef<HTMLImageElement>(null);
  const failed = failedSrc === src;

  useEffect(() => {
    const img = ref.current;
    if (img && img.complete && img.naturalWidth === 0) setFailedSrc(src);
  }, [src]);

  if (failed) {
    return <span className="team-avatar-monogram">{monogram}</span>;
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- remote ESPN uploads, no known host list
    <img ref={ref} src={src} alt="" loading="lazy" onError={() => setFailedSrc(src)} />
  );
}
