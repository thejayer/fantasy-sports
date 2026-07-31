"use client";

import { useEffect } from "react";

import type { TimelineAccount } from "@/lib/ai-news";

declare global {
  interface Window {
    twttr?: {
      widgets?: {
        load: (element?: HTMLElement | null) => void;
      };
    };
  }
}

const WIDGET_SRC = "https://platform.twitter.com/widgets.js";

function ensureWidgetsScript(): void {
  if (typeof document === "undefined") return;
  if (document.querySelector(`script[src="${WIDGET_SRC}"]`)) {
    window.twttr?.widgets?.load();
    return;
  }
  const script = document.createElement("script");
  script.src = WIDGET_SRC;
  script.async = true;
  script.charset = "utf-8";
  script.onload = () => window.twttr?.widgets?.load();
  document.body.appendChild(script);
}

/**
 * Official X timeline embeds. No API key — X may throttle or restyle widgets.
 * Each column links out to the live profile if the widget fails to paint.
 */
export function XTimelineGrid({ accounts }: { accounts: TimelineAccount[] }) {
  useEffect(() => {
    ensureWidgetsScript();
  }, [accounts]);

  return (
    <div className="timeline-grid">
      {accounts.map((account) => (
        <div key={account.id} className="timeline-card">
          <div className="timeline-card-head">
            <h3>{account.label}</h3>
            <a
              href={`https://x.com/${account.handle}`}
              rel="noopener noreferrer"
              className="timeline-handle"
            >
              @{account.handle} →
            </a>
          </div>
          <a
            className="twitter-timeline"
            data-height="420"
            data-chrome="noheader nofooter noborders transparent"
            data-theme="light"
            href={`https://twitter.com/${account.handle}?ref_src=twsrc%5Etfw`}
          >
            Tweets by @{account.handle}
          </a>
        </div>
      ))}
    </div>
  );
}
