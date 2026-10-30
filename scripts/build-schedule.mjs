#!/usr/bin/env node
// Builds data/schedule.json (D1 women's gymnastics meets) from Road to Nationals,
// plus data/results/{meet_id}.json fallbacks for non-Virtius meets on today's date.
// No npm deps; Node 18+ (global fetch).
//
// Usage:
//   node scripts/build-schedule.mjs                     # normal run
//   node scripts/build-schedule.mjs --results-date=2026-03-21   # also build RTN fallbacks for that date
//   node scripts/build-schedule.mjs --refresh-teams     # force refresh of the D1 team list
//   node scripts/build-schedule.mjs --no-results        # schedule only
//
// Politeness: RTN robots.txt asks for crawl-delay 30, so every RTN request is spaced
// >= 30 s apart (override with RTN_DELAY_MS for local testing only).

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = join(ROOT, 'data');
const RTN = 'https://www.roadtonationals.com/api/women';
const TZ = 'America/Chicago';
const RTN_DELAY_MS = Number(process.env.RTN_DELAY_MS ?? 30000);
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 TheFiveThatScore-Scoreboard/1.0 (+https://x.com/thefivethatscore)';

const args = Object.fromEntries(process.argv.slice(2).map(a => {
  const [k, v] = a.replace(/^--/, '').split('=');
  return [k, v ?? true];
}));

// ---------- helpers ----------
let lastRtn = 0;
const sleep = ms => new Promise(r => setTimeout(r, ms));
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
function log(...a) { console.log(...a); }
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
const rel = p => p.replace(ROOT + '/', '');
const decode = s => String(s ?? '').replace(/&amp;/g, '&').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();
const splitTeams = s => decode(s).split(',').map(t => t.trim()).filter(Boolean);

function ymdInTz(date, tz = TZ) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}
function addDays(ymd, n) {
  const d = new Date(ymd + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10);
}
function tzOffsetMs(utcMs, tz) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
    .formatToParts(new Date(utcMs)).map(x => [x.type, x.value]));
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - utcMs;
}
// wall-clock time in tz -> ISO UTC
function zonedToUtcIso(ymd, hms, tz) {
  const [y, m, d] = ymd.split('-').map(Number);
  const [hh, mm, ss] = (hms || '00:00:00').split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm, ss || 0);
  let t = guess - tzOffsetMs(guess, tz);
  t = guess - tzOffsetMs(t, tz);
  return new Date(t).toISOString();
}
function virtiusKey(link) {
  if (!link) return null;
  const m = String(link).match(/virti\.us\/[^\s]*?[?&]s=([A-Za-z0-9_-]+)/i);
  return m ? m[1] : null;
}
const seasonFor = ymd => { const [y, m] = ymd.split('-').map(Number); return m >= 7 ? y + 1 : y; };

// ---------- D1 team list ----------
// Source: RTN national team rankings, GET /api/women/results/{year}/{week}/0/5 (the data behind
// roadtonationals.com/results/standings), each row has div: "Div I" | "Div II" | "Div III".
async function loadD1Teams(season, force) {
  const file = join(DATA, 'd1-teams.json');
  const existing = await readJson(file);
  const fresh = existing && (Date.now() - new Date(existing.generated_at).getTime()) < 20 * 3600e3;
  if (existing && fresh && !force && existing.season >= season - 1) { log(`D1 team list: cached (${existing.teams.length} teams, season ${existing.season})`); return existing; }
  for (const yr of [season, season - 1]) {
    try {
      const cw = await rtnGet(`/currentweek/${yr}`);
      const week = Number(cw?.max) || 0;
      if (!week) { log(`  no ranking weeks for ${yr}`); continue; }
      const res = await rtnGet(`/results/${yr}/${week}/0/5`);
      const rows = (res?.data || []).filter(r => r.div === 'Div I');
      if (rows.length < 40) { log(`  only ${rows.length} D1 rows for ${yr}; trying earlier season`); continue; }
      const out = {
        generated_at: new Date().toISOString(),
        season: yr,
        week,
        source: `${RTN}/results/${yr}/${week}/0/5 (Road to Nationals national team rankings, rows with div = "Div I")`,
        teams: rows.map(r => ({ tid: r.tid, name: decode(r.name), conference: decode(r.con) })).sort((a, b) => a.name.localeCompare(b.name)),
      };
      await writeJsonIfChanged(file, out);
      return out;
    } catch (e) { log(`  D1 list fetch failed for ${yr}: ${e.message}`); }
  }
  if (existing) { log('  using existing d1-teams.json'); return existing; }
  throw new Error('No D1 team list available');
}

// ---------- schedule ----------
function validSeason(sched, season) {
  if (!sched || typeof sched !== 'object' || Array.isArray(sched)) return false;
  const keys = Object.keys(sched).filter(k => /^\d{4}-\d{2}-\d{2}$/.test(k));
  // RTN returns the latest published season when asked for a future one, so check the dates.
  return keys.length > 0 && keys.every(k => seasonFor(k) === season);
}

function normalizeSchedule(sched, d1Set, overrides) {
  const meets = [];
  for (const [date, day] of Object.entries(sched)) {
    for (const m of day.meets || []) {
      const home = splitTeams(m.home_teams), away = splitTeams(m.away_teams);
      const teams = [...home, ...away];
      const isD1 = t => (d1Set.has(t) || overrides.include.includes(t)) && !overrides.exclude.includes(t);
      if (!teams.some(isD1)) continue;
      const d = m.d || date;
      const time = m.time || null;
      meets.push({
        id: m.meet_id,
        date: d,
        time_et: time,                         // RTN times are US Eastern
        start_utc: time ? zonedToUtcIso(d, time, 'America/New_York') : null,
        desc: decode(m.meet_desc || m.newdesc),
        home, away,
        d1_teams: teams.filter(isD1),
        virtius: virtiusKey(m.stats_link),
        stats_link: m.stats_link || null,
        video_link: m.video_link || null,
        video_desc: decode(m.video_desc) || null,
        rtn_url: `https://www.roadtonationals.com/results/schedule/women/meet/${m.meet_id}`,
      });
    }
  }
  meets.sort((a, b) => (a.date + (a.time_et || '')).localeCompare(b.date + (b.time_et || '')) || a.id - b.id);
  return meets;
}

// ---------- RTN results fallback ----------
const EVENTS = ['vault', 'bars', 'beam', 'floor'];
function normalizeResults(meet, r) {
  const num = v => (v === null || v === undefined || v === '' ? null : Number(v));
  const teams = (r.teams || []).map((t, i) => {
    const roster = (r.scores || []).find(arr => arr[0]?.team_id === t.tid) || (r.scores || [])[i] || [];
    return {
      name: decode(t.tname), tid: t.tid, home: t.home === 'H',
      final_score: num(t.tscore),
      events: EVENTS.map(ev => ({
        event: ev, score: num(t[ev]),
        gymnasts: roster.filter(g => num(g[ev]) !== null).map(g => ({ name: decode(`${g.first_name} ${g.last_name}`), score: num(g[ev]) })),
      })),
      all_around: roster.filter(g => num(g.all_around) !== null).map(g => ({ name: decode(`${g.first_name} ${g.last_name}`), score: num(g.all_around) })),
    };
  });
  const sorted = [...teams].filter(t => t.final_score).sort((a, b) => b.final_score - a.final_score);
  teams.forEach(t => { const p = sorted.indexOf(t); t.place = p >= 0 ? p + 1 : null; });
  const board = list => (list || []).map(g => ({ name: decode(`${g.fname} ${g.lname}`), team: decode(g.tname), score: Number(g.score), place: g.place }));
  return {
    generated_at: new Date().toISOString(),
    source: `${RTN}/meetresults/${meet.id}`,
    meet_id: meet.id,
    live: !!r.info?.live,
    host: decode(r.info?.host),
    teams,
    leaderboards: { vault: board(r.vault), bars: board(r.bars), beam: board(r.beam), floor: board(r.floor), aa: board(r.aa) },
  };
}

async function buildResults(meets, dates) {
  const now = Date.now();
  const targets = meets.filter(m => dates.includes(m.date) && !m.virtius);
  log(`RTN fallback results: ${targets.length} non-Virtius meet(s) on ${dates.join(', ')}`);
  for (const m of targets) {
    const file = join(DATA, 'results', `${m.id}.json`);
    const old = await readJson(file);
    if (m.start_utc && new Date(m.start_utc).getTime() > now + 15 * 60e3 && !args['results-date']) { log(`  ${m.id}: not started yet, skip`); continue; }
    if (old && !old.live && old.teams?.length && old.teams.every(t => t.final_score) && (now - new Date(old.generated_at).getTime()) > 3 * 3600e3) { log(`  ${m.id}: final already stored, skip`); continue; }
    try {
      const r = await rtnGet(`/meetresults/${m.id}`);
      if (!r?.teams?.length) { log(`  ${m.id}: no results yet`); continue; }
      await writeJsonIfChanged(file, normalizeResults(m, r));
    } catch (e) { log(`  ${m.id}: ${e.message}`); }
  }
}

// ---------- main ----------
async function main() {
  const today = ymdInTz(new Date());
  const season = Number(args.season) || seasonFor(today);
  log(`Today (${TZ}): ${today}; target season: ${season}`);

  const d1 = await loadD1Teams(season, !!args['refresh-teams']);
  const d1Set = new Set(d1.teams.map(t => t.name));
  const overrides = await readJson(join(DATA, 'd1-overrides.json'), { include: [], exclude: [] });
  overrides.include ||= []; overrides.exclude ||= [];

  let raw = await rtnGet(`/schedule/${season}/1`);
  let usedSeason = season, published = validSeason(raw, season);
  if (!published) {
    log(`RTN has not published the ${season} schedule yet (response contains other seasons' dates).`);
    const prev = season - 1;
    if (validSeason(raw, prev)) raw = raw; else raw = await rtnGet(`/schedule/${prev}/1`);
    usedSeason = prev;
    if (!validSeason(raw, prev)) {
      const cached = await readJson(join(DATA, 'seasons', `${prev}.json`));
      if (!cached) throw new Error('No usable schedule from RTN');
      raw = null; log('  using cached season file');
    }
  }

  let meets;
  if (raw) {
    meets = normalizeSchedule(raw, d1Set, overrides);
    await writeJsonIfChanged(join(DATA, 'seasons', `${usedSeason}.json`), {
      generated_at: new Date().toISOString(), season: usedSeason,
      source: `${RTN}/schedule/${usedSeason}/1`, meets,
    });
  } else {
    meets = (await readJson(join(DATA, 'seasons', `${usedSeason}.json`))).meets;
  }

  const upcoming = meets.filter(m => m.date >= today);
  await writeJsonIfChanged(join(DATA, 'schedule.json'), {
    generated_at: new Date().toISOString(),
    today,
    requested_season: season,
    season: usedSeason,
    season_published: published,
    note: published ? null : `Road to Nationals has not published the ${season} schedule yet; showing the ${usedSeason} season.`,
    source: `${RTN}/schedule/${usedSeason}/1`,
    d1_team_source: d1.source,
    meet_count: meets.length,
    first_date: meets[0]?.date || null,
    last_date: meets.at(-1)?.date || null,
    next_date: upcoming[0]?.date || null,
    meets,
  });
  log(`Schedule: ${meets.length} D1 meets in season ${usedSeason} (published ${season}: ${published})`);

  if (!args['no-results']) {
    const dates = [today, addDays(today, -1)];
    if (args['results-date']) dates.push(args['results-date']);
    await buildResults(meets, dates);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
