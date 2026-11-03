#!/usr/bin/env node
// Finds Virtius session keys for preseason intrasquad meets by reading D1 schools' public
// athletics gymnastics schedule pages (mostly Sidearm / WMT sites) and looking for virti.us links.
// Each key found is checked against the public Virtius session JSON
// (https://api.virti.us/session/{key}/json): a session counts as an intrasquad when every team in it
// shares one team_id (two squads of one school, or one school scored as a single team).
//
// Output: data/intrasquads-discovered.json (generated; the site merges it with data/intrasquads.json)
//         data/discovery-status.json        (which schedule pages could be read)
//
// Usage:
//   node scripts/discover-intrasquads.mjs            # full run: every school (daily)
//   node scripts/discover-intrasquads.mjs --due      # only schools with a key-less intrasquad today (10-min runs)
//   node scripts/discover-intrasquads.mjs --only=Minnesota,Michigan --url-suffix=/2026
//
// Fails soft: every school is isolated in try/catch and the script always exits 0 (unless --strict).
// Politeness: one request at a time, >= DISCOVER_DELAY_MS (default 3 s) between requests, robots.txt
// Disallow rules and Crawl-delay (<= 30 s) are honoured, and a normal browser User-Agent is sent.
// No npm deps; Node 18+.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = join(ROOT, 'data');
const TZ = 'America/Chicago';
const DELAY_MS = Number(process.env.DISCOVER_DELAY_MS ?? 3000);   // min gap between requests to one host
const GLOBAL_GAP_MS = 750;                                          // min gap between any two requests
const MAX_VIRTIUS_LOOKUPS = 80;
const TIMEOUT_MS = 25000;
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 TheFiveThatScore-Scoreboard/1.0 (+https://x.com/thefivethatscore)';
const VIRTIUS_API = k => `https://api.virti.us/session/${encodeURIComponent(k)}/json`;
const KEY_RE = /^[A-Za-z0-9_-]{6,32}$/;

const args = Object.fromEntries(process.argv.slice(2).map(a => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? true]; }));

// RTN team name -> athletics site (+ optional explicit schedule path(s)). Paths are tried in order
// after any URL that worked last time (remembered in discovery-status.json).
const SITES = {
  'Air Force': { site: 'goairforcefalcons.com' },
  'Alabama': { site: 'rolltide.com' },
  'Alaska': { site: 'goseawolves.com' },
  'Arizona': { site: 'arizonawildcats.com' },
  'Arizona State': { site: 'thesundevils.com' },
  'Arkansas': { site: 'arkansasrazorbacks.com', paths: ['/sport/w-gym/schedule/'] },
  'Auburn': { site: 'auburntigers.com' },
  'Ball State': { site: 'ballstatesports.com' },
  'Boise State': { site: 'broncosports.com' },
  'Bowling Green': { site: 'bgsufalcons.com' },
  'Brown': { site: 'brownbears.com' },
  'BYU': { site: 'byucougars.com' },
  'California': { site: 'calbears.com' },
  'Central Michigan': { site: 'cmuchippewas.com' },
  'Clemson': { site: 'clemsontigers.com', paths: ['/sports/gymnastics/schedule/'] },
  'Cornell': { site: 'cornellbigred.com' },
  'Denver': { site: 'denverpioneers.com' },
  'Eastern Michigan': { site: 'emueagles.com' },
  'Florida': { site: 'floridagators.com', paths: ['/sports/gymnastics/schedule'] },
  'George Washington': { site: 'gwsports.com' },
  'Georgia': { site: 'georgiadogs.com' },
  'Illinois': { site: 'fightingillini.com' },
  'Illinois State': { site: 'goredbirds.com' },
  'Iowa': { site: 'hawkeyesports.com', paths: ['/sports/wgym/schedule/'] },
  'Iowa State': { site: 'cyclones.com' },
  'Kent State': { site: 'kentstatesports.com' },
  'Kentucky': { site: 'ukathletics.com', paths: ['/sports/gymnastics/schedule/'] },
  'LIU': { site: 'liuathletics.com' },
  'LSU': { site: 'lsusports.net', paths: ['/sports/gymnastics/schedule/', '/sports/gym/schedule/'] },
  'Maryland': { site: 'umterps.com' },
  'Michigan': { site: 'mgoblue.com' },
  'Michigan State': { site: 'msuspartans.com' },
  'Minnesota': { site: 'gophersports.com' },
  'Missouri': { site: 'mutigers.com' },
  'Nebraska': { site: 'huskers.com' },
  'New Hampshire': { site: 'unhwildcats.com' },
  'North Carolina': { site: 'goheels.com' },
  'North Carolina State': { site: 'gopack.com' },
  'Northern Illinois': { site: 'niuhuskies.com' },
  'Ohio State': { site: 'ohiostatebuckeyes.com', paths: ['/sports/womens-gymnastics/schedule/'] },
  'Oklahoma': { site: 'soonersports.com' },
  'Oregon State': { site: 'osubeavers.com' },
  'Penn State': { site: 'gopsusports.com' },
  'Pennsylvania': { site: 'pennathletics.com' },
  'Pittsburgh': { site: 'pittsburghpanthers.com' },
  'Rutgers': { site: 'scarletknights.com' },
  'S.E. Missouri': { site: 'semoredhawks.com' },
  'Sacramento State': { site: 'hornetsports.com' },
  'San Jose State': { site: 'sjsuspartans.com' },
  'Southern Utah': { site: 'suutbirds.com' },
  'Stanford': { site: 'gostanford.com' },
  'Temple': { site: 'owlsports.com' },
  'Towson': { site: 'towsontigers.com' },
  'UC Davis': { site: 'ucdavisaggies.com' },
  'UCLA': { site: 'uclabruins.com' },
  'Utah': { site: 'utahutes.com' },
  'Utah State': { site: 'utahstateaggies.com' },
  'Washington': { site: 'gohuskies.com' },
  'West Virginia': { site: 'wvusports.com' },
  'Western Michigan': { site: 'wmubroncos.com' },
  'William & Mary': { site: 'tribeathletics.com' },
  'Yale': { site: 'yalebulldogs.com' },
};
const DEFAULT_PATHS = ['/sports/womens-gymnastics/schedule', '/sports/gymnastics/schedule', '/sports/wgym/schedule', '/sports/w-gym/schedule', '/sport/w-gym/schedule/'];

// ---------- helpers ----------
const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = (...a) => console.log(...a);
const rel = p => p.replace(ROOT + '/', '');
async function readJson(p, fb = null) { try { return JSON.parse(await readFile(p, 'utf8')); } catch { return fb; } }
async function writeJsonIfChanged(p, obj, ignoreKeys = ['generated_at', 'checked_at']) {
  await mkdir(dirname(p), { recursive: true });
  const old = await readJson(p);
  const strip = o => JSON.stringify(o, (k, v) => ignoreKeys.includes(k) ? undefined : v);
  if (old && strip(old) === strip(obj)) { log(`  unchanged: ${rel(p)}`); return false; }
  await writeFile(p, JSON.stringify(obj, null, 1) + '\n');
  log(`  wrote: ${rel(p)}`);
  return true;
}
const ymdInTz = (d, tz = TZ) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
const dayDiff = (a, b) => Math.round((Date.parse(a + 'T12:00:00Z') - Date.parse(b + 'T12:00:00Z')) / 86400e3);

// Requests to one host are >= DELAY_MS (or its robots.txt Crawl-delay) apart; requests overall are
// >= GLOBAL_GAP_MS apart. Schools run a few at a time, so one site's crawl delay never stalls the rest.
const lastByHost = {}, hostDelay = { 'api.virti.us': 1000 };
let globalChain = Promise.resolve(), lastReq = 0;
async function politeFetch(url, { accept = 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8' } = {}) {
  const host = new URL(url).host;
  const gap = host === 'api.virti.us' ? hostDelay[host] : Math.max(DELAY_MS, hostDelay[host] || 0);
  const slot = Math.max(Date.now(), (lastByHost[host] || 0) + gap);
  lastByHost[host] = slot;                       // reserve this host's next slot
  if (slot > Date.now()) await sleep(slot - Date.now());
  globalChain = globalChain.then(async () => { const w = lastReq + GLOBAL_GAP_MS - Date.now(); if (w > 0) await sleep(w); lastReq = Date.now(); });
  await globalChain;
  lastByHost[host] = Math.max(lastByHost[host], Date.now());
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: accept, 'Accept-Language': 'en-US,en;q=0.9' }, redirect: 'follow', signal: ctl.signal });
    const text = await res.text();
    return { status: res.status, ok: res.ok, url: res.url || url, text };
  } finally { clearTimeout(t); }
}

// Minimal robots.txt: groups for "*" (or our product token); Disallow / Allow prefix rules; Crawl-delay.
const robotsCache = {};
async function robotsFor(origin) {
  if (origin in robotsCache) return robotsCache[origin];
  let rules = { allow: [], disallow: [], delay: 0 };
  try {
    const r = await politeFetch(`${origin}/robots.txt`, { accept: 'text/plain,*/*' });
    if (r.ok && !/^\s*</.test(r.text)) {
      let inGroup = false, sawRule = false;
      for (const raw of r.text.split(/\r?\n/)) {
        const line = raw.replace(/#.*/, '').trim();
        const m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/); if (!m) continue;
        const k = m[1].toLowerCase(), v = m[2].trim();
        if (k === 'user-agent') { if (sawRule) { inGroup = false; sawRule = false; } if (v === '*' || /thefivethatscore/i.test(v)) inGroup = true; continue; }
        sawRule = true;
        if (!inGroup) continue;
        if (k === 'disallow' && v) rules.disallow.push(v);
        else if (k === 'allow' && v) rules.allow.push(v);
        else if (k === 'crawl-delay') rules.delay = Number(v) || 0;
      }
    }
  } catch { /* no robots.txt reachable: proceed with defaults */ }
  if (rules.delay) hostDelay[new URL(origin).host] = Math.min(rules.delay, 30) * 1000;
  return (robotsCache[origin] = rules);
}
function robotsAllows(rules, path) {
  const match = p => { const re = new RegExp('^' + p.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\\\$$/, '$')); return re.test(path); };
  const a = Math.max(-1, ...rules.allow.filter(match).map(p => p.length));
  const d = Math.max(-1, ...rules.disallow.filter(match).map(p => p.length));
  return d < 0 || a >= d;
}

// ---------- page parsing ----------
const decodeTitle = t => (t || '').replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
  .replace(/&amp;/g, '&').replace(/&apos;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim().slice(0, 120) || null;
// Season (spring year) a schedule page title refers to: "2026-27" -> 2027, "2027 Gymnastics" -> 2027.
function titleSeason(title) {
  if (!title) return null;
  const span = title.match(/\b(20\d\d)\s*[-–]\s*(\d\d)\b/);
  if (span) return 2000 + Number(span[2]);
  const ys = (title.match(/\b20\d\d\b/g) || []).map(Number);
  return ys.length ? Math.max(...ys) : null;
}
const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
function normalizeHtml(s) {
  return s.replace(/\\u002F/gi, '/').replace(/\\\//g, '/').replace(/&amp;/g, '&').replace(/&#x2F;|&#47;/gi, '/');
}
// Returns [{key, contextDate}] for every distinct virti.us session link on the page.
export function extractVirtiusLinks(html, fallbackYear) {
  const s = normalizeHtml(html);
  const out = new Map();
  const re = /virti\.us\/(?:session\/([A-Za-z0-9_-]{6,32})|[^"'\s<>\\]*?[?&](?:s|session|key)=([A-Za-z0-9_-]{6,32}))/gi;
  let m;
  while ((m = re.exec(s))) {
    const key = m[1] || m[2];
    if (!KEY_RE.test(key) || out.has(key)) continue;
    out.set(key, { key, contextDate: dateBefore(s, m.index, fallbackYear) });
  }
  return [...out.values()];
}
function dateBefore(s, idx, fallbackYear) {
  const win = s.slice(Math.max(0, idx - 6000), idx);
  let best = null, bestPos = -1;
  for (const m of win.matchAll(/(20\d\d)-(\d\d)-(\d\d)T/g)) if (m.index > bestPos) { best = `${m[1]}-${m[2]}-${m[3]}`; bestPos = m.index; }
  for (const m of win.matchAll(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sept?|Oct|Nov|Dec)[a-z]*\.?\s+(\d{1,2})(?:,?\s+(20\d\d))?\b/g)) {
    if (m.index > bestPos) {
      const mo = MONTHS[m[1].toLowerCase()]; const y = Number(m[3]) || fallbackYear(mo);
      best = `${y}-${String(mo).padStart(2, '0')}-${String(m[2]).padStart(2, '0')}`; bestPos = m.index;
    }
  }
  return best;
}

// ---------- Virtius check ----------
async function virtiusInfo(key, cache) {
  if (cache[key] && cache[key].meet_date) return cache[key];
  const r = await politeFetch(VIRTIUS_API(key), { accept: 'application/json' });
  if (!r.ok) throw new Error(`Virtius ${key} -> HTTP ${r.status}`);
  const m = JSON.parse(r.text).meet || {};
  const teams = (m.teams || []).map(t => ({ team_id: String(t.team_id ?? ''), tricode: t.tricode || null, name: t.name || null }));
  const ids = new Set(teams.map(t => t.team_id || t.tricode));
  const info = {
    meet_date: m.meet_date || null, name: m.name || null,
    teams: teams.map(t => t.name), tricode: teams[0]?.tricode || null,
    intrasquad: teams.length > 0 && ids.size === 1,
  };
  cache[key] = info;
  return info;
}

// ---------- main ----------
async function main() {
  const today = ymdInTz(new Date());
  const seed = await readJson(join(DATA, 'intrasquads.json'), { events: [] });
  const d1 = await readJson(join(DATA, 'd1-teams.json'), { teams: [] });
  const prevOut = await readJson(join(DATA, 'intrasquads-discovered.json'), { events: [], virtius_cache: {} });
  const prevStatus = await readJson(join(DATA, 'discovery-status.json'), { schools: {} });
  const cache = { ...(prevOut.virtius_cache || {}) };

  let schools = [...new Set([...d1.teams.map(t => t.name), ...Object.keys(SITES)])].sort();
  if (args.only) { const want = String(args.only).split(',').map(s => s.trim()); schools = schools.filter(s => want.includes(s)); }
  if (args.due) {
    const due = new Set(seed.events.filter(e => !e.virtius && !e.skip && e.date === ymdInTz(new Date(), e.tz || TZ)).map(e => e.school));
    schools = schools.filter(s => due.has(s));
    log(`--due: ${schools.length} school(s) with a key-less intrasquad today: ${schools.join(', ') || '(none)'}`);
    if (!schools.length) return;
  }
  log(`Discovery ${today}: checking ${schools.length} school schedule page(s)`);

  const status = args.due || args.only ? { ...prevStatus.schools } : {};
  const found = []; // {school, key, page, contextDate}
  const yr = Number(today.slice(0, 4)), mo = Number(today.slice(5, 7));
  const fallYear = mo >= 7 ? yr : yr - 1;   // pages list a season Aug..Apr; Jul-Dec = fall year
  const target = fallYear + 1;              // season (spring year) we want to see
  const titleOf = html => decodeTitle((html.match(/<title[^>]*>([^<]*)<\/title>/i) || [])[1]);

  async function checkSchool(school) {
    const cfg = SITES[school];
    const t0 = Date.now();
    const st = { ok: false, url: null, http: null, title: null, season: null, dates_seen: 0, links: 0, keys: [], error: null, checked_at: new Date().toISOString() };
    if (!cfg) { st.error = 'no athletics site configured'; return st; }
    const origin = `https://${cfg.site}`;
    // Remember only the base schedule URL (season-specific URLs go stale next year).
    const remembered = prevStatus.schools?.[school]?.ok ? (prevStatus.schools[school].url || '').replace(/\/(20\d\d(-\d\d)?)\/?$/, '') || null : null;
    const candidates = [...new Set([remembered, ...(cfg.paths || []), ...DEFAULT_PATHS].filter(Boolean).map(p => p.startsWith('http') ? p : origin + p))]
      .map(u => u + (args['url-suffix'] || ''));
    const robots = await robotsFor(origin);
    const get = async url => {
      const path = new URL(url).pathname;
      if (!robotsAllows(robots, path)) { st.error = `robots.txt disallows ${path}`; return null; }
      let r;
      try { r = await politeFetch(url); } catch (e) { st.error = `${url}: ${e.name === 'AbortError' ? 'timeout' : e.message}`; return null; }
      st.http = r.status;
      if (!r.ok) { st.error = `${url} -> HTTP ${r.status}`; return null; }
      if (!/gymnast/i.test(r.text) || !/schedule/i.test(r.text)) { st.error = `${url}: not a gymnastics schedule page`; return null; }
      return { url, text: r.text, title: titleOf(r.text) };
    };
    let page = null;
    for (const url of candidates) { page = await get(url); if (page) break; }
    if (page && !args['url-suffix']) {
      // Still showing last season? Sidearm keeps the new season at /schedule/YYYY-YY or /schedule/YYYY.
      const season = titleSeason(page.title);
      if (season && season < target && /\/schedule\/?$/.test(page.url)) {
        const b = page.url.replace(/\/$/, '');
        for (const u of [`${b}/${fallYear}-${String(target).slice(2)}`, `${b}/${target}`]) {
          const p2 = await get(u);
          if (p2 && titleSeason(p2.title) === target) { page = p2; break; }
        }
      }
    }
    if (!page) { log(`  ${school}: FAILED ${st.error} [${((Date.now() - t0) / 1000).toFixed(1)}s]`); return st; }
    Object.assign(st, { ok: true, url: page.url, error: null, title: page.title, season: titleSeason(page.title) });
    st.dates_seen = new Set((normalizeHtml(page.text).match(/\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.? \d{1,2}\b/g) || []).map(x => x.slice(0, 3) + x.replace(/\D+/g, ' '))).size;
    const links = extractVirtiusLinks(page.text, m => (m >= 7 ? fallYear : fallYear + 1));
    st.links = links.length;
    st.keys = links.map(l => l.key);
    links.forEach(l => found.push({ school, key: l.key, page: page.url, contextDate: l.contextDate }));
    log(`  ${school}: ok (${st.links} virti.us link${st.links === 1 ? '' : 's'}, season ${st.season ?? '?'}) ${st.url} [${((Date.now() - t0) / 1000).toFixed(1)}s]`);
    return st;
  }
  const queue = schools.slice();
  await Promise.all(Array.from({ length: Math.min(12, queue.length) }, async () => {
    while (queue.length) {
      const school = queue.shift();
      try { status[school] = await checkSchool(school); }
      catch (e) { status[school] = { ok: false, error: e.message, checked_at: new Date().toISOString() }; log(`  ${school}: FAILED ${e.message}`); }
    }
  }));

  // Check every newly seen key against the public Virtius session JSON.
  const events = args.due || args.only ? [...(prevOut.events || [])] : [];
  const have = new Set(events.map(e => e.virtius));
  const seedKeys = new Set(seed.events.map(e => e.virtius).filter(Boolean));
  let lookups = 0;
  for (const f of found) {
    if (have.has(f.key)) continue;
    // Intrasquads happen Aug-Dec; skip regular-season links (Jan-Jul) we have not seen before.
    const ctxMonth = f.contextDate ? Number(f.contextDate.slice(5, 7)) : null;
    if (!cache[f.key] && ctxMonth && ctxMonth < 8) continue;
    if (!cache[f.key] && ++lookups > MAX_VIRTIUS_LOOKUPS) { log(`  (Virtius lookup cap reached; ${f.key} next run)`); continue; }
    let info;
    try { info = await virtiusInfo(f.key, cache); } catch (e) { log(`  ${f.key}: ${e.message}`); continue; }
    if (!info.intrasquad) continue;
    const date = info.meet_date || f.contextDate;
    if (!date) continue;
    const match = seed.events.find(e => e.school === f.school && Math.abs(dayDiff(e.date, date)) <= 1);
    events.push({
      id: match ? match.id : `found-${f.key}`,
      matched_id: match ? match.id : null,
      school: f.school,
      event: match ? match.event : (info.name || `${f.school} Intrasquad`),
      date: match ? match.date : date,
      time_local: match ? match.time_local : null,
      tz: match ? match.tz : null,
      virtius: f.key,
      virtius_name: info.name,
      squads: info.teams,
      source_url: f.page,
      already_in_seed: seedKeys.has(f.key),
    });
    have.add(f.key);
    log(`  intrasquad found: ${f.school} ${date} ${f.key} "${info.name}"${match ? ` -> ${match.id}` : ''}`);
  }
  events.sort((a, b) => a.date.localeCompare(b.date) || a.school.localeCompare(b.school));

  // Only keep cache entries for keys we have seen (keeps the file small and stable).
  const seen = new Set(found.map(f => f.key).concat(events.map(e => e.virtius)));
  const vc = Object.fromEntries(Object.entries(cache).filter(([k]) => seen.has(k) || (args.due || args.only)).sort());

  await writeJsonIfChanged(join(DATA, 'intrasquads-discovered.json'), {
    generated_at: new Date().toISOString(),
    source: 'scripts/discover-intrasquads.mjs: virti.us links on D1 athletics gymnastics schedule pages, checked against api.virti.us/session/{key}/json',
    events, virtius_cache: vc,
  });
  const ok = Object.values(status).filter(s => s.ok).length;
  await writeJsonIfChanged(join(DATA, 'discovery-status.json'), {
    generated_at: new Date().toISOString(),
    parsed: ok, total: Object.keys(status).length,
    failed: Object.entries(status).filter(([, s]) => !s.ok).map(([k]) => k),
    schools: Object.fromEntries(Object.entries(status).sort()),
  });
  log(`Done: ${ok}/${Object.keys(status).length} schedule pages parsed; ${events.length} intrasquad key(s) known; ${found.length} virti.us link(s) seen.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(e => { console.error('discovery error (soft):', e); if (args.strict) process.exit(1); });
}
