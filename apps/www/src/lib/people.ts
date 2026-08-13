/**
 * Curated X directory for /people (roadmap P.8).
 * Hand-edited — official profile links only, no X API.
 * Portraits are committed under /public/people (Wikimedia Commons); no runtime fetch.
 */

export const PEOPLE_LANES = ["builders", "ai", "sports"] as const;
export type PersonLane = (typeof PEOPLE_LANES)[number];

export type InfluentialPerson = {
  id: string;
  name: string;
  /** X handle without @ */
  handle: string;
  role: string;
  /** Two–three sentence bio for the leadership card. */
  bio: string;
  lane: PersonLane;
  /** Static path under apps/www/public, e.g. /people/elon.jpg */
  photo?: string;
  /** Short photographer / source line (required when photo is set). */
  photoCredit?: string;
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
    bio: "Founder of SpaceX and Tesla, and the owner of X. Posts on rockets, cars, AI, and whatever else is on fire that hour. The account the rest of this page is built around.",
    lane: "builders",
    photo: "/people/elon.jpg",
    photoCredit: "Gage Skidmore / Wikimedia Commons (CC BY-SA 4.0)",
  },
  {
    id: "jensen",
    name: "Jensen Huang",
    handle: "JensenHuang",
    role: "NVIDIA",
    bio: "Founder and CEO of NVIDIA. The GPUs under every major AI lab, and the leather jacket at every keynote. If the AI desk has a power bill, this is why.",
    lane: "builders",
    photo: "/people/jensen.jpg",
    photoCredit: "The White House / Wikimedia Commons (public domain)",
  },
  {
    id: "satya",
    name: "Satya Nadella",
    handle: "satyanadella",
    role: "Microsoft",
    bio: "CEO of Microsoft. Copilot across Office, Azure, and GitHub, and OpenAI’s largest backer. The grown-up in the room when the labs are loud.",
    lane: "builders",
    photo: "/people/satya.jpg",
    photoCredit: "Brian Smale / Microsoft via Wikimedia Commons (CC BY-SA 4.0)",
  },
  {
    id: "lisa-su",
    name: "Lisa Su",
    handle: "LisaSu",
    role: "AMD",
    bio: "CEO of AMD. The other GPU and CPU house — EPYC in the datacenter, Radeon when NVIDIA is sold out. The account to open when the CUDA take is too loud.",
    lane: "builders",
    photo: "/people/lisa-su.jpg",
    photoCredit: "Fuzheado / Wikimedia Commons (CC BY 4.0)",
  },
  {
    id: "zuck",
    name: "Mark Zuckerberg",
    handle: "zuck",
    role: "Meta",
    bio: "Founder and CEO of Meta. Open-weight Llama models, Reality Labs, and still Facebook. Posts when Meta ships something the other labs have to answer.",
    lane: "builders",
    photo: "/people/zuck.jpg",
    photoCredit: "The White House / Wikimedia Commons (public domain)",
  },
  {
    id: "sama",
    name: "Sam Altman",
    handle: "sama",
    role: "OpenAI",
    bio: "CEO of OpenAI. ChatGPT’s commissioner — product launches, safety letters, and the posts everyone screenshots. The account that moves the AI desk.",
    lane: "ai",
    photo: "/people/sama.jpg",
    photoCredit: "Office of the Prime Minister of Japan / Wikimedia Commons (CC BY 4.0)",
  },
  {
    id: "dario",
    name: "Dario Amodei",
    handle: "DarioAmodei",
    role: "Anthropic",
    bio: "CEO of Anthropic. Claude’s house: constitutional AI, longer letters, and fewer memes. The lab that argues in essays instead of keynotes.",
    lane: "ai",
    photo: "/people/dario.jpg",
    photoCredit: "TechCrunch / Wikimedia Commons (CC BY 2.0)",
  },
  {
    id: "demis",
    name: "Demis Hassabis",
    handle: "demishassabis",
    role: "Google DeepMind",
    bio: "CEO of Google DeepMind. AlphaFold, Gemini, and a Nobel Prize in chemistry. Science-fair energy with a production model behind it.",
    lane: "ai",
    photo: "/people/demis.jpg",
    photoCredit: "Johnsearsmedia / Wikimedia Commons (CC BY-SA 4.0)",
  },
  {
    id: "karpathy",
    name: "Andrej Karpathy",
    handle: "karpathy",
    role: "Independent",
    bio: "Independent researcher, formerly Tesla AI and OpenAI. The lecture you actually finish — neural nets without the press tour. Posts when he has something to teach, not something to ship.",
    lane: "ai",
    photo: "/people/karpathy.jpg",
    photoCredit: "Gladwin Analytics / Wikimedia Commons (CC BY 3.0)",
  },
  {
    id: "schefter",
    name: "Adam Schefter",
    handle: "AdamSchefter",
    role: "ESPN · NFL",
    bio: "ESPN’s senior NFL insider. Signings, injuries, and the tweet that hits before the notification. The breaking-news push that ruins a Sunday roster.",
    lane: "sports",
    photo: "/people/schefter.jpg",
    photoCredit: "All-Pro Reels / Wikimedia Commons (CC BY-SA 2.0)",
  },
  {
    id: "yates",
    name: "Field Yates",
    handle: "FieldYates",
    role: "ESPN",
    bio: "ESPN NFL analyst. Draft capital, trade charts, and the pick value the hub already argues about. The tape-and-capital desk next to Schefter’s breaking news.",
    lane: "sports",
  },
  {
    id: "berry",
    name: "Matthew Berry",
    handle: "MatthewBerryTMR",
    role: "Fantasy",
    bio: "Fantasy analyst behind The Fantasy Life. Love/hate rankings, waiver-wire columns, and the take that still has his name on it. The personality the industry copied, then argued with.",
    lane: "sports",
  },
  {
    id: "pga",
    name: "PGA Tour",
    handle: "PGATOUR",
    role: "Golf",
    bio: "Official account of the PGA Tour. Tee times, leaderboards, and Sunday pins when the golf league is live. Open this instead of waiting for the group chat to paste a screenshot.",
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

/** Initials for the monogram fallback when no portrait is on disk. */
export function personInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 3).toUpperCase();
  if (parts[0].length <= 4 && parts[0] === parts[0].toUpperCase()) {
    return parts[0];
  }
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}
