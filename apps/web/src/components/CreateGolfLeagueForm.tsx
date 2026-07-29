"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import {
  GOLF_DEFAULT_BENCH,
  GOLF_MAX_BENCH,
  GOLF_MAX_TEAMS,
  GOLF_MIN_BENCH,
  GOLF_MIN_TEAMS,
} from "@/lib/golf";

const CURRENT_YEAR = new Date().getFullYear();

export function CreateGolfLeagueForm() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const form = new FormData(event.currentTarget);
    const body = {
      league_id: String(form.get("league_id") ?? "").trim(),
      name: String(form.get("name") ?? "").trim(),
      short_name: String(form.get("short_name") ?? "").trim() || undefined,
      season: Number(form.get("season")),
      format: String(form.get("format")),
      team_count: Number(form.get("team_count")),
      bench: Number(form.get("bench")),
      missed_cut: String(form.get("missed_cut")),
      draft_style: String(form.get("draft_style")),
      keepers: form.get("keepers") === "on",
      multipliers: {
        regular: Number(form.get("mult_regular")),
        signature: Number(form.get("mult_signature")),
        major: Number(form.get("mult_major")),
      },
    };

    startTransition(async () => {
      const res = await fetch("/api/golf/leagues", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = (await res.json().catch(() => ({}))) as {
        error?: string;
        league_id?: string;
      };
      if (!res.ok) {
        setError(payload.error || `Create failed (${res.status})`);
        return;
      }
      router.push(`/leagues/${payload.league_id}?tab=settings`);
      router.refresh();
    });
  }

  return (
    <form className="settings-form" onSubmit={onSubmit}>
      <div className="form-grid">
        <label>
          League id
          <input
            name="league_id"
            required
            pattern="[a-z][a-z0-9-]{1,40}"
            placeholder="golf-office"
            defaultValue="golf-office"
          />
        </label>
        <label>
          Display name
          <input
            name="name"
            required
            placeholder="Office Golf"
            defaultValue="Office Golf"
          />
        </label>
        <label>
          Short name
          <input name="short_name" placeholder="Golf" />
        </label>
        <label>
          Season
          <input
            name="season"
            type="number"
            required
            defaultValue={CURRENT_YEAR}
          />
        </label>
        <label>
          Format
          <select name="format" defaultValue="h2h">
            <option value="h2h">Head-to-head</option>
            <option value="season_points">Season points</option>
          </select>
        </label>
        <label>
          Teams ({GOLF_MIN_TEAMS}–{GOLF_MAX_TEAMS})
          <input
            name="team_count"
            type="number"
            min={GOLF_MIN_TEAMS}
            max={GOLF_MAX_TEAMS}
            defaultValue={10}
            required
          />
        </label>
        <label>
          Bench size ({GOLF_MIN_BENCH}–{GOLF_MAX_BENCH})
          <input
            name="bench"
            type="number"
            min={GOLF_MIN_BENCH}
            max={GOLF_MAX_BENCH}
            defaultValue={GOLF_DEFAULT_BENCH}
            required
          />
        </label>
        <label>
          Missed cut / WD
          <select name="missed_cut" defaultValue="alt1">
            <option value="off">Off</option>
            <option value="alt1">Alt1 weekend</option>
            <option value="alt1_2">Alt1 + Alt2 weekend</option>
          </select>
        </label>
        <label>
          Draft style
          <select name="draft_style" defaultValue="snake">
            <option value="snake">Snake</option>
            <option value="auction">Auction (later)</option>
          </select>
        </label>
        <label className="form-check">
          <input name="keepers" type="checkbox" />
          Keepers (default off)
        </label>
        <label>
          Regular multiplier
          <input
            name="mult_regular"
            type="number"
            step="0.1"
            min="0.1"
            defaultValue={1}
            required
          />
        </label>
        <label>
          Signature multiplier
          <input
            name="mult_signature"
            type="number"
            step="0.1"
            min="0.1"
            defaultValue={1.5}
            required
          />
        </label>
        <label>
          Major multiplier
          <input
            name="mult_major"
            type="number"
            step="0.1"
            min="0.1"
            defaultValue={2}
            required
          />
        </label>
      </div>

      <p className="league-meta">
        Creates teams, runs a snake draft over the synthetic OWGR pool (5 GS +
        bench), and writes under the local store (<code>data/sj</code>). Tour
        scoring and weekly lineups come later.
      </p>

      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}

      <button className="button" type="submit" disabled={pending}>
        {pending ? "Creating…" : "Create golf league"}
      </button>
    </form>
  );
}
