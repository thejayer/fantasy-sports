# Modernist design system

Shared visual language for Strictly Jayers:

- Apex portal — `apps/www`
- Fantasy hub — `apps/web`

Source of truth: [`styles.css`](styles.css).

Apps import a vendored copy under `src/styles/modernist.css` so Next.js stays
self-contained. After editing this file, copy it into both apps:

```bash
cp design/modernist/styles.css apps/www/src/styles/modernist.css
cp design/modernist/styles.css apps/web/src/styles/modernist.css
```

## Accent

`--color-accent` (default `#ec3013`) retints both surfaces. Derived helpers:

- `--accent-deep` — readable accent text on light grounds
- `--accent-tint` — hover / row wash
