# @sj/ui

Shared design system for every Strictly Jayers Next app (hub, apex/www, fitness, vibe).

Apps do not use an npm workspace. `packages/sj-ui` is the source of truth.
Each app vendors a copy under `src/sj-ui/` (fitness PWA also has `public/sj-ui/`)
so Next standalone stays at `.next/standalone/server.js`. After token or
component edits, run `packages/sj-ui/sync.sh`.

```ts
import "../sj-ui/index.css";
```

Tokens are dark-first. Light is the `[data-theme="light"]` override (same variable names). Existing class names (`panel`, `home-card`, `league-link`, `login-page`, …) keep working — this package remaps their look.

The cross-app switcher markup lives in each Next app (`AppSwitcher.tsx`) so `tsc` keeps resolving `react/jsx-runtime` from that app’s `node_modules`. Classes come from this package.
