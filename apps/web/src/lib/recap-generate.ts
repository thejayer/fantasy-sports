/**
 * Orchestrate a weekly recap write: facts → LLM (or template) → disk.
 */

import type { LeagueSnapshot } from "@/lib/data";
import {
  recapFactsFromLeague,
  recapFactsHash,
  validateRecapAgainstFacts,
  writeTemplateRecap,
  type RecapArticle,
  type RecapFacts,
} from "@/lib/recap";
import {
  generateRecapWithLlm,
  recapExpensiveModelError,
  recapLlmConfigFromEnv,
  type RecapLlmConfig,
} from "@/lib/recap-llm";
import { writeRecap, readRecap } from "@/lib/recap-store";
import {
  recapUsageLimitsFromEnv,
  reserveRecapLlmCall,
} from "@/lib/recap-usage";
import { recapStyleFromEnv, type RecapLlmStyle } from "@/lib/recap-voice";

export type GenerateRecapResult =
  | { ok: true; article: RecapArticle }
  | { ok: false; error: string; status: number };

export type GenerateRecapOpts = {
  allowTemplate?: boolean;
  now?: Date;
  /** Rewrite even when facts_hash matches the on-disk column. */
  force?: boolean;
  env?: Record<string, string | undefined>;
  voice?: unknown;
  note?: unknown;
  generateWithLlm?: (
    facts: RecapFacts,
    config: RecapLlmConfig,
    now?: Date,
    style?: RecapLlmStyle,
  ) => Promise<RecapArticle>;
};

export async function generateAndStoreRecap(
  league: LeagueSnapshot,
  period: number,
  opts?: GenerateRecapOpts,
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
  const env = opts?.env ?? process.env;
  const hash = recapFactsHash(facts);
  const existing = await readRecap(league.league_id, league.season, period);
  if (!opts?.force && existing?.facts_hash === hash) {
    return { ok: true, article: existing };
  }

  const llm = recapLlmConfigFromEnv(env);
  if (llm) {
    const expensive = recapExpensiveModelError(llm, env);
    if (expensive) {
      return { ok: false, status: 503, error: expensive };
    }
    const reserved = await reserveRecapLlmCall(
      league.league_id,
      league.season,
      period,
      now,
      recapUsageLimitsFromEnv(env),
    );
    if (!reserved.ok) {
      return { ok: false, status: 429, error: reserved.error };
    }
  }

  try {
    const generate = opts?.generateWithLlm ?? generateRecapWithLlm;
    const article = llm
      ? await generate(
          facts,
          llm,
          now,
          recapStyleFromEnv(env, { voice: opts?.voice, note: opts?.note }),
        )
      : opts?.allowTemplate
        ? writeTemplateRecap(facts, now)
        : null;
    if (!article) {
      return {
        ok: false,
        status: 503,
        error:
          "Recap writer is not configured. Set OPENAI_API_KEY (gpt-5.6-luna) on the hub.",
      };
    }
    const withHash: RecapArticle = { ...article, facts_hash: hash };
    const mismatch = validateRecapAgainstFacts(withHash, facts);
    if (mismatch) {
      return { ok: false, status: 502, error: mismatch };
    }
    await writeRecap(withHash);
    return { ok: true, article: withHash };
  } catch (err) {
    const message = err instanceof Error ? err.message : "recap generation failed";
    return { ok: false, status: 502, error: message };
  }
}
