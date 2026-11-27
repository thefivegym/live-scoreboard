#!/usr/bin/env node
// Builds data/rosters/{season}.json from Road to Nationals (roster + class year
// + 2026 season highs) and, optionally, official school athletics roster pages
// for 2027. Never invents names, class years, or scores.
//
// Usage:
//   node scripts/build-rosters.mjs              # RTN 2026 + 2027
//   node scripts/build-rosters.mjs --schools    # also scrape official 2027 rosters
//   node scripts/build-rosters.mjs --schools-only
//
// Politeness: RTN robots.txt crawl-delay 30. School sites use concurrency 6.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { UA, SITES, candidateUrls, politeFetch, mapPool } from './lib-schools.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = join(ROOT, 'data');
const CACHE = join(DATA, 'rosters', '.cache');
const RTN = 'https://www.roadtonationals.com/api/women';
const RTN_DELAY_MS = Number(process.env.RTN_DELAY_MS ?? 30000);
const SCHOOL_CONCURRENCY = Number(process.env.SCHOOL_CONCURRENCY ?? 6);

const args = Object.fromEntries(process.argv.slice(2).map(a => {
  const [k, v] = a.replace(/^--/, '').split('=');
  return [k, v ?? true];
}));

const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = (...a) => console.log(...a);
const rel = p => p.replace(ROOT + '/', '');

async function readJson(p, fallback = null) {
  try { return JSON.parse(await readFile(p, 'utf8')); } catch { return fallback; }
}
async function writeJson(p, obj) {
  await mkdir(dirname(p), { recursive: true });
  await writeFile(p, JSON.stringify(obj, null, 1) + '\n');
}

// RTN school_year integers observed on official dashboard rosters.
// 1–4 match Sidearm academicYearNumber (Fr/So/Jr/Sr). 5 is used for graduate
// students on some teams (verified against school "Gr." labels when present).
const YEAR_MAP = { 1: 'Fr.', 2: 'So.', 3: 'Jr.', 4: 'Sr.', 5: 'Gr.' };
const YEAR_RE = /^(Fr|So|Jr|Sr|Gr)\.?$/i;
function fmtYear(v) {
  if (v == null || v === '' || v === -1) return null;
  if (typeof v === 'number' && YEAR_MAP[v]) return YEAR_MAP[v];
  const s = String(v).trim();
  if (YEAR_MAP[Number(s)]) return YEAR_MAP[Number(s)];
  const m = s.match(/^(freshman|sophomore|junior|senior|graduate(?:\s*student)?|grad)\b/i);
  if (m) {
    const k = m[1].toLowerCase();
    if (k.startsWith('fr')) return 'Fr.';
    if (k.startsWith('so')) return 'So.';
    if (k.startsWith('ju')) return 'Jr.';
    if (k.startsWith('se')) return 'Sr.';
    return 'Gr.';
  }
  if (YEAR_RE.test(s)) return s.replace(/\.$/, '')[0].toUpperCase() + s.replace(/\.$/, '').slice(1).toLowerCase() + '.';
  // RS-Fr, 5th, R-Fr, etc. — keep a short official-looking token only if it already
  // looks like a class label, otherwise leave null rather than invent a code.
  if (/^(r[s.-]?\s*)?(fr|so|jr|sr|gr)\.?$/i.test(s) || /^(5th|rs)$/i.test(s)) {
    const core = s.replace(/^r[s.-]?\s*/i, '');
    if (YEAR_RE.test(core) || /^(fr|so|jr|sr|gr)\.?$/i.test(core)) {
      const c = core.replace(/\./g, '');
      return (c[0].toUpperCase() + c.slice(1, 2).toLowerCase() + '.');
    }
  }
  return null;
}
function scoreNum(v) {
  if (v == null || v === '' || v === 0) return null; // RTN uses null for "did not compete"; 0 is not a real gym score
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0.1) return null;
  return Number(n.toFixed(4));
}
function athleteName(fname, lname) {
  return `${String(fname || '').trim()} ${String(lname || '').trim()}`.replace(/\s+/g, ' ').trim();
}
function foldDiacritics(s) {
  return String(s || '').normalize('NFKD').replace(/\p{M}+/gu, '');
}
function normName(s) {
  return foldDiacritics(s).toLowerCase().replace(/[’']/g, "'").replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
}
function nameParts(s) {
  const n = normName(s);
  const parts = n.split(' ').filter(Boolean);
  if (!parts.length) return { first: '', last: '', full: n };
  return { first: parts[0], last: parts[parts.length - 1], full: n };
}
function editDistance(a, b) {
  a = String(a || ''); b = String(b || '');
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const dp = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i++) dp[i][0] = i;
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        dp[i][j] = Math.min(dp[i][j], dp[i - 2][j - 2] + 1);
      }
    }
  }
  return dp[a.length][b.length];
}
function preferName(a, b) {
  // Prefer a display name that keeps official diacritics when both refer to the same person.
  if (/[^\x00-\x7F]/.test(b) && !/[^\x00-\x7F]/.test(a)) return b;
  return a;
}
function mergeAthleteRow(into, extra) {
  if (!into.year && extra.year) into.year = extra.year;
  if (into.yearRaw == null && extra.yearRaw != null) into.yearRaw = extra.yearRaw;
  if (!into.hometown && extra.hometown) into.hometown = extra.hometown;
  if (into.id == null && extra.id != null) into.id = extra.id;
  into.name = preferName(into.name, extra.name);
  for (const ev of ['vt', 'ub', 'bb', 'fx', 'aa']) {
    if (extra[ev] == null) continue;
    if (into[ev] == null || extra[ev] > into[ev] + 1e-9) into[ev] = extra[ev];
  }
  return into;
}
function dedupeAthletes(athletes) {
  const by = new Map();
  const out = [];
  for (const a of athletes) {
    const k = normName(a.name);
    if (!k) continue;
    const prev = by.get(k);
    if (!prev) { by.set(k, a); out.push(a); continue; }
    mergeAthleteRow(prev, a);
  }
  return out;
}

let lastRtn = 0;
async function rtnGet(path, { cacheKey } = {}) {
  const cachePath = cacheKey ? join(CACHE, cacheKey + '.json') : null;
  if (cachePath && !args['refresh-rtn']) {
    const hit = await readJson(cachePath);
    if (hit && hit._ok) return hit.body;
  }
  const wait = lastRtn + RTN_DELAY_MS - Date.now();
  if (lastRtn && wait > 0) {
    log(`  (waiting ${Math.ceil(wait / 1000)}s for RTN crawl-delay)`);
    await sleep(wait);
  }
  lastRtn = Date.now();
  const url = RTN + path;
  log(`GET ${url}`);
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
  const text = await res.text();
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  let body;
  try { body = JSON.parse(text); } catch { throw new Error(`${url} -> non-JSON`); }
  if (cachePath) await writeJson(cachePath, { _ok: true, path, fetched_at: new Date().toISOString(), body });
  return body;
}

function fromDashboardRoster(roster = []) {
  return roster.map(r => ({
    id: r.id ?? null,
    name: athleteName(r.fname, r.lname),
    year: fmtYear(r.school_year),
    yearRaw: r.school_year ?? null,
    hometown: r.hometown || null,
    vt: null, ub: null, bb: null, fx: null, aa: null,
  })).filter(a => a.name);
}

function applyHighs(athletes, ind = []) {
  const byId = new Map();
  const byName = new Map();
  for (const a of athletes) {
    if (a.id != null) byId.set(Number(a.id), a);
    byName.set(normName(a.name), a);
  }
  const extras = [];
  for (const r of ind) {
    const highs = {
      vt: scoreNum(r.maxv),
      ub: scoreNum(r.maxub),
      bb: scoreNum(r.maxbb),
      fx: scoreNum(r.maxfx),
      aa: scoreNum(r.maxaa),
    };
    let a = (r.gid != null && byId.get(Number(r.gid))) || byName.get(normName(athleteName(r.fname, r.lname)));
    if (!a) {
      a = { id: r.gid ?? null, name: athleteName(r.fname, r.lname), year: null, yearRaw: null, hometown: null, vt: null, ub: null, bb: null, fx: null, aa: null };
      extras.push(a);
    }
    Object.assign(a, highs);
  }
  return athletes.concat(extras);
}

async function fetchRtnSeason(teams, season) {
  const out = {};
  const coverage = { teams: 0, athletes: 0, withYear: 0, withAnyHigh: 0, failed: [] };
  for (const team of teams) {
    const slug = team.slug;
    try {
      const dash = await rtnGet(`/dashboard/${season}/${team.tid}`, { cacheKey: `dash-${season}-${team.tid}` });
      let athletes = dedupeAthletes(fromDashboardRoster(dash.roster || []));
      let highsSource = null;
      if (season === 2026) {
        const main = await rtnGet(`/rostermain/${season}/${team.tid}/2`, { cacheKey: `highs-${season}-${team.tid}` });
        const ind = (main && main.ind) || (Array.isArray(main) ? [] : []);
        athletes = dedupeAthletes(applyHighs(athletes, ind));
        highsSource = 'rtn-rostermain-tab2';
      }
      athletes.sort((a, b) => a.name.localeCompare(b.name) || (a.id || 0) - (b.id || 0));
      const rosterLink = (dash.links || []).find(l => /roster/i.test(l.tax_value || '') || /roster/i.test(l.link || ''));
      out[slug] = {
        name: team.name,
        tid: team.tid,
        source: season === 2026 ? 'Road to Nationals dashboard + rostermain season highs' : 'Road to Nationals dashboard',
        sourceUrl: rosterLink?.link || `https://www.roadtonationals.com/results/team/women/${team.tid}/${season}`,
        athletes,
      };
      coverage.teams++;
      coverage.athletes += athletes.length;
      coverage.withYear += athletes.filter(a => a.year).length;
      coverage.withAnyHigh += athletes.filter(a => a.vt != null || a.ub != null || a.bb != null || a.fx != null || a.aa != null).length;
      log(`  ${team.name}: ${athletes.length} athletes, ${athletes.filter(a => a.year).length} with class year` +
        (season === 2026 ? `, ${athletes.filter(a => a.vt != null || a.ub != null || a.bb != null || a.fx != null || a.aa != null).length} with a season high` : ''));
    } catch (e) {
      log(`  FAIL ${team.name}: ${e.message || e}`);
      coverage.failed.push({ name: team.name, slug, error: String(e.message || e) });
    }
  }
  return { out, coverage };
}

// ---------- school athletics 2027 rosters (Sidearm NUXT + HTML fallbacks) ----------
function parseNuxt(html) {
  const m = html.match(/<script[^>]*id="__NUXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) return null;
  try { return JSON.parse(m[1]); } catch { return null; }
}
function nuxtResolve(data, x, seen = new Set()) {
  if (typeof x === 'number') {
    if (x < 0 || x >= data.length) return x;
    const val = data[x];
    if (val == null || (typeof val !== 'object')) return val;
    if (seen.has(x)) return null;
    const next = new Set(seen);
    next.add(x);
    return nuxtResolve(data, val, next);
  }
  if (Array.isArray(x)) {
    if (x.length >= 2 && typeof x[0] === 'string' && ['ShallowReactive', 'Reactive', 'Ref', 'Computed'].includes(x[0])) {
      return nuxtResolve(data, x[1], seen);
    }
    if (x.length === 1 && (x[0] === 'Set' || x[0] === 'Map')) return x[0] === 'Set' ? [] : {};
    return x.map(i => nuxtResolve(data, i, new Set(seen)));
  }
  if (x && typeof x === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(x)) out[k] = nuxtResolve(data, v, new Set(seen));
    return out;
  }
  return x;
}

function collectNuxtPlayers(data) {
  const players = [];
  const seenIds = new Set();
  const addRaw = (p) => {
    const id = p.playerId || p.rosterPlayerId || p.id;
    const name = p.full_name || athleteName(p.firstName || p.first_name, p.lastName || p.last_name) || p.name;
    const key = id != null ? 'id:' + id : 'n:' + normName(name);
    if (!name || seenIds.has(key)) return;
    seenIds.add(key);
    players.push(p);
  };
  for (let i = 0; i < data.length; i++) {
    const item = data[i];
    if (!item || typeof item !== 'object') continue;
    if ('players' in item || 'rosterPlayers' in item) {
      const r = nuxtResolve(data, i);
      const list = [].concat(r.players || [], r.rosterPlayers || []).filter(x => x && (x.firstName || x.lastName || x.name));
      for (const p of list) addRaw(p);
    }
    // WMT / LSU-style athlete objects
    if ('class_level' in item && ('first_name' in item || 'full_name' in item)) {
      const r = nuxtResolve(data, i);
      const cls = r.class_level;
      const yearName = (cls && typeof cls === 'object') ? (cls.abbreviation || cls.name) : cls;
      addRaw({
        id: r.id ?? null,
        firstName: r.first_name,
        lastName: r.last_name,
        name: r.full_name,
        academicYearShort: yearName,
        academicYearLong: cls && cls.name,
        hometown: r.hometown || null,
      });
    }
  }
  return players;
}

function playerFromNuxt(p) {
  const name = athleteName(p.firstName, p.lastName) || String(p.name || '').trim();
  const year = fmtYear(p.academicYearShort) || fmtYear(p.academicYearLong) || fmtYear(p.academicYearNumber) || fmtYear(p.academicYear);
  return { id: p.playerId ?? p.rosterPlayerId ?? null, name, year, yearRaw: p.academicYearShort || p.academicYearLong || p.academicYearNumber || null, hometown: p.hometown || null, vt: null, ub: null, bb: null, fx: null, aa: null, source: 'school' };
}

function stripTags(s) {
  return String(s || '').replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))).replace(/\s+/g, ' ').trim();
}

// Official roster tables often append event specialties after the name
// ("Jane Doe AA", "Jane Doe BB | FX"). Those are not additional athletes.
const EVENT_SUFFIX_RE = /\s+(?:(?:AA|VT|UB|BB|FX|Vault|Bars|Beam|Floor)(?:\s*[|/,&]+\s*(?:AA|VT|UB|BB|FX|Vault|Bars|Beam|Floor))*)\s*$/i;
function cleanAthleteName(name) {
  return String(name || '').replace(/\s+/g, ' ').trim().replace(EVENT_SUFFIX_RE, '').trim();
}

function playersFromHtml(html) {
  // Conservative HTML fallback: Sidearm-like roster table/cards with a class year nearby.
  const out = [];
  const seen = new Set();
  const add = (name, yearRaw) => {
    name = cleanAthleteName(name);
    if (!name || name.length < 4 || name.length > 50 || seen.has(normName(name))) return;
    if (!/^[A-Za-zÀ-ÿ'."“”\- ]+$/.test(name)) return;
    if (name.split(' ').length < 2) return;
    seen.add(normName(name));
    out.push({ id: null, name, year: fmtYear(yearRaw), yearRaw: yearRaw || null, hometown: null, vt: null, ub: null, bb: null, fx: null, aa: null, source: 'school-html' });
  };
  const rowRe = /<(?:li|div|tr)[^>]*class="[^"]*sidearm-roster-player[^"]*"[^>]*>([\s\S]*?)<\/(?:li|div|tr)>/gi;
  let sm;
  while ((sm = rowRe.exec(html))) {
    const first = stripTags((sm[1].match(/sidearm-roster-player-first-name[^"]*"[^>]*>([\s\S]*?)<\//i) || [])[1] || '');
    const last = stripTags((sm[1].match(/sidearm-roster-player-last-name[^"]*"[^>]*>([\s\S]*?)<\//i) || [])[1] || '');
    const name = stripTags((sm[1].match(/sidearm-roster-player-name[^"]*"[^>]*>([\s\S]*?)<\//i) || [])[1] || '') || `${first} ${last}`.trim();
    const year = stripTags((sm[1].match(/sidearm-roster-player-academic-year[^"]*"[^>]*>([\s\S]*?)<\//i) || [])[1] || '');
    add(name, year);
  }
  const ukRe = /<h3[^>]*class="[^"]*roster-item__name[^"]*"[^>]*>([\s\S]*?)<\/h3>[\s\S]{0,400}?<(?:p|span|div)[^>]*class="[^"]*roster-item__info[^"]*"[^>]*>([\s\S]*?)<\/(?:p|span|div)>/gi;
  while ((sm = ukRe.exec(html))) {
    const info = stripTags(sm[2]);
    if (fmtYear(info)) add(stripTags(sm[1]), info);
  }
  if (out.length) return out;
  const yearTok = '(Fr\\.?|So\\.?|Jr\\.?|Sr\\.?|Gr\\.?|Freshman|Sophomore|Junior|Senior|Graduate)';
  // cards: name heading + year
  const cardRe = /<(?:h[1-4]|div|span|a)[^>]*class="[^"]*(?:roster-player-name|sidearm-roster-player-name|player-name|c-roster__name)[^"]*"[^>]*>([\s\S]*?)<\/(?:h[1-4]|div|span|a)>[\s\S]{0,400}?<(?:div|span|td)[^>]*class="[^"]*(?:year|class|academic)[^"]*"[^>]*>([\s\S]*?)<\/(?:div|span|td)>/gi;
  let m;
  while ((m = cardRe.exec(html))) {
    add(stripTags(m[1]), stripTags(m[2]));
  }
  if (out.length) return out;
  // Arkansas-like: table rows
  const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  while ((m = trRe.exec(html))) {
    const cells = [...m[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(c => stripTags(c[1]));
    if (cells.length < 2) continue;
    const yearCell = cells.find(c => fmtYear(c));
    const nameCell = cells.find(c => /[A-Z][a-z]+ [A-Z]/.test(c) && c.length < 50 && !/roster|name|athlete/i.test(c));
    if (nameCell && yearCell) add(nameCell, yearCell);
  }
  return out;
}

function isUsefulRosterPage(html, url, status) {
  if (status === 404) return false;
  const title = (html.match(/<title>([\s\S]*?)<\/title>/i) || [, ''])[1];
  if (/404|page not found|not found/i.test(title)) return false;
  if (/__NUXT_DATA__/.test(html) && /academicYearShort|rosterPlayers|"players"/.test(html)) return true;
  if (/(?:womens?-?gymnastics|w-gym|wgym)/i.test(url) && /roster/i.test(url) && status >= 200 && status < 300 && html.length > 5000) return true;
  return /roster/i.test(title) && !/football|basketball|baseball|softball|soccer|volleyball|wrestling/i.test(title);
}

async function scrapeSchoolRoster(team) {
  const urls = candidateUrls(team.name, 'roster');
  const tried = [];
  for (const url of urls) {
    const r = await politeFetch(url);
    tried.push(`${url} -> ${r.status}`);
    if (!r.ok || !isUsefulRosterPage(r.text, r.url, r.status)) continue;
    const nuxt = parseNuxt(r.text);
    let players = [];
    if (nuxt) players = collectNuxtPlayers(nuxt).map(playerFromNuxt).filter(p => p.name);
    if (!players.length) players = playersFromHtml(r.text);
    // Dedup
    const seen = new Set();
    players = players.filter(p => {
      const k = normName(p.name);
      if (!k || seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    if (players.length >= 4) {
      return { ok: true, url: r.url, parser: nuxt && collectNuxtPlayers(nuxt).length ? 'sidearm-nuxt' : 'html', athletes: players, tried };
    }
  }
  return { ok: false, url: null, parser: null, athletes: [], tried, error: 'no roster parsed' };
}

function mergeSchoolInto(rtnTeam, school, { preferSchoolYear = true } = {}) {
  if (!rtnTeam) {
    return {
      name: school.name,
      tid: school.tid,
      source: 'Official school athletics roster',
      sourceUrl: school.sourceUrl,
      athletes: school.athletes.map(a => ({ id: a.id, name: a.name, year: a.year, hometown: a.hometown, vt: null, ub: null, bb: null, fx: null, aa: null })),
    };
  }
  const byName = new Map(rtnTeam.athletes.map(a => [normName(a.name), a]));
  const schoolKeys = new Set(school.athletes.map(s => normName(cleanAthleteName(s.name))).filter(Boolean));
  const added = [];
  const findFuzzy = (cleaned) => {
    const p = nameParts(cleaned);
    if (!p.last || p.last.length < 3 || !p.first) return null;
    const hits = rtnTeam.athletes.filter(a => {
      const q = nameParts(a.name);
      return q.last === p.last && editDistance(q.first, p.first) <= 1;
    });
    // Only merge when the official school list does not also contain the
    // existing RTN spelling as a separate athlete (sisters / similar names).
    const unique = hits.filter(a => !schoolKeys.has(normName(a.name)) || normName(a.name) === normName(cleaned));
    return unique.length === 1 ? unique[0] : null;
  };
  for (const s of school.athletes) {
    const cleaned = cleanAthleteName(s.name);
    const k = normName(cleaned);
    let a = byName.get(k) || findFuzzy(cleaned);
    if (a) {
      if (preferSchoolYear && s.year) a.year = s.year;
      if (!a.hometown && s.hometown) a.hometown = s.hometown;
      // Prefer the official school-page spelling when it is clearly the same person.
      if (cleaned) a.name = preferName(cleaned, a.name) === cleaned || k === normName(a.name) ? cleaned : a.name;
      if (k && k !== normName(a.name)) byName.set(k, a);
    } else {
      const row = { id: s.id, name: cleaned, year: s.year, hometown: s.hometown || null, vt: null, ub: null, bb: null, fx: null, aa: null };
      rtnTeam.athletes.push(row);
      if (k) byName.set(k, row);
      added.push(cleaned);
    }
  }
  // If the official school roster named one spelling and RTN also had a 1-edit
  // typo of that person, drop the typo rather than listing them twice.
  const official = new Set(school.athletes.map(s => normName(cleanAthleteName(s.name))).filter(Boolean));
  if (official.size) {
    rtnTeam.athletes = rtnTeam.athletes.filter(a => {
      const p = nameParts(a.name);
      if (official.has(p.full)) return true;
      const typoOfOfficial = [...official].some(key => {
        const q = nameParts(key);
        return q.last === p.last && p.last.length >= 3 && editDistance(q.first, p.first) <= 1;
      });
      return !typoOfOfficial;
    });
  }
  rtnTeam.athletes = dedupeAthletes(rtnTeam.athletes);
  rtnTeam.athletes.sort((a, b) => a.name.localeCompare(b.name));
  if (school.sourceUrl && !/roadtonationals/.test(rtnTeam.sourceUrl || '')) { /* keep */ }
  if (added.length || !rtnTeam.schoolSourceUrl) rtnTeam.schoolSourceUrl = school.sourceUrl;
  if (added.length) rtnTeam.source = (rtnTeam.source || 'RTN') + ' + official school roster';
  return { team: rtnTeam, added };
}

async function writeRosterFile(season, teamsMap, extra) {
  const p = join(DATA, 'rosters', `${season}.json`);
  const athletes = Object.values(teamsMap).reduce((n, t) => n + (t.athletes || []).length, 0);
  const payload = {
    generated_at: new Date().toISOString(),
    season,
    teams: teamsMap,
    coverage: {
      teams: Object.keys(teamsMap).length,
      athletes,
      ...extra,
    },
  };
  await writeJson(p, payload);
  log(`wrote ${rel(p)} (${payload.coverage.teams} teams, ${athletes} athletes)`);
  return payload;
}

// Used by build-stats.mjs to fill event highs from Virtius sessions without
// inventing athletes or overwriting official RTN 2026 highs unless higher.
export function mergeVirtiusHighs(rosterFile, sessions, { season, teamNameOf } = {}) {
  if (!rosterFile || !rosterFile.teams || !sessions) return rosterFile;
  const evMap = { vault: 'vt', bars: 'ub', beam: 'bb', floor: 'fx' };
  const highs = new Map(); // teamName|normName -> {vt,ub,bb,fx,events{}}
  for (const s of Object.values(sessions)) {
    if (!s) continue;
    const date = s.date || '';
    const yr = date ? (Number(date.slice(5, 7)) >= 7 ? Number(date.slice(0, 4)) + 1 : Number(date.slice(0, 4))) : season;
    if (season && yr !== season) continue;
    if (Array.isArray(s.gymnastScores) && s.gymnastScores.length) {
      for (const g of s.gymnastScores) {
        if (!g || !g.athlete || !g.team) continue;
        const key = `${g.team}|${normName(g.athlete)}`;
        const rec = highs.get(key) || { name: g.athlete, team: g.team, vt: null, ub: null, bb: null, fx: null, aa: null };
        const map = { vault: 'vt', bars: 'ub', beam: 'bb', floor: 'fx', vt: 'vt', ub: 'ub', bb: 'bb', fx: 'fx', aa: 'aa' };
        for (const [from, ev] of Object.entries(map)) {
          const n = Number(g[from]);
          if (Number.isFinite(n) && n >= 0.1) rec[ev] = rec[ev] == null ? n : Math.max(rec[ev], n);
        }
        highs.set(key, rec);
      }
      continue;
    }
    // Prefer full session rotations when present (live merge / future cache).
    const teams = s.teams || s.detail?.teams || [];
    if (Array.isArray(teams) && teams.length) {
      for (const t of teams) {
        const team = t.name || t.team_name || t.short_name;
        const recs = new Map();
        for (const rot of t.rotations || []) {
          const ev = evMap[rot.event] || evMap[(rot.event || '').toLowerCase()];
          if (!ev) continue;
          for (const g of rot.gymnasts || []) {
            if (g.exhibition) continue;
            const name = g.name || g.full_name || `${g.first_name || ''} ${g.last_name || ''}`.trim();
            const score = Number(g.score);
            if (!name || !Number.isFinite(score) || score < 0.1) continue;
            const key = `${team}|${normName(name)}`;
            const rec = recs.get(key) || { name, team, vt: null, ub: null, bb: null, fx: null, events: {} };
            rec[ev] = rec[ev] == null ? score : Math.max(rec[ev], score);
            rec.events[rot.event || ev] = rec[ev];
            recs.set(key, rec);
          }
        }
        for (const [key, rec] of recs) {
          const evs = ['vault', 'bars', 'beam', 'floor'];
          if (evs.every(e => rec.events[e] != null || rec[evMap[e]] != null)) {
            const aa = evs.reduce((sum, e) => sum + (rec[evMap[e]] ?? rec.events[e]), 0);
            rec.aa = Number(aa.toFixed(4));
          }
          const prev = highs.get(key);
          if (!prev) highs.set(key, rec);
          else {
            for (const ev of ['vt', 'ub', 'bb', 'fx', 'aa']) {
              if (rec[ev] != null) prev[ev] = prev[ev] == null ? rec[ev] : Math.max(prev[ev], rec[ev]);
            }
          }
        }
      }
      continue;
    }
    // Fallback: cached summaries only have eventHighs / allArounds (not a full roster of scores).
    for (const e of s.eventHighs || []) {
      const ev = evMap[e.event];
      if (!ev || !e.athlete || !e.team) continue;
      const score = Number(e.score);
      if (!Number.isFinite(score)) continue;
      const key = `${e.team}|${normName(e.athlete)}`;
      const rec = highs.get(key) || { name: e.athlete, team: e.team, vt: null, ub: null, bb: null, fx: null, aa: null };
      rec[ev] = rec[ev] == null ? score : Math.max(rec[ev], score);
      highs.set(key, rec);
    }
    for (const a of s.allArounds || []) {
      if (!a.athlete || !a.team) continue;
      const score = Number(a.score);
      if (!Number.isFinite(score)) continue;
      const key = `${a.team}|${normName(a.athlete)}`;
      const rec = highs.get(key) || { name: a.athlete, team: a.team, vt: null, ub: null, bb: null, fx: null, aa: null };
      rec.aa = rec.aa == null ? score : Math.max(rec.aa, score);
      if (a.events) {
        for (const [evName, evScore] of Object.entries(a.events)) {
          const ev = evMap[evName];
          const n = Number(evScore);
          if (ev && Number.isFinite(n)) rec[ev] = rec[ev] == null ? n : Math.max(rec[ev], n);
        }
      }
      highs.set(key, rec);
    }
  }
  let updated = 0;
  for (const team of Object.values(rosterFile.teams || {})) {
    for (const a of team.athletes || []) {
      const rec = highs.get(`${team.name}|${normName(a.name)}`);
      if (!rec) continue;
      for (const ev of ['vt', 'ub', 'bb', 'fx', 'aa']) {
        if (rec[ev] == null) continue;
        if (a[ev] == null || rec[ev] > a[ev] + 1e-9) {
          a[ev] = Number(rec[ev].toFixed(4));
          updated++;
        }
      }
    }
  }
  return { rosterFile, updated, tracked: highs.size };
}

async function main() {
  const meta = await readJson(join(DATA, 'team-meta.json'));
  const teams = (meta && meta.teams) || [];
  if (teams.length !== 62) log(`warn: expected 62 D1 teams, found ${teams.length}`);
  await mkdir(CACHE, { recursive: true });

  const schoolsOnly = !!args['schools-only'];
  const doSchools = !!args.schools || schoolsOnly;

  let r2026 = (await readJson(join(DATA, 'rosters', '2026.json'))) || { teams: {} };
  let r2027 = (await readJson(join(DATA, 'rosters', '2027.json'))) || { teams: {} };

  if (!schoolsOnly) {
    log('Fetching 2026 RTN dashboards + season highs…');
    const a = await fetchRtnSeason(teams, 2026);
    r2026 = { teams: a.out };
    await writeRosterFile(2026, a.out, { ...a.coverage, highs_source: 'Road to Nationals rostermain/{year}/{tid}/2' });

    log('Fetching 2027 RTN dashboards…');
    const b = await fetchRtnSeason(teams, 2027);
    r2027 = { teams: b.out };
    await writeRosterFile(2027, b.out, { ...b.coverage, highs_source: 'none yet (season has not started; scores are null / n/a)' });
  }

  if (doSchools) {
    log(`Scraping official 2027 school rosters (concurrency ${SCHOOL_CONCURRENCY})…`);
    const results = await mapPool(teams, SCHOOL_CONCURRENCY, async team => {
      const r = await scrapeSchoolRoster(team);
      log(`  ${team.name}: ${r.ok ? 'OK' : 'FAIL'} parser=${r.parser} n=${r.athletes.length} url=${r.url || ''} ${r.error || ''}`);
      return { team, r };
    });
    const schoolCov = { ok: 0, failed: [], added: 0, parsed: 0 };
    const teamsMap = { ...(r2027.teams || {}) };
    for (const { team, r } of results) {
      if (!r.ok) { schoolCov.failed.push({ name: team.name, slug: team.slug, tried: r.tried, error: r.error }); continue; }
      schoolCov.ok++;
      schoolCov.parsed += r.athletes.length;
      const merged = mergeSchoolInto(teamsMap[team.slug], { name: team.name, tid: team.tid, sourceUrl: r.url, athletes: r.athletes });
      teamsMap[team.slug] = merged.team || merged;
      schoolCov.added += (merged.added || []).length;
    }
    r2027 = { teams: teamsMap };
    await writeRosterFile(2027, teamsMap, { school_ok: schoolCov.ok, school_failed: schoolCov.failed, school_added: schoolCov.added, school_parsed: schoolCov.parsed });
  }
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  main().catch(e => { console.error(e); process.exit(1); });
}
