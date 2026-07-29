import Link from "next/link";
import { CreateGolfLeagueForm } from "@/components/CreateGolfLeagueForm";

export const dynamic = "force-dynamic";

export default function NewLeaguePage() {
  return (
    <main className="section">
      <p className="league-meta">
        <Link href="/leagues">← Leagues</Link>
      </p>
      <h2>Create golf league</h2>
      <p className="lede">
        Private PGA Tour fantasy with the LIV real-team counting model. Pick
        format, snake or auction draft (optional keepers + budget), roster
        depth, missed-cut alts, and multipliers — create seeds draft, lineups,
        scoreboard, and standings.
      </p>
      <CreateGolfLeagueForm />
    </main>
  );
}
