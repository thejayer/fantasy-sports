import type { ReactNode } from "react";

/** Shared empty-panel copy for leagues, standings, rosters, etc. (roadmap 3.6). */
export function EmptyState({
  title,
  children,
}: {
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty-state panel" role="status">
      <strong className="empty-state-title">{title}</strong>
      {children ? <div className="empty-state-body muted">{children}</div> : null}
    </div>
  );
}
