/**
 * LLM columnist for weekly recaps (roadmap 7.15).
 *
 * Called from the admin POST route only — never from a page GET.
 * Facts are the only allowed numbers; the model supplies jokes.
 * Default path is cheap: OpenAI gpt-5.6-luna, reasoning off, short output.
 */

import {
  parseRecapArticle,
  recapFactsHash,
  validateRecapAgainstFacts,
  type RecapArticle,
  type RecapFacts,
} from "@/lib/recap";

export const DEFAULT_OPENAI_RECAP_MODEL = "gpt-5.6-luna";
export const DEFAULT_ANTHROPIC_RECAP_MODEL = "claude-3-5-haiku-latest";
export const RECAP_MAX_OUTPUT_TOKENS = 900;

const CHEAP_OPENAI_EXACT = new Set([
  "gpt-5.6-luna",
  "gpt-4.1-mini",
  "gpt-4.1-nano",
  "gpt-4o-mini",
]);

export type RecapLlmConfig = {
  provider: "anthropic" | "openai";
  apiKey: string;
  model: string;
};

export function isCheapRecapModel(
  provider: "openai" | "anthropic",
  model: string,
): boolean {
  const normalized = model.trim().toLowerCase();
  if (!normalized) return false;
  if (provider === "openai") {
    if (normalized.startsWith("gpt-5.6-luna")) return true;
    return CHEAP_OPENAI_EXACT.has(normalized);
  }
  return normalized.includes("haiku");
}

export function recapAllowsExpensiveModel(
  env: Record<string, string | undefined> = process.env,
): boolean {
  const raw = (env.SJ_RECAP_ALLOW_EXPENSIVE ?? "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

export function recapExpensiveModelError(
  config: RecapLlmConfig,
  env: Record<string, string | undefined> = process.env,
): string | null {
  if (isCheapRecapModel(config.provider, config.model)) return null;
  if (recapAllowsExpensiveModel(env)) return null;
  return `Model ${config.model} is not on the cheap recap allowlist (gpt-5.6-luna / 4.1-mini / Haiku). Set SJ_RECAP_MODEL=${DEFAULT_OPENAI_RECAP_MODEL} or SJ_RECAP_ALLOW_EXPENSIVE=1.`;
}

export function recapLlmConfigFromEnv(
  env: Record<string, string | undefined> = process.env,
): RecapLlmConfig | null {
  const providerRaw = (env.SJ_RECAP_PROVIDER ?? "").trim().toLowerCase();
  const anthropicKey = (env.ANTHROPIC_API_KEY ?? env.SJ_RECAP_API_KEY ?? "").trim();
  const openaiKey = (env.OPENAI_API_KEY ?? "").trim();
  if (providerRaw === "anthropic" && anthropicKey) {
    return {
      provider: "anthropic",
      apiKey: anthropicKey,
      model: env.SJ_RECAP_MODEL?.trim() || DEFAULT_ANTHROPIC_RECAP_MODEL,
    };
  }
  if (openaiKey && providerRaw !== "anthropic") {
    return {
      provider: "openai",
      apiKey: openaiKey,
      model: env.SJ_RECAP_MODEL?.trim() || DEFAULT_OPENAI_RECAP_MODEL,
    };
  }
  if (anthropicKey) {
    return {
      provider: "anthropic",
      apiKey: anthropicKey,
      model: env.SJ_RECAP_MODEL?.trim() || DEFAULT_ANTHROPIC_RECAP_MODEL,
    };
  }
  return null;
}

function factsPrompt(facts: RecapFacts): string {
  return `You are the Strictly Jayers house columnist. Write a funny weekly power-rankings recap for one fantasy league.

Rules:
- Use ONLY the facts JSON below. Do not invent scores, records, or transactions.
- Tone: intramural roast, not a press release. Short sentences. No hashtags. No "in a thrilling contest".
- Power ranking blurbs must include every team_id from facts.rankings, one each.
- Return JSON only, no markdown fence.
- Body: 2 to 5 short paragraphs.

Output shape:
{"headline":"max 120 chars","dek":"one-sentence lede, max 280 chars","body":["paragraphs"],"ranking_copy":[{"team_id":1,"blurb":"one or two sentences"}]}

Facts:
${JSON.stringify(facts)}`;
}

function extractJsonObject(text: string): unknown {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1].trim() : trimmed;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) {
    throw new Error("model did not return JSON");
  }
  return JSON.parse(candidate.slice(start, end + 1));
}

async function completeAnthropic(
  config: RecapLlmConfig,
  prompt: string,
): Promise<string> {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": config.apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: config.model,
      max_tokens: RECAP_MAX_OUTPUT_TOKENS,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 180);
    throw new Error(`Anthropic ${response.status}${detail ? `: ${detail}` : ""}`);
  }
  const data = (await response.json()) as {
    content?: Array<{ type?: string; text?: string }>;
  };
  const text = data.content?.find((block) => block.type === "text")?.text;
  if (!text) throw new Error("Anthropic returned no text");
  return text;
}

export function openaiRecapRequestBody(
  config: RecapLlmConfig,
  prompt: string,
): Record<string, unknown> {
  const gpt5 = config.model.toLowerCase().includes("gpt-5");
  const body: Record<string, unknown> = {
    model: config.model,
    max_completion_tokens: RECAP_MAX_OUTPUT_TOKENS,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: "Return only a JSON object matching the requested shape.",
      },
      { role: "user", content: prompt },
    ],
  };
  if (gpt5) {
    // Hidden reasoning tokens are billed as output; keep Luna on none.
    body.reasoning_effort = "none";
  } else {
    body.temperature = 0.8;
  }
  return body;
}

async function completeOpenAi(
  config: RecapLlmConfig,
  prompt: string,
): Promise<string> {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify(openaiRecapRequestBody(config, prompt)),
  });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 180);
    throw new Error(`OpenAI ${response.status}${detail ? `: ${detail}` : ""}`);
  }
  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new Error("OpenAI returned no text");
  return text;
}

export async function generateRecapWithLlm(
  facts: RecapFacts,
  config: RecapLlmConfig,
  now = new Date(),
): Promise<RecapArticle> {
  const prompt = factsPrompt(facts);
  const text =
    config.provider === "anthropic"
      ? await completeAnthropic(config, prompt)
      : await completeOpenAi(config, prompt);
  return recapArticleFromModelJson(
    facts,
    extractJsonObject(text),
    `${config.provider}/${config.model}`,
    now,
  );
}

/** Trusted identity/model fields always win over model JSON. */
export function recapArticleFromModelJson(
  facts: RecapFacts,
  raw: unknown,
  modelLabel: string,
  now = new Date(),
): RecapArticle {
  const payload =
    raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const parsed = parseRecapArticle({
    ...payload,
    schema_version: 1,
    league_id: facts.leagueId,
    season: facts.season,
    period: facts.period,
    sport: facts.sport,
    generated_at: now.toISOString(),
    model: modelLabel,
    facts_hash: recapFactsHash(facts),
  });
  if (!parsed) throw new Error("model JSON failed recap schema");
  const mismatch = validateRecapAgainstFacts(parsed, facts);
  if (mismatch) throw new Error(mismatch);
  return parsed;
}
