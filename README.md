# Altron

A private futures desk that trades in the open. Members watch the quant's ES / NQ / MES / MNQ positions live — entry, size, stop, target, and the reasoning behind each one.

This repo is the web app. Right now it's design v0.1 on a **simulated feed and demo data**; real data (Databento, broker accounts) and auth are not connected yet.

## Routes

| Path        | What                                                        |
| ----------- | ----------------------------------------------------------- |
| `/`         | Public landing page (marketing + live demo of the desk)     |
| `/login`    | Sign-in for members and the desk (UI only, no auth yet)     |
| `/identity` | Brand sheet: mark, palette, type, motifs                    |

## Develop

```bash
npm install
npm run dev      # http://localhost:3000
npm run build    # production build
```

Node 20.9+.

## Deploys

- `main` → production on Vercel.
- Any other branch / pull request → its own Vercel preview URL (posted on the PR).

Work on a branch, open a PR, click the preview, merge when it looks right.

## Structure

```
app/                 routes (Next.js App Router)
components/landing/  landing sections, canvases, simulated feed provider
components/login/    sign-in screen + dithered mountain scene
components/identity/ brand sheet
lib/                 noise + dithering, number formatting, feed simulator, demo ledger
```

Design tokens (colors, fonts) live as CSS variables in `app/globals.css`.

## Fonts

Geist and Geist Mono come from the `geist` package; Instrument Serif from `@fontsource/instrument-serif`. Both are bundled at build time, so no requests go to Google Fonts.
