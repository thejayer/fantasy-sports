# @sj/ui

Shared design system for every Strictly Jayers Next app (hub, apex/www, fitness, vibe).

Apps do not use an npm workspace. Each app imports the CSS by relative path:

```css
@import "../../../../packages/sj-ui/index.css";
```

Docker build stages copy `packages/sj-ui` into the image so the same import resolves at `docker build` time. Fitness’s static PWA loads `public/sj-ui.css` (a copy of `index.css`) because browser `@import` cannot reach outside `public/`.

Tokens are dark-first. Light is the `[data-theme="light"]` override (same variable names). Existing class names (`panel`, `home-card`, `league-link`, `login-page`, …) keep working — this package remaps their look.
