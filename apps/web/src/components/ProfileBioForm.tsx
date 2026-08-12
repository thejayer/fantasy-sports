"use client";

import { useState } from "react";

import {
  BIO_MAX,
  bioCharCount,
  clampBioInput,
} from "@/lib/hub-members";

export function ProfileBioForm({ initialBio }: { initialBio: string | null }) {
  const [value, setValue] = useState(initialBio ?? "");
  const [saved, setSaved] = useState(initialBio ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setOk(null);
    try {
      const res = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ bio: value }),
      });
      const payload = (await res.json()) as {
        bio?: string | null;
        error?: string;
      };
      if (!res.ok) throw new Error(payload.error || "save failed");
      const next = payload.bio ?? "";
      setSaved(next);
      setValue(next);
      setOk(next ? "Bio saved." : "Bio cleared.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "save failed");
    } finally {
      setBusy(false);
    }
  }

  const dirty = value.trim() !== saved.trim();
  const remaining = BIO_MAX - bioCharCount(value);

  return (
    <form className="profile-username-form profile-bio-form" onSubmit={onSubmit}>
      <label>
        <span className="profile-field-label">Bio</span>
        <textarea
          value={value}
          onChange={(e) => {
            setValue(clampBioInput(e.target.value));
            setOk(null);
          }}
          rows={3}
          placeholder="A short line about you — rivalries, catchphrases, draft-day lore…"
          disabled={busy}
        />
      </label>
      <p className="league-meta">
        Shown on your public profile. Up to {BIO_MAX} characters
        {remaining < 40 ? ` (${Math.max(0, remaining)} left)` : ""}.
      </p>
      <div className="cta-row profile-username-actions">
        <button className="button" type="submit" disabled={busy || !dirty}>
          {busy ? "Saving…" : "Save bio"}
        </button>
        {saved ? (
          <button
            className="button secondary"
            type="button"
            disabled={busy}
            onClick={() => {
              setValue("");
              setOk(null);
            }}
          >
            Clear
          </button>
        ) : null}
      </div>
      {error ? (
        <p className="league-meta" role="alert">
          {error}
        </p>
      ) : null}
      {ok ? <p className="league-meta">{ok}</p> : null}
    </form>
  );
}
