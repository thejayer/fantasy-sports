/**
 * Orchestrate a weekly recap write: facts → LLM (or template) → disk.
 */

import type { LeagueSnapshot } from "@/lib/data";
import {
  recapFactsFromLeague,
  validateRecapAgainstFacts,
  writeTemplateRecap,
  type RecapArticle,
} from "@/lib/recap";
import {
  generateRecapWithLlm,
  recapLlmConfigFromEnv,
} from "@/lib/recap-llm";
import { writeRecap } from "@/lib/recap-store";

export type GenerateRecapResult =
  | { ok: true; article: RecapArticle }
  | { ok: false; error: string; status: number };

export async function generateAndStoreRecap(
  league: LeagueSnapshot,
  period: number,
  opts?: { allowTemplate?: boolean; now?: Date },
): Promise<GenerateRecapResult> {
  const facts = recapFactsFromLeague(league, period);
  if (!facts) {
    return {
      ok: false,
      status: 409,
      error: "No decided games for that week — nothing to recap.",
    };
  }
  const now = opts?.now ?? new Date();
  const llm = recapLlmConfigFromEnv();
  try {
    const article = llm
      ? await generateRecapWithLlm(facts, llm, now)
      : opts?.allowTemplate
        ? writeTemplateRecap(facts, now)
        : null;
    if (!article) {
      return {
        ok: false,
        status: 503,
        error:
          "Recap writer is not configured. Set ANTHROPIC_API_KEY or OPENAI_API_KEY on the hub.",
      };
    }
    const mismatch = validateRecapAgainstFacts(article, facts);
    if (mismatch) {
      return { ok: false, status: 502, error: mismatch };
    }
    await writeRecap(article);
    return { ok: true, article };
  } catch (err) {
    const message = err instanceof Error ? err.message : "recap generation failed";
    return { ok: false, status: 502, error: message };
  }
}
