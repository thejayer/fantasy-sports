type AppId = "hub" | "bets" | "fitness" | "vibe";

export type AppSwitcherProps = {
  current?: AppId;
  hubUrl: string;
  betsUrl: string;
  fitnessUrl: string;
  vibeUrl: string;
};

const APPS: { id: AppId; label: string }[] = [
  { id: "hub", label: "Hub" },
  { id: "bets", label: "Bets" },
  { id: "fitness", label: "Fitness" },
  { id: "vibe", label: "Vibe" },
];

export function AppSwitcher({
  current,
  hubUrl,
  betsUrl,
  fitnessUrl,
  vibeUrl,
}: AppSwitcherProps) {
  const href: Record<AppId, string> = {
    hub: hubUrl,
    bets: betsUrl,
    fitness: fitnessUrl,
    vibe: vibeUrl,
  };

  return (
    <nav className="sj-app-switcher" aria-label="Strictly Jayers apps">
      {APPS.map((app) =>
        app.id === current ? (
          <span key={app.id} aria-current="page" className="is-current">
            {app.label}
          </span>
        ) : (
          <a key={app.id} href={href[app.id]} rel="noopener noreferrer">
            {app.label}
          </a>
        ),
      )}
    </nav>
  );
}
