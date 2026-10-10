import {
  addCalendarDays,
  startOfZonedDay,
  startOfZonedWeek,
  zonedDateKey,
  zonedParts,
} from "@/lib/timezone";
import type { WorkoutVibe } from "@/lib/score";

export type HomeStats = {
  week: WorkoutVibe[];
  weekScore: number;
  weekCommits: number;
  weekMinutes: number;
  totalScore: number;
  totalCommits: number;
  codedWorkouts: number;
  streak: number;
  top: WorkoutVibe | null;
};

export function workoutHasCommit(row: WorkoutVibe): boolean {
  return row.commits > 0;
}

/**
 * Consecutive calendar days (member TZ), walking back from the most recent
 * day that has a workout with at least one commit. A gap of a day with no
 * qualifying workout breaks the streak.
 */
export function commitStreak(
  rows: WorkoutVibe[],
  timeZone: string,
  now = new Date(),
): number {
  const days = new Set<string>();
  for (const row of rows) {
    if (!workoutHasCommit(row)) continue;
    days.add(zonedDateKey(new Date(row.workout.start), timeZone));
  }
  if (days.size === 0) return 0;

  let streak = 0;
  let day = startOfZonedDay(
    rows
      .filter(workoutHasCommit)
      .map((row) => new Date(row.workout.start))
      .sort((a, b) => b.getTime() - a.getTime())[0] ?? now,
    timeZone,
  );
  if (days.has(zonedDateKey(now, timeZone))) {
    day = startOfZonedDay(now, timeZone);
  }
  for (let i = 0; i < 400; i += 1) {
    const key = zonedDateKey(day, timeZone);
    if (!days.has(key)) break;
    streak += 1;
    day = addCalendarDays(day, -1, timeZone);
  }
  return streak;
}

export function homeStats(
  rows: WorkoutVibe[],
  timeZone: string,
  now = new Date(),
): HomeStats {
  const weekStart = startOfZonedWeek(now, timeZone).getTime();
  const week = rows.filter(
    (row) => new Date(row.workout.start).getTime() >= weekStart,
  );
  const top =
    [...rows].sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return b.workout.start.localeCompare(a.workout.start);
    })[0] ?? null;
  return {
    week,
    weekScore: round1(week.reduce((sum, row) => sum + row.score, 0)),
    weekCommits: week.reduce((sum, row) => sum + row.commits, 0),
    weekMinutes: Math.round(
      week.reduce((sum, row) => sum + row.workout.duration_sec, 0) / 60,
    ),
    totalScore: round1(rows.reduce((sum, row) => sum + row.score, 0)),
    totalCommits: rows.reduce((sum, row) => sum + row.commits, 0),
    codedWorkouts: rows.filter(workoutHasCommit).length,
    streak: commitStreak(rows, timeZone, now),
    top,
  };
}

export type TypeStat = {
  type: string;
  workouts: number;
  score: number;
  commits: number;
};

export function statsByType(rows: WorkoutVibe[]): TypeStat[] {
  const map = new Map<string, TypeStat>();
  for (const row of rows) {
    const type = row.workout.type || "Workout";
    const cur = map.get(type) ?? { type, workouts: 0, score: 0, commits: 0 };
    cur.workouts += 1;
    cur.score = round1(cur.score + row.score);
    cur.commits += row.commits;
    map.set(type, cur);
  }
  return [...map.values()].sort((a, b) => b.score - a.score);
}

export type HeatCell = {
  weekday: number;
  hour: number;
  score: number;
  workouts: number;
};

export function heatmap(
  rows: WorkoutVibe[],
  timeZone: string,
): HeatCell[] {
  const cells = new Map<string, HeatCell>();
  for (const row of rows) {
    const z = zonedParts(new Date(row.workout.start), timeZone);
    const key = `${z.weekday}:${z.hour}`;
    const cur = cells.get(key) ?? {
      weekday: z.weekday,
      hour: z.hour,
      score: 0,
      workouts: 0,
    };
    cur.score = round1(cur.score + row.score);
    cur.workouts += 1;
    cells.set(key, cur);
  }
  return [...cells.values()];
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
