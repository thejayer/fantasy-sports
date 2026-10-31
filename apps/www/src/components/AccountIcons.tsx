/** Small line icons for the account menu (inline, so there is no icon package). Same set in the casino. */
const common = {
  width: 18,
  height: 18,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
  focusable: false,
};

export function IconUser() {
  return (
    <svg {...common}>
      <circle cx="12" cy="8" r="3.6" />
      <path d="M4.5 20c.9-3.6 3.9-5.4 7.5-5.4s6.6 1.8 7.5 5.4" />
    </svg>
  );
}

export function IconLink() {
  return (
    <svg {...common}>
      <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" />
      <path d="M14 10a4 4 0 0 0-5.7 0l-3 3A4 4 0 0 0 11 18.7l1-1" />
    </svg>
  );
}

export function IconSettings() {
  return (
    <svg {...common}>
      <path d="M4 7h10M18 7h2M4 17h2M10 17h10" />
      <circle cx="16" cy="7" r="2" />
      <circle cx="8" cy="17" r="2" />
    </svg>
  );
}

export function IconSignOut() {
  return (
    <svg {...common}>
      <path d="M9 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h3" />
      <path d="M16 8l4 4-4 4M20 12H10" />
    </svg>
  );
}

export function IconSignIn() {
  return (
    <svg {...common}>
      <path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3" />
      <path d="M8 8l-4 4 4 4M4 12h10" />
    </svg>
  );
}

export function IconChevron() {
  return (
    <svg {...common} width={16} height={16}>
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}
