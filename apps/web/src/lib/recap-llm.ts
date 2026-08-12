/**
 * LLM columnist for weekly recaps (roadmap 7.15).
 *
 * Called from the admin POST route only — never from a page GET.
 * Facts are the only allowed numbers; the model supplies jokes.
 */

import {
  parseRecapArticle,
  validateRecapAgainstFacts,
  type RecapArticle,
  type RecapFacts,
} from "@/lib/recap";

export type RecapLlmConfig = {
  provider: "anthropic" | "openai";
  apiKey: string;
  model: string;
};

export function recapLlmConfigFromEnv(
  env: Record<string, string | undefined> = process.env,
): RecapLlmConfig | null {
  const providerRaw = (env.SJ_RECAP_PROVIDER ?? "").trim().toLowerCase();
  const anthropicKey = (env.ANTHROPIC_API_KEY ?? env.SJ_RECAP_API_KEY ?? "").trim();
  const openaiKey = (env.OPENAI_API_KEY ?? "").trim();
  if (providerRaw === "openai" && openaiKey) {
    return {
      provider: "openai",
      apiKey: openaiKey,
      model: env.SJ_RECAP_MODEL?.trim() || "gpt-4.1-mini",
    };
  }
  if (providerRaw === "anthropic" && anthropicKey) {
    return {
      provider: "anthropic",
      apiKey: anthropicKey,
      model: env.SJ_RECAP_MODEL?.trim() || "claude-sonnet-4-5",
    };
  }
  if (anthropicKey && providerRaw !== "openai") {
    return {
      provider: "anthropic",
      apiKey: anthropicKey,
      model: env.SJ_RECAP_MODEL?.trim() || "claude-sonnet-4-5",
    };
  }
  if (openaiKey) {
    return {
      provider: "openai",
      apiKey: openaiKey,
      model: env.SJ_RECAP_MODEL?.trim() || "gpt-4.1-mini",
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

Output shape:
{
  "headline": "string, max 120 chars",
  "dek": "one-sentence lede, max 280 chars",
  "body": ["2 to 5 short paragraphs"],
  "ranking_copy": [{"team_id": 1, "blurb": "one or two sentences"}]
}

Facts:
${JSON.stringify(facts, null, 2)}`;
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
      max_tokens: 1800,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!response.ok) {
    throw new Error(`Anthropic ${response.status}`);
  }
  const data = (await response.json()) as {
    content?: Array<{ type?: string; text?: string }>;
  };
  const text = data.content?.find((block) => block.type === "text")?.text;
  if (!text) throw new Error("Anthropic returned no text");
  return text;
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
    body: JSON.stringify({
      model: config.model,
      temperature: 0.8,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: "Return only a JSON object matching the requested shape.",
        },
        { role: "user", content: prompt },
      ],
    }),
  });
  if (!response.ok) {
    throw new Error(`OpenAI ${response.status}`);
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
  });
  if (!parsed) throw new Error("model JSON failed recap schema");
  const mismatch = validateRecapAgainstFacts(parsed, facts);
  if (mismatch) throw new Error(mismatch);
  return parsed;
}
