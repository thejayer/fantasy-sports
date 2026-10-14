"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/** Avatar override (HTTPS image URL) saved to hub_members.json via /api/profile. */
export function ProfileAvatarForm({ initialUrl }: { initialUrl: string | null }) {
  const router = useRouter();
  const [value, setValue] = useState(initialUrl ?? "");
  const [saved, setSaved] = useState(initialUrl ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  async function save(next: string) {
    setBusy(true);
    setError(null);
    setOk(null);
    try {
      const res = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ avatar_url: next }),
      });
      const payload = (await res.json()) as {
        avatar_url?: string | null;
        error?: string;
      };
      if (!res.ok) throw new Error(payload.error || "save failed");
      const stored = payload.avatar_url ?? "";
      setSaved(stored);
      setValue(stored);
      setOk(stored ? "Avatar saved." : "Avatar reset to your Google photo.");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "save failed");
    } finally {
      setBusy(false);
    }
  }

  const dirty = value.trim() !== saved.trim();

  return (
    <form
      className="profile-username-form profile-avatar-form"
      onSubmit={(event) => {
        event.preventDefault();
        void save(value.trim());
      }}
    >
      <label>
        <span className="profile-field-label">Avatar image URL</span>
        <input
          type="url"
          inputMode="url"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setOk(null);
          }}
          placeholder="https://… (leave empty to use your Google photo)"
          disabled={busy}
        />
      </label>
      <div className="cta-row profile-username-actions">
        <button className="button" type="submit" disabled={busy || !dirty}>
          {busy ? "Saving…" : "Save avatar"}
        </button>
        {saved ? (
          <button
            className="button secondary"
            type="button"
            disabled={busy}
            onClick={() => void save("")}
          >
            Use Google photo
          </button>
        ) : null}
      </div>
      {error ? <p className="league-meta" role="alert">{error}</p> : null}
      {ok ? <p className="league-meta" role="status">{ok}</p> : null}
    </form>
  );
}
