# Portfolio screenshots

Fixture-only shots for the public README. Captured from local Next apps
with `AUTH_DEV_BYPASS=1` and committed sample data — never from production.

| File | Surface | Source |
|---|---|---|
| `apex-home.png` | Community portal home | `apps/www` on committed portal copy |
| `hub.png` | Member hub home | `apps/web` + `fixtures/sj` + a local demo member |
| `rankings.png` | Fantasy power rankings | `fixtures/sj/ai_rankings` |
| `bets.png` | Public-slip tracker | `apps/www/fixtures/bets` |
| `fitness.png` | Training log dashboard | fitness demo sessions |
| `vibe.png` | Vibe Split home | vibe demo week |

Scrubbed before write: emails, dollar amounts, and personal display names.
Synthetic franchise names from `sj` fixtures (Hail Mary Heroes, Bat Flip
Bandits, …) are intentional. Do not replace these with live-site captures.

```bash
# four local apps must already be running (ports 3000 / 3002 / 3003 / 3005)
node docs/portfolio/capture.mjs
```
