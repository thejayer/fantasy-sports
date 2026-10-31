"use client";

import { useSyncExternalStore } from "react";

import { IconChevron } from "@/components/AccountIcons";

export type ProfileSection = {
  id: string;
  label: string;
  blurb: string;
  danger?: boolean;
  panel: React.ReactNode;
};

function subscribeHash(notify: () => void) {
  window.addEventListener("hashchange", notify);
  window.addEventListener("popstate", notify);
  return () => {
    window.removeEventListener("hashchange", notify);
    window.removeEventListener("popstate", notify);
  };
}

/**
 * The /profile layout. Desktop: a section list on the left, the chosen section
 * on the right. Phones: the overview and the section list first; tapping a row
 * opens that section with a back link. The section lives in the URL hash
 * (/profile#linked-teams), so the casino and the menu can link straight to one.
 */
export function ProfileShell({ sections }: { sections: ProfileSection[] }) {
  const first = sections[0]?.id ?? "overview";
  const hash = useSyncExternalStore(subscribeHash, () => window.location.hash, () => "");
  const wanted = hash.replace(/^#/, "");
  const active = wanted && wanted !== first && sections.some((s) => s.id === wanted) ? wanted : null;

  const go = (id: string | null) => {
    const next = id && id !== first ? `#${id}` : window.location.pathname;
    window.history.pushState(null, "", next);
    // pushState fires no event of its own; this wakes the hash subscription.
    window.dispatchEvent(new PopStateEvent("popstate"));
    window.scrollTo({ top: 0 });
  };

  const shown = active ?? first;
  return (
    <div className="acct-profile" data-active={active ?? ""}>
      <nav className="acct-nav" aria-label="Profile sections">
        <ul>
          {sections.map((s) => (
            <li key={s.id} data-id={s.id}>
              <a
                href={s.id === first ? "/profile" : `#${s.id}`}
                className={`acct-nav-item${s.danger ? " is-danger" : ""}`}
                aria-current={shown === s.id ? "page" : undefined}
                onClick={(event) => {
                  event.preventDefault();
                  go(s.id);
                }}
              >
                <span className="acct-nav-text">
                  <span className="acct-nav-label">{s.label}</span>
                  <span className="acct-nav-blurb">{s.blurb}</span>
                </span>
                <IconChevron />
              </a>
            </li>
          ))}
        </ul>
      </nav>
      <div className="acct-panels">
        {sections.map((s) => (
          <section
            key={s.id}
            id={s.id}
            className="acct-panel"
            aria-labelledby={`${s.id}-title`}
            data-on={shown === s.id ? "1" : "0"}
            data-first={s.id === first ? "1" : "0"}
          >
            {s.id !== first ? (
              <a
                className="acct-back"
                href="/profile"
                onClick={(event) => {
                  event.preventDefault();
                  go(null);
                }}
              >
                <span aria-hidden>‹</span> Profile
              </a>
            ) : null}
            <h2 id={`${s.id}-title`} className="acct-panel-title">
              {s.label}
            </h2>
            {s.panel}
          </section>
        ))}
      </div>
    </div>
  );
}
