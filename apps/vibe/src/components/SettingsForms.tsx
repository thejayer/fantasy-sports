"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Props = {
  bufferMinutes: number;
  timezone: string;
  tokenPrefix: string | null;
  githubLogin: string | null;
  githubKind: string | null;
  lastSync: string | null;
  lastError: string | null;
  oauthConfigured: boolean;
};

export function SettingsForms(props: Props) {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [pat, setPat] = useState("");

  async function saveSettings(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const res = await fetch("/api/settings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        buffer_minutes: Number(form.get("buffer_minutes")),
        timezone: String(form.get("timezone")),
      }),
    });
    setStatus(res.ok ? "Saved buffer and timezone." : "Could not save settings.");
    router.refresh();
  }

  async function rotateToken() {
    const res = await fetch("/api/token", { method: "POST" });
    const body = (await res.json()) as { token?: string; error?: string };
    if (body.token) {
      setToken(body.token);
      setStatus("New ingest token created. Copy it now — it is not stored in plain text.");
      router.refresh();
    } else {
      setStatus(body.error || "Could not rotate token.");
    }
  }

  async function savePat(event: React.FormEvent) {
    event.preventDefault();
    const res = await fetch("/api/github/pat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: pat }),
    });
    const body = (await res.json()) as { login?: string; error?: string };
    setStatus(
      res.ok
        ? `GitHub connected as ${body.login}.`
        : body.error || "PAT was rejected.",
    );
    setPat("");
    router.refresh();
  }

  async function syncNow() {
    const res = await fetch("/api/github/sync", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ force: true }),
    });
    const body = (await res.json()) as {
      github?: { last_sync_error?: string | null };
    };
    setStatus(
      body.github?.last_sync_error ||
        (res.ok ? "GitHub sync finished." : "Sync failed."),
    );
    router.refresh();
  }

  async function disconnect() {
    await fetch("/api/github/disconnect", { method: "POST" });
    setStatus("GitHub disconnected.");
    router.refresh();
  }

  async function wipe() {
    if (!window.confirm("Delete all Vibe Split data for this account?")) return;
    await fetch("/api/delete", { method: "POST" });
    setStatus("Data deleted.");
    router.refresh();
  }

  async function upload(path: string, file: File) {
    const form = new FormData();
    form.set("file", file);
    const res = await fetch(path, { method: "POST", body: form });
    const body = (await res.json()) as { added?: number; error?: string };
    setStatus(
      res.ok
        ? `Imported ${body.added ?? 0} new rows.`
        : body.error || "Upload failed.",
    );
    router.refresh();
  }

  return (
    <div className="form-grid">
      {status ? <p className="lede">{status}</p> : null}

      <form className="card form-grid" onSubmit={saveSettings}>
        <h2>Overlap</h2>
        <label>
          Buffer minutes (0–60)
          <input
            name="buffer_minutes"
            type="number"
            min={0}
            max={60}
            defaultValue={props.bufferMinutes}
          />
        </label>
        <label>
          Timezone
          <input name="timezone" defaultValue={props.timezone} />
        </label>
        <button className="btn" type="submit">
          Save
        </button>
      </form>

      <section className="card form-grid">
        <h2>Health Auto Export token</h2>
        <p className="muted">
          Stored as a hash only. Header:{" "}
          <code>Authorization: Bearer &lt;token&gt;</code> or{" "}
          <code>X-Vibe-Token</code>.
        </p>
        {props.tokenPrefix ? (
          <p className="muted">Current prefix: {props.tokenPrefix}…</p>
        ) : (
          <p className="muted">No token yet.</p>
        )}
        {token ? (
          <div className="token-box">
            <code>{token}</code>
            <button
              className="btn"
              type="button"
              onClick={() => void navigator.clipboard.writeText(token)}
            >
              Copy
            </button>
          </div>
        ) : null}
        <button className="btn btn-accent" type="button" onClick={() => void rotateToken()}>
          {props.tokenPrefix ? "Rotate token" : "Create token"}
        </button>
      </section>

      <section className="card form-grid">
        <h2>GitHub</h2>
        <p className="muted">
          {props.githubLogin
            ? `Connected as ${props.githubLogin} (${props.githubKind ?? "token"}).`
            : "Not connected."}{" "}
          Last sync: {props.lastSync ?? "never"}
          {props.lastError ? ` · ${props.lastError}` : ""}
        </p>
        {props.oauthConfigured ? (
          <a className="btn" href="/api/github/connect">
            Connect with GitHub
          </a>
        ) : (
          <p className="muted">
            OAuth app is not configured on this host. Paste a fine-grained PAT
            with Contents: Read and Metadata: Read.
          </p>
        )}
        <form className="form-grid" onSubmit={savePat}>
          <label>
            Fine-grained PAT
            <input
              type="password"
              value={pat}
              onChange={(event) => setPat(event.target.value)}
              placeholder="github_pat_…"
            />
          </label>
          <button className="btn" type="submit">
            Save PAT
          </button>
        </form>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button className="btn" type="button" onClick={() => void syncNow()}>
            Sync now
          </button>
          <button className="btn" type="button" onClick={() => void disconnect()}>
            Disconnect
          </button>
        </div>
      </section>

      <section className="card form-grid">
        <h2>Upload fallbacks</h2>
        <label>
          Apple Health export.xml / export.zip
          <input
            type="file"
            accept=".xml,.zip"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void upload("/api/upload/health", file);
            }}
          />
        </label>
        <label>
          Hevy-style CSV (start, end, type)
          <input
            type="file"
            accept=".csv,text/csv"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void upload("/api/upload/hevy", file);
            }}
          />
        </label>
      </section>

      <section className="card form-grid">
        <h2>Danger</h2>
        <button className="btn" type="button" onClick={() => void wipe()}>
          Delete my Vibe data
        </button>
      </section>
    </div>
  );
}
