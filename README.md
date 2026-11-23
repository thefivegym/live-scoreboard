# The Five That Score — Live D1 Scoreboard

A static, no-build live scoreboard for NCAA Division I women's gymnastics, by
[@thefivethatscore](https://x.com/thefivethatscore). Built for GitHub Pages.

- **National rankings** on the home page (Top 25, expandable to the full list) and each team profile (current rank and movement since the previous week). In the offseason this is the WCGA/CGA preseason coaches poll once it is released, or “Preseason poll coming soon” until then — ranks are never invented. During the season it switches to Road to Nationals official NQS rankings, refreshed by the daily Action. Labels name the source (“Preseason Coaches Poll” vs “RTN National Rankings, updated &lt;date&gt;”).
- **Perfect 10s** and **highest all-around** of the season, computed from official-meet Virtius scores (10.0 finals only; all-around = all four events in one meet). Ties for the top AA are all listed. Today’s live meets are merged in the browser. Empty seasons say “No perfect 10s yet this season.” Preview a past season with `?season=2026` or a mid-season date with `?now=2026-03-15`.
- **Team profiles** via a searchable “Meet by team” picker or `?team=slug` (for example `?team=oklahoma`). Each profile shows upcoming meets and previous results with jump links to the meet on the calendar, plus a meet record, season high and average when scores are available, and the team’s national rank. Until the next season is published it labels the last completed season and says the new schedule is coming; it switches automatically once `data/seasons/{year}.json` (or an announced-schedule file) is present, with a link to view last season. Team names on meet cards link to the profile.
- **Next meet** at the top of the page: teams, date and time in Central Time, a jump link to that day on the calendar (`?date=YYYY-MM-DD#meet=KEY`), and “+N more that day” when several meets share the date. On a live meet day it becomes **Live now**. When Road to Nationals has not published the season yet, the calendar is filled from official school athletics schedules (no live scoring links until RTN/Virtius keys appear). The Next meet bar jumps to the first announced meet.
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
| National rankings | GitHub Actions → `data/rankings.json` | WCGA preseason coaches poll (when published); in season, RTN `GET /api/women/results/{year}/{week}/0/5` (NQS), with the previous week for movement |
| Perfect 10s and AA high | GitHub Actions → `data/season-stats.json` | Virtius session JSON for official season meets; the browser also detects 10s/AA in today’s live meets |
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
scripts/build-schedule.mjs         Node 18+ schedule builder, no npm deps
scripts/build-stats.mjs            rankings, perfect 10s, and season AA high
.github/workflows/update.yml       scheduled data refresh + Pages deploy
data/schedule.json                 current (or latest published) season, D1 meets only
data/seasons/{year}.json           per-season archive (used for browsing past seasons and demo)
data/results/{meet_id}.json        RTN fallback results for non-Virtius meets
data/d1-teams.json                 D1 team list (from RTN rankings)
data/d1-overrides.json             manual include/exclude corrections
data/rankings.json                 preseason poll + weekly RTN NQS rankings
data/season-stats.json             perfect 10s and highest all-around, per season
data/virtius-score-cache.json      extracted Virtius scores so stats can update incrementally
screenshots/                       preview screenshots (not needed for the site)
```

## Run locally

```sh
node scripts/build-schedule.mjs                          # takes a few minutes because of the 30 s crawl delay
node scripts/build-schedule.mjs --results-date=2026-03-21  # also build fallbacks for a given date
node scripts/build-stats.mjs                             # rankings + perfect 10s / AA (use --history once to archive weekly ranks)
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
- Daily at 11:15 UTC → refresh schedule/team list, national rankings, and season stats; deploy if data changed.
- Every 10 min, 16:00–05:59 UTC, January–April → refresh schedule (stats links are often added on meet day)
  and RTN fallback results for today/yesterday; deploy if data changed.
- Manual `workflow_dispatch` → refresh + deploy.

`data/schedule.json` records the current date, so the daily run makes a small commit each day. That is
intentional: GitHub disables scheduled workflows in repos with no activity for 60 days, which would otherwise
happen over the summer.

Note GitHub's cron is best-effort (runs can be delayed during busy periods). Live Virtius scores do not depend
on it, since the browser fetches them directly; only the fallback results and new stats links do.

## Credits

Live scores: [Virtius](https://virti.us). Schedule, national rankings (NQS) and fallback results:
[Road to Nationals](https://www.roadtonationals.com). Preseason rankings: WCGA / CGA coaches poll
(via [USA Gymnastics](https://usagym.org/college/national-rankings/)). Unofficial; not affiliated with the NCAA, Virtius, RTN or WCGA.
