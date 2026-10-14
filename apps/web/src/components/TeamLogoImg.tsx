"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Remote team crest that falls back to the monogram when the image fails
 * (dead ESPN upload / 403), so standings never show an empty broken circle.
 * The effect also catches loads that failed before hydration attached onError.
 */
export function TeamLogoImg({ src, monogram }: { src: string; monogram: string }) {
  const [failed, setFailed] = useState(false);
  const ref = useRef<HTMLImageElement>(null);

  useEffect(() => {
    setFailed(false);
    const img = ref.current;
    if (img && img.complete && img.naturalWidth === 0) setFailed(true);
  }, [src]);

  if (failed) {
    return <span className="team-avatar-monogram">{monogram}</span>;
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- remote ESPN uploads, no known host list
    <img ref={ref} src={src} alt="" loading="lazy" onError={() => setFailed(true)} />
  );
}
