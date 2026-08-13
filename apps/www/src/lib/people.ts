/**
 * Curated X directory for /people (roadmap P.8).
 * Hand-edited — official profile links only, no X API.
 */

export const PEOPLE_LANES = ["builders", "ai", "sports"] as const;
export type PersonLane = (typeof PEOPLE_LANES)[number];

export type InfluentialPerson = {
  id: string;
  name: string;
  /** X handle without @ */
  handle: string;
  role: string;
  blurb: string;
  lane: PersonLane;
};

export const PEOPLE_LANE_COPY: Record<
  PersonLane,
  { heading: string; support: string; marker: string }
> = {
  builders: {
    heading: "Builders",
    support: "The people shipping the hardware and the platforms.",
    marker: "01",
  },
  ai: {
    heading: "AI desk",
    support: "Labs, models, and the takes that show up in Discord first.",
    marker: "02",
  },
  sports: {
    heading: "Sports desk",
    support: "NFL noise and golf when the hub is in season.",
    marker: "03",
  },
};

export const INFLUENTIAL_PEOPLE: readonly InfluentialPerson[] = [
  {
    id: "elon",
    name: "Elon Musk",
    handle: "elonmusk",
    role: "Tesla · SpaceX · xAI",
    blurb: "Rockets, cars, and the site the rest of this page links to.",
    lane: "builders",
  },
  {
    id: "jensen",
    name: "Jensen Huang",
    handle: "JensenHuang",
    role: "NVIDIA",
    blurb: "The leather jacket. The GPUs. The reason the AI desk has a power bill.",
    lane: "builders",
  },
  {
    id: "satya",
    name: "Satya Nadella",
    handle: "satyanadella",
    role: "Microsoft",
    blurb: "Copilot in everything. Still the grown-up in the room.",
    lane: "builders",
  },
  {
    id: "lisa-su",
    name: "Lisa Su",
    handle: "LisaSu",
    role: "AMD",
    blurb: "The other GPU house. Useful when the NVIDIA take is too loud.",
    lane: "builders",
  },
  {
    id: "zuck",
    name: "Mark Zuckerberg",
    handle: "zuck",
    role: "Meta",
    blurb: "Open-weight models and a lot of Llama. Also still Facebook.",
    lane: "builders",
  },
  {
    id: "sama",
    name: "Sam Altman",
    handle: "sama",
    role: "OpenAI",
    blurb: "ChatGPT’s commissioner. The posts everyone screenshots.",
    lane: "ai",
  },
  {
    id: "dario",
    name: "Dario Amodei",
    handle: "DarioAmodei",
    role: "Anthropic",
    blurb: "Claude’s house. Longer letters, fewer memes.",
    lane: "ai",
  },
  {
    id: "demis",
    name: "Demis Hassabis",
    handle: "demishassabis",
    role: "Google DeepMind",
    blurb: "AlphaFold, Gemini, and the science-fair energy.",
    lane: "ai",
  },
  {
    id: "karpathy",
    name: "Andrej Karpathy",
    handle: "karpathy",
    role: "Independent",
    blurb: "The lecture you actually finish. Neural nets without the press tour.",
    lane: "ai",
  },
  {
    id: "schefter",
    name: "Adam Schefter",
    handle: "AdamSchefter",
    role: "NFL",
    blurb: "The breaking-news push that ruins a Sunday roster.",
    lane: "sports",
  },
  {
    id: "yates",
    name: "Field Yates",
    handle: "FieldYates",
    role: "ESPN",
    blurb: "Draft capital and the trade chart the hub already argues about.",
    lane: "sports",
  },
  {
    id: "berry",
    name: "Matthew Berry",
    handle: "MatthewBerryTMR",
    role: "Fantasy",
    blurb: "Love/hate rankings. Still the name on the waiver-wire take.",
    lane: "sports",
  },
  {
    id: "pga",
    name: "PGA Tour",
    handle: "PGATOUR",
    role: "Golf",
    blurb: "Tee times and leaderboards when the golf league is live.",
    lane: "sports",
  },
];

const HANDLE_RE = /^[A-Za-z0-9_]{1,15}$/;

export function xProfileUrl(handle: string): string {
  const trimmed = handle.replace(/^@/, "").trim();
  return `https://x.com/${trimmed}`;
}

export function peopleByLane(
  people: readonly InfluentialPerson[] = INFLUENTIAL_PEOPLE,
): { lane: PersonLane; people: InfluentialPerson[] }[] {
  return PEOPLE_LANES.map((lane) => ({
    lane,
    people: people.filter((person) => person.lane === lane),
  })).filter((group) => group.people.length > 0);
}

export function isXHandle(handle: string): boolean {
  return HANDLE_RE.test(handle);
}
