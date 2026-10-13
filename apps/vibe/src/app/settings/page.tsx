import { redirect } from "next/navigation";

import { Chrome } from "@/components/Chrome";
import { SettingsForms } from "@/components/SettingsForms";
import { loadVibe } from "@/lib/load";
import { getVibeSiteConfig } from "@/lib/site";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const loaded = await loadVibe();
  if (!loaded) redirect("/login");
  const { document } = loaded;
  const { siteUrl } = getVibeSiteConfig();

  return (
    <Chrome current="settings">
      <main className="page">
        <p className="kicker">Settings</p>
        <h1>Hooks and knobs</h1>
        <p className="lede">
          Each member links their own Health Auto Export token and GitHub.
          Tokens are hashed. GitHub tokens are encrypted at rest.
        </p>
        <SettingsForms
          bufferMinutes={document.settings.buffer_minutes}
          timezone={document.settings.timezone}
          tokenPrefix={document.ingest.token_prefix}
          githubLogin={document.github.login}
          githubKind={document.github.token_kind}
          lastSync={document.github.last_sync_at}
          lastError={document.github.last_sync_error}
          oauthConfigured={Boolean(process.env.GITHUB_CLIENT_ID)}
        />
        <section className="help" id="hae-help">
          <h2>Health Auto Export setup</h2>
          <p>
            On iPhone, Health Auto Export → Automations → new REST API
            automation:
          </p>
          <pre>{`Automation type   REST API
Data type         Workouts
Export format     JSON
Export version    Version 2
Include routes    Off
Workout metrics   Off
Batch requests    On
URL               ${siteUrl}/api/ingest/health
Header            Authorization
Value             Bearer <your ingest token>`}</pre>
          <p className="muted">
            The app sets Content-Type. You can also send{" "}
            <code>X-Vibe-Token</code> or <code>api-key</code>. Manual Export a
            date range after the first save to backfill.
          </p>
        </section>
        <section className="help">
          <h2>Vibe Score</h2>
          <p>
            commits×1 + PRs opened×2 + PRs merged×3 + reviews×1 + comments×0.5
            + overlapping agent minutes×0.1. Lines added/removed show on the
            workout when GitHub returns them and do not change the score.
          </p>
        </section>
      </main>
    </Chrome>
  );
}
