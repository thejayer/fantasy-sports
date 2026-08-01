# Strictly Jayers community portal (`apps/www`)

Public front door for **https://strictlyjayers.com**.

The fantasy member hub stays on **https://fantasy.strictlyjayers.com**
(`apps/web`). This app never proxies or rewrites league routes — it deep-links
with absolute URLs so Auth.js cookies and snapshot data stay on the hub host.

See [PORTAL.md](../../PORTAL.md) for domain routing and deploy.

## Local

```bash
cd apps/www
cp .env.example .env.local   # optional
npm install
npm run dev                  # http://localhost:3002
```

| Env | Purpose |
|---|---|
| `SITE_URL` | Canonical origin (metadata) |
| `FANTASY_HUB_URL` | Absolute link to the hub (default production host) |
| `DISCORD_INVITE_URL` | Optional Discord CTA |
| `PALWORLD_INFO_URL` | Optional Palworld / games CTA |
| `YOUTUBE_PLAYLIST_ID` | Optional override for `/watch` (default baked in) |
