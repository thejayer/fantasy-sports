"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function RecapGenerateButton({
  leagueId,
  season,
  period,
  hasArticle,
}: {
  leagueId: string;
  season: number;
  period: number;
  hasArticle: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/leagues/${leagueId}/recap`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ season, period, force: hasArticle }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        error?: string;
      };
      if (!response.ok) {
        setError(data.error ?? `Could not write recap (${response.status})`);
        return;
      }
      router.refresh();
    } catch {
      setError("Could not reach the recap writer.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <p className="league-meta recap-admin">
      <button
        type="button"
        className="button secondary"
        disabled={busy}
        onClick={() => void run()}
      >
        {busy
          ? "Writing…"
          : hasArticle
            ? "Rewrite this week"
            : "Write this week’s recap"}
      </button>
      {error ? <span className="recap-admin-error">{error}</span> : null}
    </p>
  );
}
