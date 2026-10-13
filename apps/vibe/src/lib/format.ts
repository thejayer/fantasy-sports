import { formatZoned } from "@/lib/timezone";

export function formatWhen(iso: string, timeZone: string): string {
  return formatZoned(new Date(iso), timeZone, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function formatClock(iso: string, timeZone: string): string {
  return formatZoned(new Date(iso), timeZone, {
    hour: "numeric",
    minute: "2-digit",
  });
}

export function formatDuration(sec: number): string {
  const minutes = Math.round(sec / 60);
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

export function kindLabel(kind: string): string {
  switch (kind) {
    case "commit":
      return "Commit";
    case "push":
      return "Push";
    case "pr_opened":
      return "PR opened";
    case "pr_merged":
      return "PR merged";
    case "review":
      return "Review";
    case "comment":
      return "Comment";
    default:
      return kind;
  }
}
