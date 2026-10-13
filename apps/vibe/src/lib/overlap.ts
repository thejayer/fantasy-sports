import { addMinutes, parseInstant } from "@/lib/timezone";
import type { AgentRun, CodingEvent, Workout } from "@/lib/vibe-document";

export type TimeWindow = {
  start: Date;
  end: Date;
};

export function workoutWindow(
  workout: Pick<Workout, "start" | "end">,
  bufferMinutes: number,
): TimeWindow | null {
  const start = parseInstant(workout.start);
  const end = parseInstant(workout.end);
  if (!start || !end || end.getTime() < start.getTime()) return null;
  const buffer = Number.isFinite(bufferMinutes) ? bufferMinutes : 0;
  return {
    start: addMinutes(start, -buffer),
    end: addMinutes(end, buffer),
  };
}

export function instantInWindow(at: Date, window: TimeWindow): boolean {
  const t = at.getTime();
  return t >= window.start.getTime() && t <= window.end.getTime();
}

export function overlapMs(a: TimeWindow, b: TimeWindow): number {
  const start = Math.max(a.start.getTime(), b.start.getTime());
  const end = Math.min(a.end.getTime(), b.end.getTime());
  return Math.max(0, end - start);
}

export function overlapMinutes(a: TimeWindow, b: TimeWindow): number {
  return overlapMs(a, b) / 60_000;
}

export function eventsInWindow(
  events: CodingEvent[],
  window: TimeWindow,
): CodingEvent[] {
  return events.filter((event) => {
    const at = parseInstant(event.at);
    return at ? instantInWindow(at, window) : false;
  });
}

export function agentMinutesInWindow(
  runs: AgentRun[],
  window: TimeWindow,
): number {
  let minutes = 0;
  for (const run of runs) {
    const start = parseInstant(run.start);
    const end = parseInstant(run.end);
    if (!start || !end || end.getTime() <= start.getTime()) continue;
    minutes += overlapMinutes({ start, end }, window);
  }
  return minutes;
}
