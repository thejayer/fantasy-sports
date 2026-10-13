import {
  agentMinutesInWindow,
  eventsInWindow,
  workoutWindow,
} from "@/lib/overlap";
import type {
  AgentRun,
  CodingEvent,
  CodingKind,
  Workout,
} from "@/lib/vibe-document";

/**
 * Vibe Score (transparent, documented):
 *
 *   commits×1 + PRs opened×2 + PRs merged×3 + reviews×1
 *   + comments×0.5 + agent minutes×0.1
 *
 * Lines added/removed are shown on the workout but do not change the score
 * (they are only cheaply available for some commits).
 */
export const SCORE_WEIGHTS = {
  commit: 1,
  push: 0,
  pr_opened: 2,
  pr_merged: 3,
  review: 1,
  comment: 0.5,
  agent_minute: 0.1,
} as const;

export type WorkoutVibe = {
  workout: Workout;
  windowStart: string;
  windowEnd: string;
  events: CodingEvent[];
  commits: number;
  pushes: number;
  prs_opened: number;
  prs_merged: number;
  reviews: number;
  comments: number;
  additions: number;
  deletions: number;
  agent_minutes: number;
  score: number;
};

function countKind(events: CodingEvent[], kind: CodingKind): number {
  return events.filter((event) => event.kind === kind).length;
}

function sumLines(events: CodingEvent[], key: "additions" | "deletions"): number {
  return events.reduce((sum, event) => sum + (event[key] ?? 0), 0);
}

export function scoreFromCounts(input: {
  commits: number;
  prs_opened: number;
  prs_merged: number;
  reviews: number;
  comments: number;
  agent_minutes: number;
}): number {
  const raw =
    input.commits * SCORE_WEIGHTS.commit +
    input.prs_opened * SCORE_WEIGHTS.pr_opened +
    input.prs_merged * SCORE_WEIGHTS.pr_merged +
    input.reviews * SCORE_WEIGHTS.review +
    input.comments * SCORE_WEIGHTS.comment +
    input.agent_minutes * SCORE_WEIGHTS.agent_minute;
  return Math.round(raw * 10) / 10;
}

export function scoreWorkout(
  workout: Workout,
  events: CodingEvent[],
  agentRuns: AgentRun[],
  bufferMinutes: number,
): WorkoutVibe | null {
  const window = workoutWindow(workout, bufferMinutes);
  if (!window) return null;
  const hit = eventsInWindow(events, window);
  const commits = countKind(hit, "commit");
  const pushes = countKind(hit, "push");
  const prs_opened = countKind(hit, "pr_opened");
  const prs_merged = countKind(hit, "pr_merged");
  const reviews = countKind(hit, "review");
  const comments = countKind(hit, "comment");
  const agent_minutes =
    Math.round(agentMinutesInWindow(agentRuns, window) * 10) / 10;
  return {
    workout,
    windowStart: window.start.toISOString(),
    windowEnd: window.end.toISOString(),
    events: hit.sort((a, b) => a.at.localeCompare(b.at)),
    commits,
    pushes,
    prs_opened,
    prs_merged,
    reviews,
    comments,
    additions: sumLines(hit, "additions"),
    deletions: sumLines(hit, "deletions"),
    agent_minutes,
    score: scoreFromCounts({
      commits,
      prs_opened,
      prs_merged,
      reviews,
      comments,
      agent_minutes,
    }),
  };
}

export function scoreWorkouts(
  workouts: Workout[],
  events: CodingEvent[],
  agentRuns: AgentRun[],
  bufferMinutes: number,
): WorkoutVibe[] {
  return workouts
    .map((workout) => scoreWorkout(workout, events, agentRuns, bufferMinutes))
    .filter((row): row is WorkoutVibe => !!row)
    .sort((a, b) => b.workout.start.localeCompare(a.workout.start));
}
