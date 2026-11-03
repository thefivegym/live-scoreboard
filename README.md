# The Five That Score — Live D1 Scoreboard

A static, no-build live scoreboard for NCAA Division I women's gymnastics, by
[@thefivethatscore](https://x.com/thefivethatscore). Built for GitHub Pages.

- **Every D1 meet for a day** (defaults to today in America/Chicago) as a card: teams, running team
  scores, LIVE / FINAL / UPCOMING badge, start time in CT, TV and stats links.
- **Expand a meet** for rotation-by-rotation team event scores, each athlete's score on vault, bars,
  beam and floor (dropped scores struck through, exhibitions marked EX), and event + all-around leaderboards.
- **Live polling:** browsers fetch Virtius directly every 30 s, only for meets that are live (or within
  15 min of / 6 h after their scheduled start and not yet final). Polling pauses when the tab is hidden.
- **Deep links:** `?date=YYYY-MM-DD` and `#meet=KEY` (KEY = Virtius session key, or `rtn-<meet_id>` for
  meets without Virtius). Each card has a share/copy-link button.
- **Offseason:** when a day has no meets, the page links to the next (or previous) meet day and explains
  when the next season's schedule has not been published yet.
- **Demo:** `?demo` opens the real 2026 NCAA Championship final (Virtius `MFrZ9epozB`); the banner also links
  to 2026-02-13 (regular season) and 2026-03-21 (conference championships, including Road to Nationals
  fallback meets).

## How it works

| Piece | Where it runs | Source |
|---|---|---|
| Schedule (dates, teams, times, Virtius keys, video links) | GitHub Actions → `data/schedule.json`, `data/seasons/{year}.json` | Road to Nationals `GET /api/women/schedule/{year}/1` |
| D1 team list | GitHub Actions → `data/d1-teams.json` | Road to Nationals national rankings `GET /api/women/results/{year}/{week}/0/5`, rows with `div = "Div I"` |
| Live scores | Visitor's browser, every 30 s | Virtius `GET https://api.virti.us/session/{key}/json` (public, CORS `*`) |
| Fallback results for meets not on Virtius | GitHub Actions every 10 min → `data/results/{meet_id}.json` | Road to Nationals `GET /api/women/meetresults/{meet_id}` |

Road to Nationals has no CORS headers for browsers, so it is only ever fetched by the build script.
Its robots.txt asks for a 30-second crawl delay; the script waits ≥30 s between every RTN request.

**D1 filter.** A meet is included if any participating team is in `data/d1-teams.json` (or in
`data/d1-overrides.json` → `include`). Teams named in `exclude` never count. Names must match RTN's spelling.
The list is refreshed at most once every 20 hours; until the new season's rankings exist, the previous
season's list is used.

**Season.** The season year is the spring year (Jul–Dec → next year). RTN currently answers requests for an
unpublished season with the latest published season, so the script checks that the returned dates belong to
the requested season; if not, it falls back to the previous season and sets `season_published: false`.

**Status inference (Virtius).** The public JSON has no PREGAME/LIVE/POSTGAME field, so: no scores → UPCOMING;
some scores → LIVE; every team has all four events with an event score and every lineup gymnast scored →
FINAL. A meet with scores on a past date, or >6 h after its start, is also treated as FINAL.
For RTN fallback meets, RTN's `info.live` flag is used.

## Files

```
index.html, app.js, styles.css     the site (vanilla JS, no build step)
scripts/build-schedule.mjs         Node 18+ data builder, no npm deps
.github/workflows/update.yml       scheduled data refresh + Pages deploy
data/schedule.json                 current (or latest published) season, D1 meets only
data/seasons/{year}.json           per-season archive (used for browsing past seasons and demo)
data/results/{meet_id}.json        RTN fallback results for non-Virtius meets
data/d1-teams.json                 D1 team list (from RTN rankings)
data/d1-overrides.json             manual include/exclude corrections
data/intrasquads.json              hand-maintained preseason intrasquads
data/intrasquads-discovered.json   intrasquad Virtius keys found by scripts/discover-intrasquads.mjs
data/discovery-status.json         which school schedule pages discovery could read
scripts/discover-intrasquads.mjs   intrasquad key discovery (no npm deps)
screenshots/                       preview screenshots (not needed for the site)
```

## Run locally

```sh
node scripts/build-schedule.mjs                          # takes a few minutes because of the 30 s crawl delay
node scripts/build-schedule.mjs --results-date=2026-03-21  # also build fallbacks for a given date
python3 -m http.server 8000                              # then open http://localhost:8000/?demo
```

Other flags: `--refresh-teams`, `--no-results`, `--season=2027`.

## Deploying to GitHub Pages

Uses the **GitHub Actions** Pages source (simplest robust option: the same workflow that commits new data
also deploys it, which sidesteps the rule that pushes made with `GITHUB_TOKEN` don't trigger other workflows).

1. Create a repo and push this folder to `main`.
2. Repo → **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. Repo → **Settings → Actions → General → Workflow permissions: Read and write**.
4. Run the workflow once from the **Actions** tab (*Update data & deploy → Run workflow*).

Workflow triggers:
- `push` to `main` → deploy only.
- Daily at 11:15 UTC → refresh schedule/team list; deploy if data changed.
- Every 10 min, 16:00–05:59 UTC, January–April → refresh schedule (stats links are often added on meet day)
  and RTN fallback results for today/yesterday; deploy if data changed.
- Every 10 min, 16:00–05:59 UTC, November–December → intrasquad key discovery only (`--due`: just the
  schools with a key-less intrasquad that day; no Road to Nationals calls); deploy if a key was found.
- Daily and manual runs also run full intrasquad discovery over every D1 schedule page (fails soft).
- Manual `workflow_dispatch` → refresh + deploy.

`data/schedule.json` records the current date, so the daily run makes a small commit each day. That is
intentional: GitHub disables scheduled workflows in repos with no activity for 60 days, which would otherwise
happen over the summer.

Note GitHub's cron is best-effort (runs can be delayed during busy periods). Live Virtius scores do not depend
on it, since the browser fetches them directly; only the fallback results and new stats links do.

## Preseason intrasquads

Road to Nationals does not list intrasquads, so they come from two files that the site merges into the day view:

- `data/intrasquads.json` (hand-maintained): `school` (RTN name), `event`, `date`, `time_local` + `tz`,
  `virtius` (key or `null`), `source_url`, `skip` (exhibitions / un-scored events stay hidden unless a key
  turns up). A key set here always wins.
- `data/intrasquads-discovered.json` (generated by `scripts/discover-intrasquads.mjs`): the script reads each
  D1 program's athletics schedule page (Sidearm / WMT), collects `virti.us` links, and checks each new key against
  the public `api.virti.us/session/{key}/json`. A session is an intrasquad when every team in it shares one
  `team_id` (two squads such as Maroon / Gold, or one school scored as a single team). Keys are matched to a
  hand-listed event by school and date (±1 day); others are added with the Virtius meet name.
  `data/discovery-status.json` records which schedule pages could be read. It honours robots.txt (including
  Sidearm's 30 s Crawl-delay), sends a normal User-Agent, and never fails the workflow.

Intrasquad cards get an **Intrasquad** badge, show squad names (Virtius `short_name` / team `name`) with
per-squad colours, and drop places / team labels for single-team sessions. Intrasquad days count as meet days
for "Next meet day".

Deep link any Virtius session with `#meet=KEY` (letters, digits, `-`, `_`): if it is not in the schedule, the
page loads the session, jumps to its `meet_date`, and live-polls it every 30 s while it is today and in progress.

```sh
node scripts/discover-intrasquads.mjs                # full run (~5 min because of crawl delays)
node scripts/discover-intrasquads.mjs --due          # only schools with an intrasquad today
node scripts/discover-intrasquads.mjs --only=Minnesota,Michigan --url-suffix=/2026   # past season page
```

## Credits

Live scores: [Virtius](https://virti.us). Schedule and fallback results:
[Road to Nationals](https://www.roadtonationals.com). Unofficial; not affiliated with the NCAA, Virtius or RTN.
