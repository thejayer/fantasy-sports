import { xProfileUrl } from "@/lib/people";
import type { TimelineAccount } from "@/lib/ai-news";

function accountInitials(label: string): string {
  const parts = label.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

/**
 * Compact X profile cards. Official widgets.js embeds stay blank when the
 * third-party script or cookies are blocked — link out instead.
 */
export function XTimelineGrid({ accounts }: { accounts: TimelineAccount[] }) {
  return (
    <div className="timeline-grid">
      {accounts.map((account) => {
        const href = xProfileUrl(account.handle);
        return (
          <article key={account.id} className="timeline-card">
            <div className="timeline-card-head">
              <span className="timeline-monogram" aria-hidden="true">
                {accountInitials(account.label)}
              </span>
              <div className="timeline-card-identity">
                <h3>{account.label}</h3>
                <p className="timeline-handle-text">@{account.handle}</p>
              </div>
            </div>
            {account.blurb ? <p className="timeline-blurb">{account.blurb}</p> : null}
            <a
              href={href}
              rel="noopener noreferrer"
              className="timeline-open"
              aria-label={`Open ${account.label} on X`}
            >
              Open on X →
            </a>
          </article>
        );
      })}
    </div>
  );
}
