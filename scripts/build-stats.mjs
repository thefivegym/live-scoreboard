#!/usr/bin/env node
// Builds data/rankings.json (WCGA preseason poll, Road to Nationals weekly
// national rankings, and official final standings after NCAA Championships)
// and data/season-stats.json (perfect 10s, highest all-around, weekend
// 197+ team scores and event highs) from official D1 season meets on Virtius.
//
// Separate from scripts/build-schedule.mjs so schedule refreshes stay untouched.
// No npm deps; Node 18+ (global fetch).
//
// Usage:
//   node scripts/build-stats.mjs
//   node scripts/build-stats.mjs --history          # also archive every RTN week
//   node scripts/build-stats.mjs --refresh-sessions # re-fetch all Virtius sessions
//   node scripts/build-stats.mjs --rankings-only
//   node scripts/build-stats.mjs --stats-only
//   node scripts/build-stats.mjs --season=2026
//
// Politeness: RTN robots.txt asks for crawl-delay 30. Virtius is concurrent
// and has no crawl-delay (CORS *, used live in the browser).

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = join(ROOT, 'data');
const RTN = 'https://www.roadtonationals.com/api/women';
const TZ = 'America/Chicago';
const RTN_DELAY_MS = Number(process.env.RTN_DELAY_MS ?? 30000);
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 TheFiveThatScore-Scoreboard/1.0 (+https://x.com/thefivethatscore)';
const VIRTIUS_CONCURRENCY = Number(process.env.VIRTIUS_CONCURRENCY ?? 6);
const EV_BY_NAME = { VAULT: 'vault', BARS: 'bars', BEAM: 'beam', FLOOR: 'floor' };
const EVENTS = ['vault', 'bars', 'beam', 'floor'];

const args = Object.fromEntries(process.argv.slice(2).map(a => {
  const [k, v] = a.replace(/^--/, '').split('=');
  return [k, v ?? true];
}));

let lastRtn = 0;
const sleep = ms => new Promise(r => setTimeout(r, ms));
function log(...a) { console.log(...a); }
const rel = p => p.replace(ROOT + '/', '');
const decode = s => String(s ?? '').replace(/&amp;/g, '&').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();
async function readJson(p, fallback = null) { try { return JSON.parse(await readFile(p, 'utf8')); } catch { return fallback; } }
async function writeJsonIfChanged(p, obj, ignoreKeys = ['generated_at']) {
  await mkdir(dirname(p), { recursive: true });
  const old = await readJson(p);
  const strip = o => JSON.stringify(o, (k, v) => ignoreKeys.includes(k) ? undefined : v);
  if (old && strip(old) === strip(obj)) { log(`  unchanged: ${rel(p)}`); return false; }
  await writeFile(p, JSON.stringify(obj, null, 1) + '\n');
  log(`  wrote: ${rel(p)}`);
  return true;
}
function ymdInTz(date, tz = TZ) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}
const seasonFor = ymd => { const [y, m] = ymd.split('-').map(Number); return m >= 7 ? y + 1 : y; };
const addDays = (ymd, n) => { const d = new Date(ymd + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const num = v => { if (v === null || v === undefined || v === '') return null; const n = Number(v); return Number.isFinite(n) ? n : null; };
const isTen = v => { const n = num(v); return n !== null && Math.abs(n - 10) < 0.00005; };
const isYmd = s => /^\d{4}-\d{2}-\d{2}$/.test(s || '');

async function rtnGet(path) {
  const wait = lastRtn + RTN_DELAY_MS - Date.now();
  if (lastRtn && wait > 0) { log(`  (waiting ${Math.ceil(wait / 1000)}s for RTN crawl-delay)`); await sleep(wait); }
  lastRtn = Date.now();
  const url = RTN + path;
  log(`GET ${url}`);
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  const text = await res.text();
  try { return JSON.parse(text); } catch { throw new Error(`${url} -> non-JSON response`); }
}

// Official 2026 WCGA preseason coaches poll, released December 16, 2025.
// Sources: USA Gymnastics (usagym.org/college/national-rankings/010126/)
// and College Gym News (collegegymnews.com, Dec 16, 2025). Do not reuse
// this as a 2027 poll — the 2027 poll had not been released as of 2026-11-23.
const POLL_2026 = {
  status: 'published',
  label: 'Preseason Coaches Poll',
  source: 'WCGA / CGA preseason coaches poll',
  source_url: 'https://usagym.org/college/national-rankings/010126/',
  date: '2025-12-16',
  teams: [
    { rank: 1, name: 'Oklahoma', points: 1960, first_place: 39 },
    { rank: 2, name: 'LSU', points: 1859, first_place: 5 },
    { rank: 3, name: 'Florida', points: 1804, first_place: 4 },
    { rank: 4, name: 'UCLA', points: 1784, first_place: 4 },
    { rank: 5, name: 'Utah', points: 1751, first_place: 1 },
    { rank: 6, name: 'Michigan State', points: 1638, first_place: 0 },
    { rank: 7, name: 'Missouri', points: 1589, first_place: 2 },
    { rank: 8, name: 'Alabama', points: 1518, first_place: 0 },
    { rank: 9, name: 'Kentucky', points: 1434, first_place: 0 },
    { rank: 10, name: 'Arkansas', points: 1433, first_place: 0 },
    { rank: 11, name: 'Auburn', points: 1367, first_place: 0 },
    { rank: 12, name: 'Georgia', points: 1332, first_place: 0 },
    { rank: 13, name: 'Stanford', points: 1256, first_place: 0 },
    { rank: 14, name: 'Michigan', points: 1200, first_place: 0 },
    { rank: 15, name: 'Minnesota', points: 1199, first_place: 0 },
    { rank: 16, name: 'Denver', points: 1132, first_place: 0 },
    { rank: 17, name: 'Oregon State', points: 1004, first_place: 0 },
    { rank: 18, name: 'Arizona', points: 990, first_place: 0 },
    { rank: 19, name: 'Clemson', points: 985, first_place: 0 },
    { rank: 20, name: 'California', points: 880, first_place: 0 },
    { rank: 21, name: 'Ohio State', points: 871, first_place: 0 },
    { rank: 22, name: 'Iowa', points: 779, first_place: 0 },
    { rank: 23, name: 'North Carolina State', points: 739, first_place: 0 },
    { rank: 24, name: 'North Carolina', points: 634, first_place: 0 },
    { rank: 25, name: 'Arizona State', points: 627, first_place: 0 },
    { rank: 26, name: 'Penn State', points: 627, first_place: 0 },
    { rank: 27, name: 'Nebraska', points: 598, first_place: 0 },
    { rank: 28, name: 'Maryland', points: 567, first_place: 0 },
    { rank: 29, name: 'Southern Utah', points: 532, first_place: 0 },
    { rank: 30, name: 'BYU', points: 443, first_place: 0 },
    { rank: 31, name: 'Illinois', points: 429, first_place: 0 },
    { rank: 32, name: 'Boise State', points: 354, first_place: 0 },
    { rank: 33, name: 'Utah State', points: 248, first_place: 0 },
    { rank: 34, name: 'Washington', points: 240, first_place: 0 },
    { rank: 35, name: 'West Virginia', points: 145, first_place: 0 },
    { rank: 36, name: 'Rutgers', points: 131, first_place: 0 },
  ],
  also_receiving: [
    { name: 'Iowa State', points: 120 },
    { name: 'Towson', points: 94 },
    { name: 'Pittsburgh', points: 63 },
    { name: 'UC Davis', points: 61 },
    { name: 'Central Michigan', points: 36 },
    { name: 'George Washington', points: 36 },
    { name: 'San Jose State', points: 32 },
    { name: 'Ball State', points: 31 },
    { name: 'Kent State', points: 29 },
    { name: 'Temple', points: 11 },
    { name: 'Western Michigan', points: 9 },
    { name: 'Pennsylvania', points: 8 },
    { name: 'New Hampshire', points: 7 },
    { name: 'Illinois State', points: 5 },
    { name: 'Sacramento State', points: 4 },
    { name: "Texas Woman's", points: 3 },
    { name: 'Air Force', points: 1 },
    { name: 'Fisk', points: 1 },
  ],
};

function emptyPreseason(season, checkedOn) {
  return {
    status: 'upcoming',
    label: 'Preseason Coaches Poll',
    source: 'WCGA / CGA preseason coaches poll',
    source_url: 'https://usagym.org/college/national-rankings/',
    date: null,
    message: 'Preseason poll coming soon',
    note: `The WCGA/CGA ${season} preseason coaches poll is typically released in mid-December. It had not been published as of ${checkedOn}.`,
    teams: [],
  };
}

function mapRankRow(r) {
  const pick = (...keys) => {
    for (const k of keys) {
      if (r[k] !== undefined && r[k] !== null && r[k] !== '') return r[k];
    }
    return null;
  };
  return {
    tid: pick('tid', 'team_id', 'id'),
    name: decode(pick('name', 'team', 'teamname', 'team_name')),
    conference: decode(pick('con', 'conference', 'conf')),
    div: pick('div', 'division'),
    rank: num(pick('rank', 'rk', 'trank', 'team_rank', 'place', 'pos')),
    prev_rank: num(pick('prior_rank', 'prev_rank', 'prev', 'prk', 'last_rank', 'previous', 'lw', 'prank')),
    nqs: num(pick('nqs', 'NQS', 'tnqs', 'team_nqs', 'rqs')),
    avg: num(pick('ave', 'avg', 'average', 'team_avg')),
    high: num(pick('high', 'hi', 'max', 'team_high')),
    region: pick('reg', 'region') || null,
  };
}

function withMovement(teams, prevByTid) {
  return teams.map(t => {
    const prev = t.prev_rank != null ? t.prev_rank
      : (t.tid != null && prevByTid.has(String(t.tid)) ? prevByTid.get(String(t.tid)) : null);
    const move = (t.rank != null && prev != null) ? prev - t.rank : null; // positive = moved up
    return { ...t, prev_rank: prev, move };
  });
}
const cleanScore = v => {
  const n = num(v);
  if (n === null) return null;
  if (n === 0) return null;
  return Number(n.toFixed(4));
};
function championshipDate(meets) {
  const labeled = (meets || []).filter(m => /championship/i.test(m.desc || m.name || '') && /final/i.test(m.desc || m.name || ''));
  const pool = labeled.length ? labeled : (meets || []);
  const dates = pool.map(m => m.date).filter(isYmd).sort();
  return dates[dates.length - 1] || null;
}
function mapFinalRow(r) {
  const name = decode(r.team_name || r.name);
  const ncaa_final = cleanScore(r.ncaa_final);
  const ncaa = cleanScore(r.ncaa);
  const regional = cleanScore(r.regionals || r.regional);
  const nqs = cleanScore(r.rqs);
  const score = ncaa_final ?? ncaa ?? regional ?? nqs;
  const stage = ncaa_final != null ? 'championship' : ncaa != null ? 'semifinal' : regional != null ? 'regional' : 'nqs';
  const rankRaw = r.rank;
  const rank = num(String(rankRaw ?? '').replace(/\(t\)/gi, '')) ?? num(rankRaw);
  return {
    tid: r.team_id ?? r.tid ?? null,
    name,
    rank,
    nqs, avg: cleanScore(r.average_score), high: cleanScore(r.high_score),
    ncaa_final, ncaa, regional, score, stage,
  };
}
function withRegSeasonMove(finalTeams, week12teams) {
  const prevByName = new Map((week12teams || []).filter(t => t.name).map(t => [t.name, t.rank]));
  const prevByTid = new Map((week12teams || []).filter(t => t.tid != null).map(t => [String(t.tid), t.rank]));
  return finalTeams.map(t => {
    const prev = (t.name && prevByName.has(t.name)) ? prevByName.get(t.name)
      : (t.tid != null && prevByTid.has(String(t.tid)) ? prevByTid.get(String(t.tid)) : null);
    const move = (t.rank != null && prev != null) ? prev - t.rank : null;
    return { ...t, prev_rank: prev, move };
  });
}
async function fetchFinal(season) {
  const res = await rtnGet(`/finalresults/${season}`);
  const raw = res?.data || [];
  const d1 = raw.filter(r => r.division_id === 1 || r.division_id === '1' || r.div === 'Div I')
    .map(mapFinalRow).filter(t => t.name);
  d1.sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99) || (a.name || '').localeCompare(b.name || ''));
  return { teams: d1, hasChamp: d1.some(t => t.ncaa_final != null) };
}
async function maybeStoreFinal(season, prev, weeks, today, meets) {
  const lastMeet = championshipDate(meets) || championshipDate((meets || []).length ? meets : null);
  const seasonOver = lastMeet && today >= lastMeet;
  // Only treat RTN finalresults as official post-championship standings
  // once the NCAA team final has been contested (a team has ncaa_final).
  if (!seasonOver && !(prev.final && prev.final.teams && prev.final.teams.length)) return prev.final || null;
  try {
    const { teams, hasChamp } = await fetchFinal(season);
    if (!hasChamp || !teams.length) {
      log(`  ${season}: finalresults not yet post-championship; keeping previous final if any`);
      return prev.final || null;
    }
    const lastWeekly = [...(weeks || [])].sort((a, b) => a.week - b.week).at(-1);
    const dated = lastMeet || prev.final?.date || today;
    return {
      type: 'rtn-final',
      label: `${season} Final Standings (after NCAA Championships)`,
      source: 'Road to Nationals final standings (NCAA championship order of finish)',
      source_url: `https://www.roadtonationals.com/results/standings/final/${season}`,
      date: dated,
      metric: 'score',
      teams: withRegSeasonMove(teams, lastWeekly?.teams || prev.current?.teams || prev.weeks?.at?.(-1)?.teams),
    };
  } catch (e) {
    log(`  ${season} final standings fetch failed: ${e.message}`);
    return prev.final || null;
  }
}

// When RTN does not give a published date, estimate Week N's Monday from a
// known final-week Monday (2026 Week 12 = 2026-03-23). Other seasons use the
// fetch date only for the current week.
function estimateWeekDate(season, week, maxWeek, fetchedOn) {
  if (season === 2026 && week >= 1 && week <= 12) return addDays('2026-03-23', (week - 12) * 7);
  if (week === maxWeek) return fetchedOn;
  return null;
}

async function loadSeasonMeets(season) {
  const paths = [
    join(DATA, 'seasons', `${season}.json`),
    join(DATA, 'seasons', `${season}-announced.json`),
    join(DATA, 'announced-schedule.json'),
    join(DATA, 'schedule.json'),
  ];
  for (const p of paths) {
    const j = await readJson(p);
    if (!j) continue;
    const meets = j.meets || j.events || [];
    const yr = j.season || j.requested_season;
    const relevant = meets.filter(m => m && isYmd(m.date) && seasonFor(m.date) === season);
    if (!relevant.length) continue;
    if (p.endsWith('schedule.json') && yr && yr !== season && !relevant.length) continue;
    return { file: rel(p), meets: relevant, published: j.season_published !== false };
  }
  return { file: null, meets: [], published: false };
}

function extractSession(json, meet) {
  const m = json && json.meet;
  if (!m) return { perfect10s: [], allArounds: [], teamScores: [], eventHighs: [] };
  const title = meet.desc || m.name || [ ...(meet.home || []), ...(meet.away || []) ].join(' vs ');
  const date = isYmd(meet.date) ? meet.date : (isYmd(m.meet_date) ? m.meet_date : null);
  const perfect10s = [];
  const aaMap = new Map(); // gymnast_id|name -> {events}
  const teams = (m.teams || []).filter(t => t.competing !== 0);
  const use = teams.length ? teams : (m.teams || []);
  for (const t of use) {
    const teamName = decode(t.name);
    for (const ev of t.events || []) {
      const event = EV_BY_NAME[String(ev.event_name || '').toUpperCase()];
      if (!event) continue;
      for (const g of ev.gymnasts || []) {
        const exhibition = (g.order || 0) >= 7;
        if (exhibition) continue;
        const score = num(g.final_score);
        if (score == null) continue;
        const athlete = decode(g.full_name || `${g.first_name || ''} ${g.last_name || ''}`.trim());
        if (!athlete) continue;
        if (isTen(g.final_score)) {
          perfect10s.push({
            athlete, team: teamName, event, score: 10, date,
            meet: title, meet_id: meet.id ?? null, virtius: meet.virtius || null,
          });
        }
        const id = String(g.gymnast_id || athlete);
        const rec = aaMap.get(id) || { athlete, team: teamName, events: {} };
        // Keep the first official (non-exhibition) score on each event.
        if (rec.events[event] == null) rec.events[event] = score;
        aaMap.set(id, rec);
      }
    }
  }
  const allArounds = [];
  for (const rec of aaMap.values()) {
    if (!EVENTS.every(e => rec.events[e] != null)) continue;
    const score = EVENTS.reduce((s, e) => s + rec.events[e], 0);
    // Guard against obviously impossible totals from bad data.
    if (score < 36 || score > 40.0001) continue;
    allArounds.push({
      athlete: rec.athlete, team: rec.team, score: Number(score.toFixed(4)),
      date, meet: title, meet_id: meet.id ?? null, virtius: meet.virtius || null,
      events: Object.fromEntries(EVENTS.map(e => [e, rec.events[e]])),
    });
  }

  const teamScores = [];
  const eventBest = { vault: [], bars: [], beam: [], floor: [] };
  for (const t of use) {
    const teamName = decode(t.name);
    const evTotals = {};
    for (const ev of t.events || []) {
      const event = EV_BY_NAME[String(ev.event_name || '').toUpperCase()];
      if (!event) continue;
      const official = [];
      for (const g of ev.gymnasts || []) {
        if ((g.order || 0) >= 7) continue;
        const score = num(g.final_score);
        if (score == null) continue;
        const athlete = decode(g.full_name || `${g.first_name || ''} ${g.last_name || ''}`.trim());
        official.push(score);
        if (athlete) eventBest[event].push({ athlete, team: teamName, event, score, date, meet: title, meet_id: meet.id ?? null, virtius: meet.virtius || null });
      }
      official.sort((a, b) => b - a);
      const top5 = official.slice(0, 5);
      evTotals[event] = num(ev.event_score) ?? (top5.length ? top5.reduce((s, v) => s + v, 0) : null);
    }
    const summed = EVENTS.reduce((s, e) => s + (evTotals[e] || 0), 0);
    const allFour = EVENTS.every(e => evTotals[e] != null);
    const score = num(t.final_score) ?? (allFour ? summed : (summed > 0 ? summed : null));
    if (score != null && score >= 100 && score <= 200.0001) {
      teamScores.push({
        team: teamName, score: Number(score.toFixed(4)),
        date, meet: title, meet_id: meet.id ?? null, virtius: meet.virtius || null,
      });
    }
  }
  const eventHighs = [];
  for (const event of EVENTS) {
    const list = eventBest[event];
    if (!list.length) continue;
    const best = Math.max(...list.map(x => x.score));
    const tied = list.filter(x => Math.abs(x.score - best) < 1e-9)
      .filter((x, i, arr) => arr.findIndex(y => y.athlete === x.athlete && y.team === x.team) === i);
    eventHighs.push(...tied);
  }
  return { perfect10s, allArounds, teamScores, eventHighs };
}

async function fetchVirtius(key, attempt = 1) {
  const url = `https://api.virti.us/session/${encodeURIComponent(key)}/json`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 20000);
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (e) {
    if (attempt < 3) {
      await sleep(400 * attempt);
      return fetchVirtius(key, attempt + 1);
    }
    throw e;
  } finally {
    clearTimeout(t);
  }
}

async function pool(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx], idx);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

function summarizeSeason(sessions) {
  const perfect10s = [];
  const allArounds = [];
  for (const s of Object.values(sessions)) {
    for (const p of s.perfect10s || []) perfect10s.push(p);
    for (const a of s.allArounds || []) allArounds.push(a);
  }
  const tenKey = p => `${p.date}|${p.virtius}|${p.athlete}|${p.event}|${p.team}`;
  const seen = new Set();
  const tens = perfect10s.filter(p => { const k = tenKey(p); if (seen.has(k)) return false; seen.add(k); return true; })
    .sort((a, b) => (a.date || '').localeCompare(b.date || '') || (a.athlete || '').localeCompare(b.athlete || '') || (a.event || '').localeCompare(b.event || ''));

  const byDate = [...allArounds].sort((a, b) => (a.date || '').localeCompare(b.date || '') || b.score - a.score);
  let best = -1;
  const highByDate = [];
  let currentTied = [];
  for (const a of byDate) {
    if (a.score > best + 1e-9) {
      best = a.score;
      currentTied = [a];
      highByDate.push({ as_of: a.date, score: a.score, tied: [publicAA(a)] });
    } else if (Math.abs(a.score - best) < 1e-9) {
      if (!currentTied.some(x => x.athlete === a.athlete && x.team === a.team && x.date === a.date && x.virtius === a.virtius)) {
        currentTied = currentTied.concat([a]);
        highByDate.push({ as_of: a.date, score: a.score, tied: currentTied.map(publicAA) });
      }
    }
  }
  const finalTied = best >= 0
    ? allArounds.filter(a => Math.abs(a.score - best) < 1e-9)
      .filter((a, i, arr) => arr.findIndex(x => x.athlete === a.athlete && x.team === a.team && x.date === a.date && x.virtius === a.virtius) === i)
      .sort((a, b) => (a.date || '').localeCompare(b.date || '') || a.athlete.localeCompare(b.athlete))
      .map(publicAA)
    : [];
  return {
    perfect10s: tens.map(publicTen),
    allAroundHigh: best >= 0 ? { score: best, tied: finalTied } : { score: null, tied: [] },
    allAroundHighByDate: highByDate,
    weekends: summarizeWeekends(sessions),
  };
}
function publicTen(p) {
  return { athlete: p.athlete, team: p.team, event: p.event, score: 10, date: p.date, meet: p.meet, meet_id: p.meet_id ?? null, virtius: p.virtius || null };
}
function publicAA(a) {
  return { athlete: a.athlete, team: a.team, score: a.score, date: a.date, meet: a.meet, meet_id: a.meet_id ?? null, virtius: a.virtius || null };
}
function publicTeamScore(t) {
  return { team: t.team, score: t.score, date: t.date, meet: t.meet, meet_id: t.meet_id ?? null, virtius: t.virtius || null };
}
function publicEventHigh(e) {
  return { athlete: e.athlete, team: e.team, event: e.event, score: e.score, date: e.date, meet: e.meet, meet_id: e.meet_id ?? null, virtius: e.virtius || null };
}
function sundayOf(ymd) {
  const d = new Date(ymd + 'T12:00:00Z');
  const add = d.getUTCDay() === 0 ? 0 : 7 - d.getUTCDay();
  d.setUTCDate(d.getUTCDate() + add);
  return d.toISOString().slice(0, 10);
}
function weekendLabel(start, end) {
  if (!start) return '';
  if (start === end) {
    const a = new Date(start + 'T12:00:00Z');
    return a.toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' });
  }
  const a = new Date(start + 'T12:00:00Z');
  const b = new Date(end + 'T12:00:00Z');
  const sameMonth = a.getUTCMonth() === b.getUTCMonth();
  const left = a.toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' });
  const right = b.toLocaleDateString('en-US', { timeZone: 'UTC', month: sameMonth ? undefined : 'short', day: 'numeric' });
  return `${left}–${right}`;
}
function summarizeWeekends(sessions) {
  const weeks = new Map();
  const bucket = ymd => {
    const id = sundayOf(ymd);
    if (!weeks.has(id)) weeks.set(id, { id, start: ymd, end: ymd, team197: [], events: { vault: [], bars: [], beam: [], floor: [] }, meetKeys: new Set() });
    const w = weeks.get(id);
    if (ymd < w.start) w.start = ymd;
    if (ymd > w.end) w.end = ymd;
    return w;
  };
  for (const [key, s] of Object.entries(sessions)) {
    const date = isYmd(s.date) ? s.date : null;
    if (!date) continue;
    const w = bucket(date);
    w.meetKeys.add(key);
    for (const t of s.teamScores || []) {
      if (t.score != null && t.score >= 197 - 1e-9) w.team197.push(publicTeamScore(t));
    }
    for (const e of s.eventHighs || []) {
      if (e.event && w.events[e.event]) w.events[e.event].push(e);
    }
  }
  return [...weeks.values()].sort((a, b) => a.end.localeCompare(b.end) || a.start.localeCompare(b.start)).map(w => {
    const eventHighs = {};
    for (const event of EVENTS) {
      const list = w.events[event];
      if (!list.length) { eventHighs[event] = []; continue; }
      const best = Math.max(...list.map(x => x.score));
      eventHighs[event] = list.filter(x => Math.abs(x.score - best) < 1e-9)
        .filter((x, i, arr) => arr.findIndex(y => y.athlete === x.athlete && y.team === x.team && y.date === x.date && (y.virtius || '') === (x.virtius || '')) === i)
        .sort((a, b) => (a.date || '').localeCompare(b.date || '') || a.athlete.localeCompare(b.athlete))
        .map(publicEventHigh);
    }
    const seenT = new Set();
    const team197 = w.team197.filter(t => {
      const k = `${t.date}|${t.virtius || ''}|${t.team}|${t.score}`;
      if (seenT.has(k)) return false;
      seenT.add(k);
      return true;
    }).sort((a, b) => b.score - a.score || (a.date || '').localeCompare(b.date || '') || a.team.localeCompare(b.team));
    return {
      id: w.id, start: w.start, end: w.end, label: weekendLabel(w.start, w.end),
      meets: w.meetKeys.size, team197, eventHighs,
    };
  });
}

async function buildSeasonStats() {
  const cachePath = join(DATA, 'virtius-score-cache.json');
  const outPath = join(DATA, 'season-stats.json');
  const today = ymdInTz(new Date());
  const natural = seasonFor(today);
  const wanted = new Set([natural, natural - 1, 2026, 2027]);
  if (args.season) wanted.add(Number(args.season));

  const cache = (await readJson(cachePath)) || { sessions: {} };
  cache.sessions ||= {};
  const force = !!args['refresh-sessions'];
  const seasons = {};

  for (const season of [...wanted].sort()) {
    const { file, meets } = await loadSeasonMeets(season);
    const withKey = meets.filter(m => m.virtius);
    log(`Season ${season}: ${meets.length} official meets${file ? ` from ${file}` : ' (no schedule file yet)'}, ${withKey.length} with Virtius keys`);
    const todayKeys = new Set(withKey.filter(m => m.date === today || m.date === addDays(today, -1)).map(m => m.virtius));
    const stale = s => !s || !Array.isArray(s.teamScores) || !Array.isArray(s.eventHighs);
    const todo = withKey.filter(m => force || stale(cache.sessions[m.virtius]) || todayKeys.has(m.virtius));
    log(`  fetching ${todo.length} Virtius sessions (${withKey.length - todo.length} cached)`);
    let ok = 0, fail = 0;
    await pool(todo, VIRTIUS_CONCURRENCY, async (meet, idx) => {
      try {
        const json = await fetchVirtius(meet.virtius);
        const extracted = extractSession(json, meet);
        cache.sessions[meet.virtius] = {
          date: meet.date, meet_id: meet.id ?? null, name: meet.desc || meet.name || null,
          perfect10s: extracted.perfect10s, allArounds: extracted.allArounds,
          teamScores: extracted.teamScores, eventHighs: extracted.eventHighs,
          fetched_at: new Date().toISOString(),
        };
        ok++;
        if ((idx + 1) % 25 === 0 || idx === todo.length - 1) log(`  … ${idx + 1}/${todo.length} (${ok} ok, ${fail} failed)`);
      } catch (e) {
        fail++;
        log(`  ! ${meet.date} ${meet.virtius}: ${e.message}`);
      }
    });

    const seasonSessions = {};
    const missing = [];
    for (const m of withKey) {
      if (cache.sessions[m.virtius]) seasonSessions[m.virtius] = cache.sessions[m.virtius];
      else missing.push({ date: m.date, virtius: m.virtius, meet: m.desc || m.id });
    }
    const summary = summarizeSeason(seasonSessions);
    const n197 = summary.weekends.reduce((n, w) => n + w.team197.length, 0);
    log(`  perfect 10s: ${summary.perfect10s.length}; AA high: ${summary.allAroundHigh.score ?? 'none'}${summary.allAroundHigh.tied.length ? ' (' + summary.allAroundHigh.tied.map(t => t.athlete).join(', ') + ')' : ''}; weekends: ${summary.weekends.length} (${n197} scores of 197+)`);
    seasons[String(season)] = {
      meets: meets.length,
      meets_with_virtius: withKey.length,
      meets_scored: Object.keys(seasonSessions).length,
      meets_missing: missing,
      source: 'Virtius session JSON for official D1 season meets (final scores only; exhibitions excluded)',
      ...summary,
    };
  }

  // Drop cache entries that no longer belong to a known session? Keep them; they are small.
  await writeJsonIfChanged(cachePath, { generated_at: new Date().toISOString(), sessions: cache.sessions }, ['generated_at', 'fetched_at']);
  await writeJsonIfChanged(outPath, { generated_at: new Date().toISOString(), seasons });
}

async function fetchWeek(season, week) {
  const res = await rtnGet(`/results/${season}/${week}/0/5`);
  const raw = res?.data || [];
  if (raw[0]) log(`  week ${week} row keys: ${Object.keys(raw[0]).join(', ')}`);
  const rows = raw.map(mapRankRow).filter(r => r.div === 'Div I' || r.div === 'I' || r.div === 1 || (!r.div && r.name));
  const d1 = (raw.some(r => r.div === 'Div I') ? rows.filter(r => r.div === 'Div I') : rows)
    .filter(r => r.name);
  d1.sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99) || (b.nqs ?? 0) - (a.nqs ?? 0) || a.name.localeCompare(b.name));
  return d1.map(({ div, ...rest }) => rest);
}


async function dropUnstartedRtn(seasons, today) {
  for (const [yr, block] of Object.entries(seasons)) {
    const season = Number(yr);
    if (!block || block.preseason?.status === 'published' && !block.weeks?.length && !block.current) continue;
    const { meets } = await loadSeasonMeets(season);
    const firstMeet = (meets || []).map(m => m.date).filter(isYmd).sort()[0];
    const notStarted = (firstMeet && today < firstMeet) || (!firstMeet && today < `${season}-01-01`);
    if (notStarted && (block.weeks?.length || block.current)) {
      log(`  dropping RTN weeks for unstarted ${season} season`);
      block.current = null;
      block.weeks = [];
    }
    // Never drop a completed season's final championship standings.
  }
}

async function buildRankings() {
  const path = join(DATA, 'rankings.json');
  const existing = (await readJson(path)) || {};
  const today = ymdInTz(new Date());
  const natural = seasonFor(today);
  const seasons = { ...(existing.seasons || {}) };
  const freshMs = Date.now() - Date.parse(existing.generated_at || 0);
  const skipFetch = !args.history && !args.force && existing.seasons && Number.isFinite(freshMs) && freshMs < 20 * 3600e3;
  if (skipFetch) {
    log(`Rankings fetched ${Math.round(freshMs / 3600e3)}h ago; skipping weekly RTN until 20h have passed (use --force to refresh).`);
    seasons['2026'] = { ...(seasons['2026'] || {}), preseason: POLL_2026 };
    if (!seasons['2027'] || seasons['2027'].preseason?.status !== 'published') {
      seasons['2027'] = { ...(seasons['2027'] || {}), preseason: emptyPreseason(2027, today), current: null, weeks: [] };
    }
    await dropUnstartedRtn(seasons, today);
    // If a completed season is missing official post-championship standings, fetch just that.
    for (const yr of Object.keys(seasons)) {
      const block = seasons[yr];
      if (block?.final?.teams?.length) continue;
      const season = Number(yr);
      const { meets } = await loadSeasonMeets(season);
      const last = championshipDate(meets);
      if (last && today >= last) {
        const fin = await maybeStoreFinal(season, block || {}, block?.weeks || [], today, meets);
        if (fin) seasons[yr] = { ...block, final: fin };
      }
    }
    await writeJsonIfChanged(path, {
      generated_at: existing.generated_at || new Date().toISOString(),
      source: existing.source || 'WCGA preseason coaches poll (when published); in season, Road to Nationals weekly NQS; after championships, RTN final standings (GET /api/women/finalresults/{year})',
      seasons,
    }, ['generated_at']);
    return;
  }

  // Always keep the published 2026 poll; never invent a 2027 poll.
  seasons['2026'] = {
    ...(seasons['2026'] || {}),
    preseason: POLL_2026,
  };
  if (!seasons['2027'] || seasons['2027'].preseason?.status !== 'published') {
    seasons['2027'] = {
      ...(seasons['2027'] || {}),
      preseason: emptyPreseason(2027, today),
    };
  }

  const wantSeasons = new Set([natural, natural - 1]);
  if (args.season) wantSeasons.add(Number(args.season));
  // Completed 2026 rankings are needed for ?season=2026 previews.
  wantSeasons.add(2026);

  for (const season of [...wantSeasons].sort()) {
    const prev = seasons[String(season)] || {};
    try {
      // RTN often answers an unpublished season with last season's weeks.
      // Only store in-season rankings after that season's first official meet.
      const { meets } = await loadSeasonMeets(season);
      const firstMeet = (meets || []).map(m => m.date).filter(isYmd).sort()[0];
      if (firstMeet && today < firstMeet) {
        log(`  ${season} season has not started (first meet ${firstMeet}); skipping RTN weeks so a previous season is not shown as current.`);
        seasons[String(season)] = {
          preseason: prev.preseason || (season === 2026 ? POLL_2026 : emptyPreseason(season, today)),
          current: null,
          weeks: [],
          final: prev.final || null,
        };
        continue;
      }
      if (!firstMeet && season >= seasonFor(today) && today < `${season}-01-01`) {
        log(`  ${season} schedule not in-season yet; skipping RTN weeks.`);
        seasons[String(season)] = {
          preseason: prev.preseason || emptyPreseason(season, today),
          current: null,
          weeks: [],
          final: prev.final || null,
        };
        continue;
      }
      const cw = await rtnGet(`/currentweek/${season}`);
      const maxWeek = Number(cw?.max) || 0;
      const currentHint = Number(cw?.week) || 0;
      // week 100 (and similar) is a postseason sentinel; official weekly NQS uses 1..max.
      const latest = maxWeek;
      if (!latest) {
        log(`  no ranking weeks for ${season}`);
        const fin = await maybeStoreFinal(season, prev, prev.weeks || [], today, meets);
        seasons[String(season)] = { ...prev, preseason: prev.preseason || (season === 2026 ? POLL_2026 : emptyPreseason(season, today)), current: prev.current || null, weeks: prev.weeks || [], final: fin };
        continue;
      }
      const have = new Map((prev.weeks || []).map(w => [w.week, w]));
      const weeksToFetch = new Set();
      weeksToFetch.add(latest);
      if (latest > 1) weeksToFetch.add(latest - 1);
      if (args.history) {
        for (let w = 1; w <= latest; w++) {
          if (!have.has(w)) weeksToFetch.add(w);
        }
      }
      // Always refresh the latest week; keep cached earlier weeks unless --history missed them.
      const fetched = {};
      for (const w of [...weeksToFetch].sort((a, b) => a - b)) {
        try {
          fetched[w] = await fetchWeek(season, w);
        } catch (e) {
          log(`  week ${w} failed: ${e.message}`);
        }
      }
      const weeks = [];
      for (let w = 1; w <= latest; w++) {
        const teamsRaw = fetched[w] || have.get(w)?.teams;
        if (!teamsRaw) continue;
        const prevWeek = weeks[weeks.length - 1];
        const prevByTid = new Map((prevWeek?.teams || []).filter(t => t.tid != null).map(t => [String(t.tid), t.rank]));
        const teams = withMovement(teamsRaw, prevByTid);
        const asOf = have.get(w)?.date && !fetched[w] ? have.get(w).date : estimateWeekDate(season, w, latest, today);
        weeks.push({
          week: w,
          date: asOf,
          metric: 'NQS',
          teams,
        });
      }
      const last = weeks[weeks.length - 1] || null;
      const current = last ? {
        type: 'rtn',
        label: last.week >= latest && season < natural
          ? `RTN National Rankings, final regular season (Week ${last.week})`
          : `RTN National Rankings, updated ${last.date || today}`,
        source: 'Road to Nationals',
        source_url: `https://www.roadtonationals.com/results/standings/season/${season}/${last.week}/0/5`,
        date: last.date,
        week: last.week,
        metric: 'NQS',
        teams: last.teams,
      } : (prev.current || null);
      const fin = await maybeStoreFinal(season, prev, weeks, today, meets);
      seasons[String(season)] = {
        preseason: prev.preseason || (season === 2026 ? POLL_2026 : emptyPreseason(season, today)),
        current,
        weeks,
        final: fin,
      };
      log(`  ${season}: ${weeks.length} week(s) stored; current week ${current?.week ?? 'none'}; final ${fin ? fin.teams.length + ' teams' : 'none'}`);
    } catch (e) {
      log(`  rankings for ${season} failed: ${e.message}`);
      seasons[String(season)] = {
        preseason: prev.preseason || (season === 2026 ? POLL_2026 : emptyPreseason(season, today)),
        current: prev.current || null,
        weeks: prev.weeks || [],
        final: prev.final || null,
      };
    }
  }

  await dropUnstartedRtn(seasons, today);
  await writeJsonIfChanged(path, {
    generated_at: new Date().toISOString(),
    source: 'WCGA preseason coaches poll (when published); in season, Road to Nationals weekly NQS; after championships, RTN final standings (GET /api/women/finalresults/{year}, Div I)',
    seasons,
  });
}

async function main() {
  const onlyR = !!args['rankings-only'];
  const onlyS = !!args['stats-only'];
  if (!onlyS) await buildRankings();
  if (!onlyR) await buildSeasonStats();
}

main().catch(err => { console.error(err); process.exit(1); });
