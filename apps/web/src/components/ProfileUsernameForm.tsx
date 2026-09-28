"use client";

import { useState } from "react";

import {
  DISPLAY_NAME_MAX,
  DISPLAY_NAME_MIN,
} from "@/lib/hub-members";

export function ProfileUsernameForm({
  initialUsername,
  googleName,
}: {
  initialUsername: string | null;
  googleName: string | null;
}) {
  const [value, setValue] = useState(initialUsername ?? "");
  const [saved, setSaved] = useState(initialUsername ?? "");
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
        body: JSON.stringify({ display_name: value }),
      });
      const payload = (await res.json()) as {
        display_name?: string | null;
        error?: string;
      };
      if (!res.ok) throw new Error(payload.error || "save failed");
      const next = payload.display_name ?? "";
      setSaved(next);
      setValue(next);
      setOk(next ? "Username saved." : "Username cleared — using your Google name.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "save failed");
    } finally {
      setBusy(false);
    }
  }

  const dirty = value.trim() !== saved.trim();

  return (
    <form className="profile-username-form" onSubmit={onSubmit}>
      <label>
        <span className="profile-field-label">Username</span>
        <input
          type="text"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setOk(null);
          }}
          minLength={DISPLAY_NAME_MIN}
          maxLength={DISPLAY_NAME_MAX}
          placeholder={googleName || "Your display name"}
          autoComplete="nickname"
          disabled={busy}
        />
      </label>
      <p className="league-meta">
        Shown on feed comments, reactions, and your public profile URL.{" "}
        {DISPLAY_NAME_MIN}–{DISPLAY_NAME_MAX} characters; must be unique.
        Leave blank to use your Google name
        {googleName ? ` (${googleName})` : ""}.
      </p>
      <div className="cta-row profile-username-actions">
        <button className="button" type="submit" disabled={busy || !dirty}>
          {busy ? "Saving…" : "Save username"}
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
