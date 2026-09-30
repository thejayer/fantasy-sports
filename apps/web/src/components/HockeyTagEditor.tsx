"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { LINE_TAGS, LIST_TAGS, NOTE_MAX, PP_TAGS, type PlayerPref } from "@/lib/member-prefs";

export type TagOption = { espnId: string; label: string };

/** Pick a player, set your tags + note, save (HOCKEY-PORT.md H8). */
export function HockeyTagEditor({
  leagueId,
  options,
  current,
  initialId,
}: {
  leagueId: string;
  options: TagOption[];
  current: Record<string, PlayerPref>;
  initialId?: string | null;
}) {
  const router = useRouter();
  const [espnId, setEspnId] = useState(initialId && options.some((o) => o.espnId === initialId) ? initialId : "");
  const pref = current[espnId];
  const [pp, setPp] = useState<string>(pref?.tags.find((t) => (PP_TAGS as readonly string[]).includes(t)) ?? "");
  const [line, setLine] = useState<string>(pref?.tags.find((t) => (LINE_TAGS as readonly string[]).includes(t)) ?? "");
  const [lists, setLists] = useState<string[]>(pref?.tags.filter((t) => (LIST_TAGS as readonly string[]).includes(t)) ?? []);
  const [note, setNote] = useState(pref?.note ?? "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function pick(id: string) {
    setEspnId(id);
    const p = current[id];
    setPp(p?.tags.find((t) => (PP_TAGS as readonly string[]).includes(t)) ?? "");
    setLine(p?.tags.find((t) => (LINE_TAGS as readonly string[]).includes(t)) ?? "");
    setLists(p?.tags.filter((t) => (LIST_TAGS as readonly string[]).includes(t)) ?? []);
    setNote(p?.note ?? "");
    setMessage(null);
    setError(null);
  }

  async function save(clear = false) {
    if (!espnId) return;
    setBusy(true);
    setMessage(null);
    setError(null);
    try {
      const tags = clear ? [] : [pp, line, ...lists].filter(Boolean);
      const res = await fetch(`/api/leagues/${leagueId}/member-prefs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ espn_id: espnId, tags, note: clear ? "" : note }),
      });
      const payload = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(payload.error || `Save failed (${res.status})`);
        return;
      }
      if (clear) pick(espnId);
      setMessage(clear ? "Tags cleared." : "Saved.");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel tag-editor">
      <label>
        Player{" "}
        <select value={espnId} onChange={(e) => pick(e.target.value)}>
          <option value="">Pick a player</option>
          {options.map((o) => (
            <option key={o.espnId} value={o.espnId}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      <fieldset disabled={!espnId || busy}>
        <label>
          Power play{" "}
          <select value={pp} onChange={(e) => setPp(e.target.value)}>
            <option value="">Automatic</option>
            {PP_TAGS.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </label>{" "}
        <label>
          Role{" "}
          <select value={line} onChange={(e) => setLine(e.target.value)}>
            <option value="">Automatic</option>
            {LINE_TAGS.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </label>{" "}
        {LIST_TAGS.map((t) => (
          <label key={t} className="tag-check">
            <input
              type="checkbox"
              checked={lists.includes(t)}
              onChange={(e) => setLists(e.target.checked ? [...lists, t] : lists.filter((x) => x !== t))}
            />{" "}
            {t === "Keep" ? "Keep (never drop)" : "Watch"}
          </label>
        ))}
        <label className="tag-note">
          Note{" "}
          <input
            type="text"
            value={note}
            maxLength={NOTE_MAX}
            placeholder="Only you see this"
            onChange={(e) => setNote(e.target.value)}
          />
        </label>
        <button type="button" className="button" onClick={() => void save()}>
          {busy ? "Saving…" : "Save"}
        </button>{" "}
        {current[espnId] ? (
          <button type="button" className="button secondary" onClick={() => void save(true)}>
            Clear tags
          </button>
        ) : null}
      </fieldset>
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      {message ? (
        <p className="league-meta" role="status">
          {message}
        </p>
      ) : null}
    </div>
  );
}
