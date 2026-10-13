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

`--sj-font` is `var(--font-archivo, "Archivo", ui-sans-serif, system-ui, …)` so an unset next/font variable never invalidates the family (Chromium would otherwise fall back to Times). Each Next app applies `next/font/local` Archivo as both `--font-archivo` and `body.className`. Stats use `tabular-nums`.

The cross-app switcher markup lives in each Next app (`AppSwitcher.tsx`) so `tsc` keeps resolving `react/jsx-runtime` from that app’s `node_modules`. Classes come from this package.
