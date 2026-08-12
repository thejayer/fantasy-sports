/**
 * House columnist voice for weekly recaps (roadmap 7.15).
 *
 * Facts stay in the digest JSON. Voice only changes how the model needles
 * those numbers — roast (default), mild, or savage.
 */

import type { RecapFacts } from "@/lib/recap";

export const RECAP_VOICES = ["roast", "mild", "savage"] as const;
export type RecapVoice = (typeof RECAP_VOICES)[number];

export type RecapLlmStyle = {
  voice: RecapVoice;
  note?: string;
};

const VOICE_SET = new Set<string>(RECAP_VOICES);

export function parseRecapVoice(raw: unknown): RecapVoice | null {
  if (typeof raw !== "string") return null;
  const normalized = raw.trim().toLowerCase();
  return VOICE_SET.has(normalized) ? (normalized as RecapVoice) : null;
}

export function recapVoiceFromEnv(
  env: Record<string, string | undefined> = process.env,
): RecapVoice {
  return parseRecapVoice(env.SJ_RECAP_VOICE) ?? "roast";
}

export function recapVoiceNoteFromEnv(
  env: Record<string, string | undefined> = process.env,
): string | undefined {
  const note = (env.SJ_RECAP_VOICE_NOTE ?? "").replace(/\s+/g, " ").trim();
  if (!note) return undefined;
  return note.length <= 280 ? note : `${note.slice(0, 279).trimEnd()}…`;
}

export function recapStyleFromEnv(
  env: Record<string, string | undefined> = process.env,
  override?: { voice?: unknown; note?: unknown },
): RecapLlmStyle {
  const voice = parseRecapVoice(override?.voice) ?? recapVoiceFromEnv(env);
  const note =
    typeof override?.note === "string" && override.note.trim()
      ? override.note.replace(/\s+/g, " ").trim().slice(0, 280)
      : recapVoiceNoteFromEnv(env);
  return note ? { voice, note } : { voice };
}

const SHARED_RULES = `Rules:
- Use ONLY the facts JSON. Do not invent scores, records, ranks, or transactions.
- Every joke must cite a real number, award, or ranking from the facts (a score, margin, record, all-play %, PF, or award detail). If you cannot roast it with a fact, skip the joke.
- Belittle the performance, never the person: no slurs, no body/identity jokes, no real-life insults.
- Winners get a needle too when the facts support it (lucky award, ugly win, prior-week hangover).
- Short sentences. No hashtags. No "in a thrilling contest", "battle-tested", "statement win", or press-release verbs.
- ranking_copy: one row per facts.rankings team_id, no extras, no missing.
- Body: 2 to 5 short paragraphs. Headline max 120 chars. Dek max 280 chars.
- Return JSON only, no markdown fence.

Output shape:
{"headline":"max 120 chars","dek":"one-sentence lede, max 280 chars","body":["paragraphs"],"ranking_copy":[{"team_id":1,"blurb":"one or two sentences"}]}`;

const VOICE_COPY: Record<RecapVoice, string> = {
  roast: `Voice: intramural roast for a friend-group league. Fun, specific, occasionally belittling — the group chat after a blowout, not a sports radio hot take. Punch the blowout loser and the lucky winner hardest. Mid-table gets a shrug with their all-play %. Cellar gets one clean shot using their record or PF, then move on. Do not roast every team at the same volume.`,
  mild: `Voice: warm intramural recap. Light ribbing only. Still hang jokes on real scores. No contempt, no pile-ons. Celebrate the high score without turning the loser into a bit.`,
  savage: `Voice: same fact rules, sharper knife. Belittle bad lineups, lucky wins, and last place with their actual numbers. One contemptuous line per ranking_copy row is enough. Still no slurs or identity jokes. Do not invent a collapse that the scores do not show.`,
};

export function recapColumnistSystem(style: RecapLlmStyle): string {
  const note = style.note
    ? ` House note (flavor only, not new facts): ${style.note}`
    : "";
  return `You are the Strictly Jayers house columnist. Return only a JSON object matching the requested shape. ${VOICE_COPY[style.voice]}${note}`;
}

export function recapColumnistPrompt(
  facts: RecapFacts,
  style: RecapLlmStyle,
): string {
  const note = style.note
    ? `\nHouse note (flavor only, not new facts): ${style.note}\n`
    : "";
  return `Write a weekly power-rankings recap for one fantasy league.

${VOICE_COPY[style.voice]}
${note}
${SHARED_RULES}

Facts:
${JSON.stringify(facts)}`;
}
