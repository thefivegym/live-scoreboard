# Fan Polls API

Cloudflare Worker + D1 backend for the in-page Fan Polls on the live scoreboard.

**Production:** `https://live-scoreboard-polls.thefivegym.workers.dev`

## Endpoints

- `GET /api/polls` — active polls, options, carried-over baselines + live votes, sorted counts. Pass `?voterId=` (or `X-Voter-Id`) to include `myVote`.
- `POST /api/polls/:pollId/vote` — body `{ "optionId", "voterId" }`. One locked vote per poll (voter id **and** a hashed IP fingerprint). Duplicate attempts return `200` with `{ alreadyVoted: true, lockedOptionId, poll }`.

CORS allows `https://thefivegym.github.io` and `http://localhost:*` / `http://127.0.0.1:*`.

## Add a poll later (e.g. Championships)

1. Append an object to `POLLS` in `src/catalog.js` (`id`, `title`, `kind`, `options`, optional `baselineVotes`).
2. Redeploy: `npx wrangler deploy` from this directory.

The Worker upserts the catalog on request, so no manual SQL is required. Do not invent baseline counts.

## Deploy

```sh
cd worker
npx wrangler deploy
npx wrangler secret put VOTE_SALT   # first time only
```

GitHub Actions still deploys only the static scoreboard to GitHub Pages. This Worker is deployed separately with Wrangler.

## Data

Baselines for `ncaa-champions-2027` (91 votes) and `aa-champion-2027` (125 votes) were copied from the existing Grok-hosted polls on 2026-11-27, 15:29 Europe/Berlin. See `CATALOG_META` in `src/catalog.js`.
