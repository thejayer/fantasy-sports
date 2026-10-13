"use client";

import { useEffect, useRef } from "react";

export function GitHubRefresh({ stale }: { stale: boolean }) {
  const ran = useRef(false);
  useEffect(() => {
    if (!stale || ran.current) return;
    ran.current = true;
    void fetch("/api/github/sync", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ force: false }),
    });
  }, [stale]);
  return null;
}
