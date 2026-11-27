#!/usr/bin/env node
// Builds data/coaches.json from official school athletics coaching staff pages.
// Never invents a coach name, title, or bio detail. Bios are 1–2 sentences
// distilled from the official school bio (or left blank if none is published).
//
// Usage:
//   node scripts/build-coaches.mjs
//
// Politeness: concurrency 6, small gap between requests to the same host.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  SITES, candidateUrls, politeFetch, mapPool,
  parseNuxt, nuxtResolve, stripTags, isNotFoundPage, pageTitle,
} from './lib-schools.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = join(ROOT, 'data');
const CONCURRENCY = Number(process.env.SCHOOL_CONCURRENCY ?? 6);

const log = (...a) => console.log(...a);
const rel = p => p.replace(ROOT + '/', '');
async function readJson(p, fallback = null) {
  try { return JSON.parse(await readFile(p, 'utf8')); } catch { return fallback; }
}
async function writeJson(p, obj) {
  await mkdir(dirname(p), { recursive: true });
  await writeFile(p, JSON.stringify(obj, null, 1) + '\n');
}

const COACH_TITLE_RE = /\b(head\s+coach|head\s+(?:women'?s\s+)?gymnastics\s+coach|associate\s+head|co-?associate\s+head|assistant\s+coach|volunteer(?:\s+assistant)?(?:\s+coach)?|student\s+assistant(?:\s+coach)?|graduate(?:\s+student)?\s+coach|co-?head\s+coach|interim\s+head\s+coach|director of (?:women'?s\s+)?gymnastics|coach)\b/i;
const EXCLUDE_TITLE_RE = /\b(director of operations|operations director|athletic trainer|strength(?:\s*[&+/]\s*conditioning)?|sports?\s+performance|sport psychology|nutrition|communications?|sports?\s*info|SID\b|equipment|administrat(?:ive|or)|associate\s+AD|assistant\s+AD|academic(?:s)?\s|undergraduate advising|compliance|marketing|graphic|video\s+coord|photographer|manager(?!\s+coach)|wellness coordinator|performance nutrition)\b/i;

function isCoachTitle(title) {
  const t = String(title || '').replace(/[’']/g, "'").trim();
  if (!t) return false;
  if (/\boperations\b/i.test(t) && !/\b(head|assistant|associate)\s+coach\b/i.test(t)) return false;
  if (EXCLUDE_TITLE_RE.test(t) && !/\b(head|assistant|associate)\s+coach\b/i.test(t)) return false;
  return COACH_TITLE_RE.test(t);
}

function cleanName(s) {
  return String(s || '').replace(/\s+/g, ' ').trim();
}
function isPersonName(s) {
  const t = cleanName(s);
  if (t.length < 4 || t.length > 50) return false;
  if (!/^[A-ZÀ-ÖØ-Þ]/.test(t)) return false;
  if (!/^[A-Za-zÀ-ÿ'."“”\- ]+$/.test(t)) return false;
  const words = t.split(' ').filter(Boolean);
  if (words.length < 2 || words.length > 5) return false;
  if (/^(fr|so|jr|sr|gr)\.?$/i.test(t)) return false;
  if (/hometown|full bio|roster|coach staff/i.test(t)) return false;
  return true;
}


function roleRank(title) {
  const t = String(title || '').toLowerCase().replace(/[’']/g, "'");
  const junior = /\b(assistant|volunteer|student|graduate)\b/.test(t);
  const assoc = /\bassociate\b/.test(t);
  const isHead = ((/\bhead\b/.test(t) && /\bcoach\b/.test(t)) || /director of (?:women'?s\s+)?gymnastics/.test(t)) && !junior && !assoc && !/\boperations\b/.test(t);
  if (isHead) return 0;
  if (/co-?associate|associate\s+head/.test(t)) return 1;
  if (/associate\s+coach/.test(t) && !/performance/.test(t)) return 2;
  if (/assistant\s+coach/.test(t) && !/volunteer|student|graduate/.test(t)) return 3;
  if (/volunteer/.test(t)) return 4;
  if (/graduate|student\s+assistant/.test(t)) return 5;
  return 6;
}

function displayName(obj) {
  if (obj.name) return String(obj.name).replace(/\s+/g, ' ').trim();
  const first = (obj.firstName || obj.first_name || '').trim();
  const last = (obj.lastName || obj.last_name || '').trim();
  const full = (obj.full_name || obj.fullName || `${first} ${last}`).replace(/\s+/g, ' ').trim();
  return full;
}

function absUrl(base, path) {
  if (!path) return null;
  try { return new URL(path, base).href; } catch { return null; }
}

/** 1–2 factual sentences from an official bio. No invented details. */
export function distillBio(raw, { name, title, alma } = {}) {
  let text = stripTags(raw || '');
  text = text.replace(/\b(privacy policy|cookie settings|terms of (?:use|service))[\s\S]*$/i, '').trim();
  if (/social media directory|email lookup|mailing address|choose a staff member|guest services/i.test(text.slice(0, 280))) {
    text = '';
  }
  if (/^Title\b/i.test(text) && /\b(Email|Phone)\b/i.test(text) && text.length < 200) text = '';
  if (!text) return '';
  // Drop leading honor-billboard lines (short lines of awards) until prose begins.
  const lines = text.split(/\n+/).map(l => l.trim()).filter(Boolean);
  const proseChunks = [];
  for (const line of lines) {
    const isHonorList = (
      /^(honors?|accolades|coaching history|coach \w+|family|hometown|college|education)\b/i.test(line)
      || (/^\d{4}\b/.test(line) && line.length < 140)
      || (line.length < 90 && /\b(coach of the year|all-american|hall of fame|finalist|champion)\b/i.test(line) && !/\b(is|was|has|joined|hired|named the|arrived|wrapped)\b/i.test(line))
    );
    if (isHonorList && !proseChunks.length) continue;
    proseChunks.push(line);
  }
  const blob = (proseChunks.length ? proseChunks.join(' ') : text).replace(/\s+/g, ' ').trim();
  // Sentence split that keeps abbreviations like N.C.A.A. and K.J.
  const parts = blob.split(/(?<=[.!?])\s+(?=[A-Z“"'])/);
  const sentences = [];
  for (const p of parts) {
    const s = p.trim();
    if (s.length < 40) {
      if (sentences.length && s.length > 0) sentences[sentences.length - 1] += ' ' + s;
      continue;
    }
    // Skip leftover all-caps or heading-like fragments
    if (/^[A-Z0-9 ,.&/()-]{20,}$/.test(s) && !/[a-z]/.test(s)) continue;
    sentences.push(s);
    if (sentences.length >= 2) break;
  }
  let out = sentences.join(' ').trim();
  if (!out) {
    // Structured fact sheet only — never invent a generic "is listed as" sentence.
    const yearAt = blob.match(/(?:20\d{2}|19\d{2})\s*[-–]\s*(?:present|current)/i);
    const almaHit = blob.match(/(?:college|alma mater|graduated(?: from)?|degree)\s*[:,]?\s*([^.]{4,60})/i);
    const bits = [];
    if (yearAt) bits.push(`Official coaching history includes ${yearAt[0]}.`);
    if (almaHit) bits.push(`Alma mater listed: ${almaHit[1].trim().replace(/[,;]+$/, '')}.`);
    out = bits.join(' ');
  }
  if (out.length > 520) {
    const cut = out.lastIndexOf('.', 500);
    out = (cut > 200 ? out.slice(0, cut + 1) : out.slice(0, 500).replace(/\s+\S*$/, '') + '…');
  }
  return out;
}

function collectSidearmCoaches(data) {
  const out = [];
  const seen = new Set();
  for (let i = 0; i < data.length; i++) {
    const item = data[i];
    if (!item || typeof item !== 'object') continue;
    if (!('coaches' in item) && !('support' in item) && !('supportStaff' in item)) continue;
    const r = nuxtResolve(data, i);
    const lists = [].concat(r.coaches || [], r.support || [], r.supportStaff || []);
    for (const c of lists) {
      if (!c || typeof c !== 'object') continue;
      const name = displayName(c);
      const title = (c.title || c.positionShort || c.position || '').toString().trim();
      if (!isPersonName(name) || !isCoachTitle(title)) continue;
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        name,
        title,
        bioRaw: c.bio || c.biography || '',
        url: c.url || c.absoluteUrl || null,
        alma: null,
        source: 'sidearm-nuxt',
      });
    }
  }
  return out;
}

function collectWmtStaff(data) {
  const out = [];
  const seen = new Set();
  for (let i = 0; i < data.length; i++) {
    const item = data[i];
    if (!item || typeof item !== 'object') continue;
    if (!('first_name' in item && 'position' in item && ('relative_url' in item || 'permalink' in item || 'staff_member' in item))) continue;
    const r = nuxtResolve(data, i);
    const name = displayName(r);
    const title = String(r.position || r.title || '').trim();
    if (!isPersonName(name) || !isCoachTitle(title)) continue;
    const key = (r.id != null ? 'id:' + r.id : name.toLowerCase());
    if (seen.has(key)) continue;
    seen.add(key);
    const fields = {};
    for (const f of r.profile_field_values || []) {
      if (!f || typeof f !== 'object') continue;
      const fname = (f.profile_field && f.profile_field.name) || f.name;
      if (fname) fields[fname] = f.value;
    }
    out.push({
      name,
      title,
      bioRaw: r.biography || r.master_biography || r.short_master_biography || r.bio || '',
      url: r.relative_url || r.permalink || r.url || null,
      alma: fields['Alma Mater'] || fields['Alma mater'] || fields['College'] || null,
      source: 'wmt-nuxt',
    });
  }
  return out;
}

function coachesFromHtml(html, pageUrl) {
  const out = [];
  const seen = new Set();
  const add = (name, title, url) => {
    name = cleanName(name);
    title = cleanName(title);
    if (!isPersonName(name) || !isCoachTitle(title)) return;
    const key = name.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ name, title, bioRaw: '', url: url || null, alma: null, source: 'html' });
  };

  // Classic Sidearm coaches table
  const rowRe = /<tr[^>]*class="[^"]*sidearm-coaches-coach[^"]*"[^>]*>([\s\S]*?)<\/tr>/gi;
  let m;
  while ((m = rowRe.exec(html))) {
    const name = stripTags((m[1].match(/<a[^>]*>([\s\S]*?)<\/a>/i) || [])[1] || '');
    const href = (m[1].match(/<a[^>]*href=['"]([^'"]+)['"]/i) || [])[1] || null;
    const tds = [...m[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(x => stripTags(x[1]));
    const title = tds.find(isCoachTitle) || tds[0] || '';
    add(name, title, href);
  }

  // Classic Sidearm roster-page coach cards
  const cardRe = /<div[^>]*class="[^"]*sidearm-roster-coach-name[^"]*"[^>]*>([\s\S]*?)<\/div>[\s\S]{0,400}?<div[^>]*class="[^"]*sidearm-roster-coach-title[^"]*"[^>]*>([\s\S]*?)<\/div>/gi;
  while ((m = cardRe.exec(html))) {
    const name = stripTags(m[1].match(/<a[^>]*>([\s\S]*?)<\/a>/i)?.[1] || m[1]);
    const href = (m[1].match(/<a[^>]*href=['"]([^'"]+)['"]/i) || [])[1] || null;
    add(name, stripTags(m[2]), href);
  }

  // Newer card markup (name + title classes)
  const genericRe = /<(?:h[1-4]|div|span|a)[^>]*class="[^"]*(?:coach-name|staff-name|c-coach__name)[^"]*"[^>]*>([\s\S]*?)<\/(?:h[1-4]|div|span|a)>[\s\S]{0,400}?<(?:div|span|p|h[1-4]|td)[^>]*class="[^"]*(?:title|position|coach-title|staff-title)[^"]*"[^>]*>([\s\S]*?)<\/(?:div|span|p|h[1-4]|td)>/gi;
  while ((m = genericRe.exec(html))) add(stripTags(m[1]), stripTags(m[2]));

  // Kentucky / UK Athletics roster cards
  const ukRe = /<a[^>]*href=['"]([^'"]+)['"][^>]*>[\s\S]{0,800}?<h3[^>]*class="[^"]*roster-item__name[^"]*"[^>]*>([\s\S]*?)<\/h3>[\s\S]{0,240}?<p[^>]*class="[^"]*roster-item__info[^"]*"[^>]*>([\s\S]*?)<\/p>/gi;
  while ((m = ukRe.exec(html))) add(stripTags(m[2]), stripTags(m[3]), m[1]);

  // Arkansas-style staff table: name link + title cell
  if (!out.length) {
    const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    while ((m = trRe.exec(html))) {
      const href = (m[1].match(/<a[^>]*href=['"]([^'"]*(?:coache|coach|staff)[^'"]*)['"]/i) || [])[1];
      const name = stripTags((m[1].match(/<a[^>]*>([\s\S]*?)<\/a>/i) || [])[1] || '');
      const cells = [...m[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(x => stripTags(x[1]));
      const title = cells.find(isCoachTitle);
      if (name && title) add(name, title, href);
    }
  }

  return out;
}

function extractBioFromPage(html) {
  const isChrome = (text) => /social media directory|email lookup|mailing address|choose a staff member|guest services/i.test((text || '').slice(0, 280));
  const score = (raw) => {
    const text = stripTags(raw);
    if (!text || text.length < 80 || isChrome(text)) return 0;
    return text.length;
  };
  let best = '';
  let bestScore = 0;
  const consider = (raw) => {
    if (typeof raw !== 'string') return;
    const s = score(raw);
    if (s > bestScore) { best = raw; bestScore = s; }
  };

  const nuxt = parseNuxt(html);
  if (nuxt) {
    for (const item of nuxt) {
      if (typeof item === 'string' && item.length > 200 && /<[a-z]/i.test(item) && !/imgproxy|srcset|cloudfront/i.test(item)) consider(item);
    }
    for (let i = 0; i < nuxt.length; i++) {
      const item = nuxt[i];
      if (!item || typeof item !== 'object') continue;
      if (!('bio' in item) && !('biography' in item) && !('master_biography' in item) && !('short_master_biography' in item) && !('content' in item)) continue;
      const r = nuxtResolve(nuxt, i);
      consider(r.bio || r.biography || r.master_biography || r.short_master_biography || r.content);
    }
  }
  const re = /<(?:div|article|section)[^>]*class="[^"]*(?:bio-data-content|staff-bio|coach-bio|sidearm-staff-bio|bordeaux_bio__content|bio__content|bio__body|c-bio|s-bio)[^"]*"[^>]*>([\s\S]*?)<\/(?:div|article|section)>/gi;
  let m;
  while ((m = re.exec(html))) consider(m[1]);
  return best;
}

async function enrichBios(coaches, pageUrl) {
  const out = [];
  for (const c of coaches) {
    let raw = c.bioRaw;
    const bioUrl = absUrl(pageUrl, c.url);
    if ((!raw || stripTags(raw).length < 80) && bioUrl && bioUrl !== pageUrl && /\/(coache|coaches?|staff|roster|bios?|directory)/i.test(bioUrl)) {
      const r = await politeFetch(bioUrl);
      if (r.ok && !isNotFoundPage(r.text, r.status)) {
        const extracted = extractBioFromPage(r.text);
        if (stripTags(extracted).length > stripTags(raw).length) raw = extracted;
      }
    }
    const bio = distillBio(raw, { name: c.name, title: c.title, alma: c.alma });
    out.push({
      name: c.name,
      title: c.title,
      bio,
      role: roleRank(c.title) === 0 ? 'head' : 'assistant',
      bioUrl: bioUrl || null,
    });
  }
  out.sort((a, b) => roleRank(a.title) - roleRank(b.title) || a.name.localeCompare(b.name));
  return out;
}

function looksLikeGymnasticsPage(html, url, title) {
  const blob = `${url} ${title} ${html.slice(0, 8000)}`;
  if (/football|basketball|baseball|softball|soccer|volleyball|wrestling|track|swimming/i.test(title) && !/gymnast/i.test(title)) return false;
  return /gymnast|w-gym|wgym|wgy|sport\/w-gym/i.test(blob);
}

async function scrapeTeam(team) {
  const urls = candidateUrls(team.name, 'coaches');
  const tried = [];
  let best = { coaches: [], url: null, parser: null };
  for (const url of urls) {
    const r = await politeFetch(url);
    tried.push(`${url} -> ${r.status}`);
    if (!r.ok || isNotFoundPage(r.text, r.status)) continue;
    const title = pageTitle(r.text);
    const nuxt = parseNuxt(r.text);
    let coaches = [];
    let parser = null;
    if (nuxt) {
      const side = collectSidearmCoaches(nuxt);
      const wmt = collectWmtStaff(nuxt);
      if (side.length >= wmt.length && side.length) { coaches = side; parser = 'sidearm-nuxt'; }
      else if (wmt.length) { coaches = wmt; parser = 'wmt-nuxt'; }
    }
    if (!coaches.length) {
      const htmlC = coachesFromHtml(r.text, r.url);
      if (htmlC.length) { coaches = htmlC; parser = 'html'; }
    }
    // For staff-directory pages, only keep if we can tell they're gymnastics
    const isDir = /staff-directory/i.test(r.url);
    const isGenericStaff = /\/staff\/?(\?|$)/i.test(r.url) && !/roster\/staff/i.test(r.url);
    if ((isDir || isGenericStaff) && !looksLikeGymnasticsPage(r.text, r.url, title)) continue;
    if (coaches.length > 12 && !/\/coaches/i.test(r.url)) continue; // full athletics staff dump
    if (coaches.length && (!isDir || looksLikeGymnasticsPage(r.text, r.url, title) || coaches.some(c => /gym/i.test(c.title)))) {
      const hasHead = coaches.some(c => roleRank(c.title) === 0);
      const dedicated = /\/(coaches|roster)/i.test(r.url) && !isDir && !isGenericStaff;
      const bestDedicated = best.url && /\/(coaches|roster)/i.test(best.url) && !/staff-directory|\/staff\/?$/i.test(best.url);
      const better = (!best.coaches.length)
        || (dedicated && !bestDedicated)
        || (dedicated === bestDedicated && (hasHead && !best.coaches.some(c => roleRank(c.title) === 0)))
        || (dedicated === bestDedicated && coaches.length > best.coaches.length && coaches.length <= 12);
      if (better) best = { coaches, url: r.url, parser, title };
      if (hasHead && dedicated) break;
    }
  }
  if (!best.coaches.length) {
    return { ok: false, name: team.name, slug: team.slug, sourceUrl: null, parser: null, coaches: [], tried, error: 'no coaches parsed' };
  }
  const coaches = await enrichBios(best.coaches, best.url);
  return {
    ok: coaches.length > 0,
    name: team.name,
    slug: team.slug,
    sourceUrl: best.url,
    parser: best.parser,
    coaches,
    tried,
    error: coaches.length ? null : 'bios/titles filtered to empty',
  };
}

async function main() {
  const meta = await readJson(join(DATA, 'team-meta.json'));
  const teams = (meta && meta.teams) || [];
  log(`Scraping official coaching staff pages for ${teams.length} teams (concurrency ${CONCURRENCY})…`);
  const results = await mapPool(teams, CONCURRENCY, async team => {
    try {
      const r = await scrapeTeam(team);
      const nBio = r.coaches.filter(c => c.bio).length;
      const head = r.coaches.find(c => c.role === 'head');
      log(`  ${team.name}: ${r.ok ? 'OK' : 'FAIL'} parser=${r.parser} n=${r.coaches.length} bios=${nBio} head=${head ? head.name : '—'} url=${r.sourceUrl || ''} ${r.error || ''}`);
      return r;
    } catch (e) {
      log(`  ${team.name}: ERROR ${e.message || e}`);
      return { ok: false, name: team.name, slug: team.slug, sourceUrl: null, parser: null, coaches: [], tried: [], error: String(e.message || e) };
    }
  });

  const teamsOut = {};
  const failed = [];
  let withHead = 0, withBio = 0, totalCoaches = 0, totalBios = 0;
  for (const r of results) {
    teamsOut[r.slug] = {
      name: r.name,
      sourceUrl: r.sourceUrl,
      parser: r.parser,
      coaches: r.coaches.map(({ name, title, bio, role }) => ({ name, title, bio, role })),
    };
    if (!r.ok || !r.coaches.length) failed.push({ name: r.name, slug: r.slug, error: r.error, tried: r.tried });
    else {
      totalCoaches += r.coaches.length;
      const bios = r.coaches.filter(c => c.bio).length;
      totalBios += bios;
      if (r.coaches.some(c => c.role === 'head')) withHead++;
      if (bios) withBio++;
    }
  }
  const payload = {
    generated_at: new Date().toISOString(),
    source: 'Official school athletics coaching staff / roster pages',
    teams: teamsOut,
    coverage: {
      teams: results.length,
      ok: results.length - failed.length,
      failed,
      with_head_coach: withHead,
      teams_with_at_least_one_bio: withBio,
      coaches: totalCoaches,
      bios: totalBios,
    },
  };
  const p = join(DATA, 'coaches.json');
  await writeJson(p, payload);
  log(`wrote ${rel(p)}: ${payload.coverage.ok}/${payload.coverage.teams} teams, ${totalCoaches} coaches, ${totalBios} bios, ${withHead} head coaches`);
  if (failed.length) {
    log('Gaps:');
    for (const f of failed) log(`  - ${f.name}: ${f.error}`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
