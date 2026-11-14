# Altron worker

One always-on Node process that keeps the paper market, both books and the follow engine.
Every page (Yazan's desk, the owner's pages, Community) draws from it when the site has
`NEXT_PUBLIC_WORKER_URL` set; without it, each page runs its own market as before.

```
npm run worker            # PORT=8787 by default
WORKER_AUTH_OFF=1 npm run worker   # local only: everyone is the owner (ignored on Railway)
```

## What it does

- **Tape**: the simulated market (NQ, ES, US30, Gold) steps four times a second and streams to
  every page. `GET /market` gives a page the last three days to draw from.
- **Books**: Yazan's and the owner's. Orders from the desk come in as operations (`POST /op`),
  are applied with the same broker the pages use, and the new book goes to everyone.
- **Follow**: the engine reads both books once a second, trades the owner's book, asks the
  models, sends Discord alerts and writes the day's review after the 5 PM close.
- **State**: Supabase table `worker_state` (see `supabase/schema.sql`), or `.worker/` files locally.

Only one replica: the books live in memory and are saved every few seconds.

## Railway variables

| Variable | What |
| --- | --- |
| `SUPABASE_URL` | the project URL (same as `NEXT_PUBLIC_SUPABASE_URL`) |
| `SUPABASE_SERVICE_ROLE_KEY` | service role key: checks sign-ins, reads roles, saves state. Never in Vercel |
| `DISCORD_WEBHOOK_URL` | alerts and reviews to the owner's phone |
| `ANTHROPIC_API_KEY` | Opus 5.5 entries, Haiku 5.5 management, Fable 5.2 reviews |
| `GEMINI_API_KEY` | optional: Gemini 4 Carbon's second opinion on entries |
| `AI_WEEKLY_CAP` | dollars a week, default 25 |
| `SITE_URL` | `https://altron.capital` (the calendar for the news guard comes from there) |
| `ALLOWED_ORIGINS` | optional; defaults to altron.capital, www, and localhost. Vercel previews are allowed |

Models can be changed with `FOLLOW_ENTRY_MODEL`, `FOLLOW_SHADOW_MODEL`, `FOLLOW_MANAGE_MODEL`
and `FOLLOW_COACH_MODEL`.

On Vercel, set `NEXT_PUBLIC_WORKER_URL` to the worker's public URL and redeploy.
