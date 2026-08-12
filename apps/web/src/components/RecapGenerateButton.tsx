"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { RECAP_VOICES, type RecapVoice } from "@/lib/recap-voice";

const VOICE_LABEL: Record<RecapVoice, string> = {
  roast: "Roast",
  mild: "Mild",
  savage: "Savage",
};

export function RecapGenerateButton({
  leagueId,
  season,
  period,
  hasArticle,
  defaultVoice = "roast",
}: {
  leagueId: string;
  season: number;
  period: number;
  hasArticle: boolean;
  defaultVoice?: RecapVoice;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [voice, setVoice] = useState<RecapVoice>(defaultVoice);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/leagues/${leagueId}/recap`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ season, period, force: hasArticle, voice }),
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
      <label className="recap-voice">
        Voice
        <select
          value={voice}
          disabled={busy}
          onChange={(event) => setVoice(event.target.value as RecapVoice)}
        >
          {RECAP_VOICES.map((id) => (
            <option key={id} value={id}>
              {VOICE_LABEL[id]}
            </option>
          ))}
        </select>
      </label>
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
