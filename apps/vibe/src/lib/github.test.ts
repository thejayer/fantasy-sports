import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

import {
  mergeCodingEvents,
  normalizeGithubUserEvent,
  normalizeSearchCommit,
} from "./github";

const events = JSON.parse(
  readFileSync(path.join(__dirname, "../fixtures/github-events.json"), "utf8"),
) as Array<Parameters<typeof normalizeGithubUserEvent>[0]>;

describe("GitHub event normalization", () => {
  it("turns a PushEvent into authored commits", () => {
    const rows = normalizeGithubUserEvent(events[0]!);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.kind).toBe("commit");
    expect(rows[0]?.title).toBe("fix(hub): SeasonSwitcher team URLs");
    expect(rows[0]?.sha).toBe("abc123");
    expect(rows[0]?.repo).toBe("thejayer/fantasy-sports-analytics");
  });

  it("keeps opened and merged PRs and drops other PR actions", () => {
    const opened = normalizeGithubUserEvent(events[1]!);
    const merged = normalizeGithubUserEvent(events[2]!);
    expect(opened[0]?.kind).toBe("pr_opened");
    expect(merged[0]?.kind).toBe("pr_merged");
    expect(
      normalizeGithubUserEvent({
        type: "PullRequestEvent",
        created_at: "2026-10-05T13:00:00Z",
        repo: { name: "org/repo" },
        payload: { action: "synchronize", pull_request: { number: 1 } },
      }),
    ).toEqual([]);
  });

  it("maps reviews and comments", () => {
    expect(normalizeGithubUserEvent(events[3]!)[0]?.kind).toBe("review");
    expect(normalizeGithubUserEvent(events[4]!)[0]?.kind).toBe("comment");
  });

  it("normalizes a search-commits hit by author date", () => {
    const row = normalizeSearchCommit({
      sha: "deadbeef",
      html_url: "https://github.com/thejayer/fantasy-sports-analytics/commit/deadbeef",
      commit: {
        message: "feat: overlap math",
        author: { date: "2026-10-09T11:04:00Z" },
      },
      repository: { full_name: "thejayer/fantasy-sports-analytics" },
    });
    expect(row?.kind).toBe("commit");
    expect(row?.at).toBe("2026-10-09T11:04:00Z");
  });

  it("merges by id and keeps the richer stats", () => {
    const first = normalizeGithubUserEvent(events[0]!)[0]!;
    const richer = { ...first, additions: 48, deletions: 12 };
    const merged = mergeCodingEvents([first], [richer, first]);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.additions).toBe(48);
  });

  it("keys PushEvent and search-commits by repo+sha so one commit scores once", () => {
    const fromPush = normalizeGithubUserEvent(events[0]!)[0]!;
    const fromSearch = normalizeSearchCommit({
      sha: fromPush.sha ?? "abc123",
      html_url: fromPush.url,
      commit: {
        message: fromPush.title,
        author: { date: "2026-10-09T11:04:00Z" },
      },
      repository: { full_name: fromPush.repo },
    });
    expect(fromSearch?.id).toBe(fromPush.id);
    expect(mergeCodingEvents([fromPush], [fromSearch!])).toHaveLength(1);
  });
});
