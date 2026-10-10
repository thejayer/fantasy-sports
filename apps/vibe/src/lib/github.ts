import type { CodingEvent, CodingKind } from "@/lib/vibe-document";

export const GITHUB_API = "https://api.github.com";
export const GITHUB_STALE_MS = 30 * 60 * 1000;
export const GITHUB_FETCH_MS = 20_000;

export type GithubUser = {
  login: string;
  id: number;
};

export type GithubFetch = (
  url: string,
  init?: RequestInit,
) => Promise<Response>;

function header(token: string): Record<string, string> {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "strictly-jayers-vibe",
  };
}

function githubInit(token: string, init?: RequestInit): RequestInit {
  return {
    ...init,
    headers: { ...header(token), ...(init?.headers ?? {}) },
    signal: init?.signal ?? AbortSignal.timeout(GITHUB_FETCH_MS),
  };
}

async function readJson<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`GitHub ${res.status}: ${text.slice(0, 200)}`);
  }
  return (await res.json()) as T;
}

function nextLink(link: string | null): string | null {
  if (!link) return null;
  const match = link.split(",").find((part) => part.includes('rel="next"'));
  const url = match?.match(/<([^>]+)>/);
  return url?.[1] ?? null;
}

export function githubEventId(
  kind: CodingKind,
  at: string,
  repo: string,
  extra: string,
): string {
  return `gh:${kind}:${repo}:${at}:${extra}`.slice(0, 180);
}

/** Stable across PushEvent + search-commits so one SHA scores once. */
export function githubCommitId(
  repo: string,
  sha: string | null | undefined,
  fallbackAt: string,
  fallbackExtra: string,
): string {
  if (sha) return `gh:commit:${repo}:${sha}`.slice(0, 180);
  return githubEventId("commit", fallbackAt, repo, fallbackExtra);
}

type RawEvent = {
  id?: string;
  type?: string;
  created_at?: string;
  repo?: { name?: string };
  payload?: {
    ref?: string;
    commits?: Array<{ sha?: string; message?: string }>;
    action?: string;
    pull_request?: {
      number?: number;
      title?: string;
      html_url?: string;
      merged?: boolean;
    };
    review?: { html_url?: string; state?: string };
    comment?: { html_url?: string; body?: string };
  };
};

export function normalizeGithubUserEvent(raw: RawEvent): CodingEvent[] {
  const created = raw.created_at;
  const repo = raw.repo?.name || "unknown";
  if (!created) return [];
  const payload = raw.payload ?? {};
  if (raw.type === "PushEvent") {
    const commits = payload.commits ?? [];
    if (!commits.length) {
      return [
        {
          id: githubEventId("push", created, repo, raw.id || payload.ref || ""),
          kind: "push",
          at: created,
          repo,
          title: payload.ref ? `Pushed ${payload.ref}` : "Push",
          url: `https://github.com/${repo}`,
          additions: null,
          deletions: null,
          sha: null,
        },
      ];
    }
    return commits.map((commit) => ({
      id: githubCommitId(
        repo,
        commit.sha,
        created,
        commit.message || "",
      ),
      kind: "commit" as const,
      at: created,
      repo,
      title: (commit.message || "Commit").split("\n")[0] ?? "Commit",
      url: commit.sha
        ? `https://github.com/${repo}/commit/${commit.sha}`
        : `https://github.com/${repo}`,
      additions: null,
      deletions: null,
      sha: commit.sha ?? null,
    }));
  }
  if (raw.type === "PullRequestEvent") {
    const pr = payload.pull_request;
    const number = pr?.number ?? 0;
    const merged = payload.action === "closed" && pr?.merged === true;
    const opened = payload.action === "opened";
    if (!merged && !opened) return [];
    const kind: CodingKind = merged ? "pr_merged" : "pr_opened";
    return [
      {
        id: githubEventId(kind, created, repo, String(number)),
        kind,
        at: created,
        repo,
        title: pr?.title || `PR #${number}`,
        url: pr?.html_url || `https://github.com/${repo}/pull/${number}`,
        additions: null,
        deletions: null,
        sha: null,
      },
    ];
  }
  if (raw.type === "PullRequestReviewEvent") {
    return [
      {
        id: githubEventId(
          "review",
          created,
          repo,
          payload.review?.html_url || raw.id || "",
        ),
        kind: "review",
        at: created,
        repo,
        title: payload.review?.state
          ? `Review ${payload.review.state}`
          : "PR review",
        url:
          payload.review?.html_url ||
          payload.pull_request?.html_url ||
          `https://github.com/${repo}`,
        additions: null,
        deletions: null,
        sha: null,
      },
    ];
  }
  if (
    raw.type === "PullRequestReviewCommentEvent" ||
    raw.type === "IssueCommentEvent"
  ) {
    return [
      {
        id: githubEventId(
          "comment",
          created,
          repo,
          payload.comment?.html_url || raw.id || "",
        ),
        kind: "comment",
        at: created,
        repo,
        title: (payload.comment?.body || "Comment").split("\n")[0] ?? "Comment",
        url:
          payload.comment?.html_url ||
          payload.pull_request?.html_url ||
          `https://github.com/${repo}`,
        additions: null,
        deletions: null,
        sha: null,
      },
    ];
  }
  return [];
}

type SearchCommit = {
  sha?: string;
  html_url?: string;
  commit?: {
    message?: string;
    author?: { date?: string };
    committer?: { date?: string };
  };
  repository?: { full_name?: string };
};

export function normalizeSearchCommit(raw: SearchCommit): CodingEvent | null {
  const sha = raw.sha;
  const at = raw.commit?.author?.date || raw.commit?.committer?.date;
  const repo = raw.repository?.full_name || "unknown";
  if (!sha || !at) return null;
  return {
    id: githubCommitId(repo, sha, at, sha),
    kind: "commit",
    at,
    repo,
    title: (raw.commit?.message || "Commit").split("\n")[0] ?? "Commit",
    url: raw.html_url || `https://github.com/${repo}/commit/${sha}`,
    additions: null,
    deletions: null,
    sha,
  };
}

export async function fetchGithubUser(
  token: string,
  fetchImpl: GithubFetch = fetch,
): Promise<GithubUser> {
  const res = await fetchImpl(`${GITHUB_API}/user`, githubInit(token));
  const body = await readJson<{ login?: string; id?: number }>(res);
  if (!body.login || !body.id) throw new Error("GitHub user missing login");
  return { login: body.login, id: body.id };
}

export async function fetchGithubEvents(
  token: string,
  opts?: { pages?: number; fetchImpl?: GithubFetch },
): Promise<CodingEvent[]> {
  const fetchImpl = opts?.fetchImpl ?? fetch;
  const maxPages = opts?.pages ?? 3;
  const out: CodingEvent[] = [];
  let url: string | null = `${GITHUB_API}/user/events?per_page=100`;
  for (let page = 0; page < maxPages && url; page += 1) {
    const res = await fetchImpl(url, githubInit(token));
    const rows = await readJson<RawEvent[]>(res);
    for (const row of rows) out.push(...normalizeGithubUserEvent(row));
    url = nextLink(res.headers.get("link"));
  }
  return out;
}

export async function searchGithubCommits(
  token: string,
  login: string,
  fromIso: string,
  toIso: string,
  opts?: { pages?: number; fetchImpl?: GithubFetch },
): Promise<CodingEvent[]> {
  const fetchImpl = opts?.fetchImpl ?? fetch;
  const maxPages = opts?.pages ?? 5;
  const from = fromIso.slice(0, 10);
  const to = toIso.slice(0, 10);
  const q = encodeURIComponent(`author:${login} committer-date:${from}..${to}`);
  const out: CodingEvent[] = [];
  for (let page = 1; page <= maxPages; page += 1) {
    const url = `${GITHUB_API}/search/commits?q=${q}&sort=author-date&order=desc&per_page=100&page=${page}`;
    const res = await fetchImpl(url, githubInit(token));
    const body = await readJson<{ items?: SearchCommit[] }>(res);
    const items = body.items ?? [];
    for (const item of items) {
      const event = normalizeSearchCommit(item);
      if (event) out.push(event);
    }
    if (items.length < 100) break;
  }
  return out;
}

type CommitDetail = {
  stats?: { additions?: number; deletions?: number };
};

export async function fillCommitStats(
  token: string,
  events: CodingEvent[],
  opts?: { limit?: number; fetchImpl?: GithubFetch },
): Promise<CodingEvent[]> {
  const fetchImpl = opts?.fetchImpl ?? fetch;
  const limit = opts?.limit ?? 20;
  let used = 0;
  const out: CodingEvent[] = [];
  for (const event of events) {
    if (
      event.kind !== "commit" ||
      !event.sha ||
      event.additions != null ||
      used >= limit
    ) {
      out.push(event);
      continue;
    }
    used += 1;
    try {
      const res = await fetchImpl(
        `${GITHUB_API}/repos/${event.repo}/commits/${event.sha}`,
        githubInit(token),
      );
      const body = await readJson<CommitDetail>(res);
      out.push({
        ...event,
        additions: body.stats?.additions ?? null,
        deletions: body.stats?.deletions ?? null,
      });
    } catch {
      out.push(event);
    }
  }
  return out;
}

export function mergeCodingEvents(
  existing: CodingEvent[],
  incoming: CodingEvent[],
): CodingEvent[] {
  const map = new Map<string, CodingEvent>();
  for (const event of existing) map.set(event.id, event);
  for (const event of incoming) {
    const prev = map.get(event.id);
    if (!prev) {
      map.set(event.id, event);
      continue;
    }
    map.set(event.id, {
      ...prev,
      ...event,
      additions: event.additions ?? prev.additions,
      deletions: event.deletions ?? prev.deletions,
    });
  }
  return [...map.values()].sort((a, b) => b.at.localeCompare(a.at));
}

export function githubIsStale(lastSyncAt: string | null, now = Date.now()): boolean {
  if (!lastSyncAt) return true;
  const then = Date.parse(lastSyncAt);
  if (!Number.isFinite(then)) return true;
  return now - then >= GITHUB_STALE_MS;
}
