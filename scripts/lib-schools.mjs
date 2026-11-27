// Official athletics site map shared by announced-schedule, build-coaches, and build-rosters.
// Paths come from school sites already used in scripts/announced-schedule/scrape_lib.py,
// plus a few sport-path overrides discovered from live pages (never guessed names).

export const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 TheFiveThatScore-Scoreboard/1.0 (+https://x.com/thefivethatscore)';

export const SITES = {
  'Air Force': { site: 'goairforcefalcons.com' },
  'Alabama': { site: 'rolltide.com' },
  'Alaska': { site: 'goseawolves.com' },
  'Arizona': { site: 'arizonawildcats.com' },
  'Arizona State': { site: 'thesundevils.com' },
  'Arkansas': { site: 'arkansasrazorbacks.com', bases: ['/sport/w-gym/'] },
  'Auburn': { site: 'auburntigers.com' },
  'Ball State': { site: 'ballstatesports.com' },
  'Boise State': { site: 'broncosports.com' },
  'Bowling Green': { site: 'bgsufalcons.com' },
  'Brown': { site: 'brownbears.com' },
  'BYU': { site: 'byucougars.com' },
  'California': { site: 'calbears.com' },
  'Central Michigan': { site: 'cmuchippewas.com' },
  'Clemson': { site: 'clemsontigers.com', bases: ['/sports/gymnastics/'] },
  'Cornell': { site: 'cornellbigred.com' },
  'Denver': { site: 'denverpioneers.com' },
  'Eastern Michigan': { site: 'emueagles.com' },
  'Florida': { site: 'floridagators.com', bases: ['/sports/gymnastics/'] },
  'George Washington': { site: 'gwsports.com' },
  'Georgia': { site: 'georgiadogs.com' },
  'Illinois': { site: 'fightingillini.com' },
  'Illinois State': { site: 'goredbirds.com' },
  'Iowa': { site: 'hawkeyesports.com', bases: ['/sports/wgym/'] },
  'Iowa State': { site: 'cyclones.com' },
  'Kent State': { site: 'kentstatesports.com' },
  'Kentucky': { site: 'ukathletics.com', bases: ['/sports/wgym/', '/sports/gymnastics/'] },
  'LIU': { site: 'liuathletics.com' },
  'LSU': { site: 'lsusports.net', bases: ['/sports/gm/', '/sports/womens-gymnastics/', '/sports/gym/', '/sports/gymnastics/'] },
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
  'Ohio State': { site: 'ohiostatebuckeyes.com', bases: ['/sports/womens-gymnastics/'] },
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

const DEFAULT_BASES = [
  '/sports/womens-gymnastics/',
  '/sports/gymnastics/',
  '/sports/wgym/',
  '/sports/w-gym/',
  '/sport/w-gym/',
];

export function originFor(name) {
  const info = SITES[name];
  return info ? `https://${info.site}` : null;
}

export function candidateUrls(name, kind /* 'coaches' | 'roster' */) {
  const info = SITES[name];
  if (!info) return [];
  const origin = `https://${info.site}`;
  const bases = [...(info.bases || []), ...DEFAULT_BASES];
  const pages = kind === 'coaches'
    ? ['coaches', 'coaches/', 'staff', 'staff/', 'roster', 'roster/']
    : ['roster', 'roster/', 'roster/2026-27', 'roster/2026-27/', 'roster?view=2'];
  const urls = [];
  const seen = new Set();
  for (const base of bases) {
    const b = base.endsWith('/') ? base : base + '/';
    for (const page of pages) {
      const url = origin + b + page;
      if (!seen.has(url)) { seen.add(url); urls.push(url); }
    }
  }
  if (kind === 'coaches') {
    for (const p of ['/staff-directory', '/staff-directory/', '/sports/staff-directory']) {
      const url = origin + p;
      if (!seen.has(url)) { seen.add(url); urls.push(url); }
    }
  }
  return urls;
}

export async function politeFetch(url, { accept = 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8', timeoutMs = 25000 } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: accept, 'Accept-Language': 'en-US,en;q=0.9' },
      redirect: 'follow',
      signal: ctrl.signal,
    });
    const buf = Buffer.from(await res.arrayBuffer());
    const ctype = res.headers.get('content-type') || '';
    const text = buf.toString('utf8');
    return { ok: res.ok, status: res.status, url: res.url, ctype, text, buf };
  } catch (e) {
    return { ok: false, status: 0, url, ctype: '', text: '', buf: Buffer.alloc(0), error: String(e.message || e) };
  } finally {
    clearTimeout(t);
  }
}

export async function mapPool(items, concurrency, fn) {
  const out = new Array(items.length);
  let i = 0;
  async function worker() {
    for (;;) {
      const idx = i++;
      if (idx >= items.length) return;
      out[idx] = await fn(items[idx], idx);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return out;
}

export function parseNuxt(html) {
  const m = String(html || '').match(/<script[^>]*id="__NUXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) return null;
  try { return JSON.parse(m[1]); } catch { return null; }
}

export function nuxtResolve(data, x, seen = new Set()) {
  if (typeof x === 'number') {
    if (x < 0 || x >= data.length) return x;
    const val = data[x];
    if (val == null || typeof val !== 'object') return val;
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

export function stripTags(s) {
  return String(s || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/h[1-6]>/gi, '\n')
    .replace(/<li[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&ldquo;|&rdquo;/g, '"')
    .replace(/&lsquo;|&rsquo;|&#8217;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

export function pageTitle(html) {
  const m = String(html || '').match(/<title>([\s\S]*?)<\/title>/i);
  return m ? stripTags(m[1]) : '';
}

export function isNotFoundPage(html, status) {
  if (status === 404) return true;
  const t = pageTitle(html);
  return /404|page not found|not found \|/i.test(t);
}
