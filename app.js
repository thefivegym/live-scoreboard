/* The Five That Score — Live D1 Scoreboard. Vanilla JS, no build step. */
(() => {
  'use strict';

  const TZ = 'America/Chicago';
  const VIRTIUS_API = key => `https://api.virti.us/session/${encodeURIComponent(key)}/json`;
  const VIRTIUS_PAGE = key => `https://scores.virti.us/?s=${encodeURIComponent(key)}`;
  const POLL_MS = 30000;          // live Virtius meets
  const FALLBACK_POLL_MS = 120000; // RTN fallback files (rebuilt ~every 10 min by the workflow)
  const DEMO = { date: '2026-04-18', meet: 'MFrZ9epozB', regular: '2026-02-13', conf: '2026-03-21' };
  const EVENTS = [
    { key: 'vault', label: 'Vault', abbr: 'VT' },
    { key: 'bars', label: 'Bars', abbr: 'UB' },
    { key: 'beam', label: 'Beam', abbr: 'BB' },
    { key: 'floor', label: 'Floor', abbr: 'FX' },
  ];
  const EV_BY_NAME = { VAULT: 'vault', BARS: 'bars', BEAM: 'beam', FLOOR: 'floor', 'ALL AROUND': 'aa', 'ALL-AROUND': 'aa', AA: 'aa' };
  // Virtius session keys are URL-safe tokens (letters, digits, and occasionally - or _).
  const VIRTIUS_KEY = /^[A-Za-z0-9_-]{6,32}$/;
  const $ = sel => document.querySelector(sel);
  const el = {
    meets: $('#meets'), date: $('#date'), dateText: $('#date-text'), prev: $('#prev'), next: $('#next'),
    today: $('#today'), banner: $('#banner'), status: $('#status-line'), pulse: $('#season-pulse'), hero: $('#season-hero'), filters: $('#meet-filters'),
  };

  const params = new URLSearchParams(location.search);
  let demo = params.has('demo');
  const state = {
    date: null,
    schedules: {},        // season -> {meets, ...} | null
    main: null,           // data/schedule.json
    meets: [],            // meets for the selected date
    details: {},          // meetKey -> normalized detail
    open: new Set(),
    tab: {},              // meetKey -> selected tab
    lastUpdate: null,
    timer: null,
    renderToken: 0,
    adhoc: {},            // date -> meets built from a #meet=KEY deep link
    flashKey: null,
    d1: null,             // D1 team list + meta (slug, colors)
    team: null,           // slug when a team profile is open
    teamSeason: null,
    teamLists: null,      // {upcoming, past, ...} for the open profile
    rankings: null,       // data/rankings.json
    seasonStats: null,    // data/season-stats.json
    coachesData: null,    // data/coaches.json
    rosters: {},          // season -> data/rosters/{season}.json
    rosterSort: { key: 'name', dir: 1 },
    coachesShowAll: false,
    favs: new Set(),      // team slugs, persisted in localStorage
    favAthletes: [],      // { teamSlug, athleteId, slug, name, teamName }, persisted
    athlete: null,        // athlete slug highlighted on a team profile
    athletePendingScroll: false,
    filter: 'all',        // all | live | favorites | top25 | SEC | Big Ten | Big 12 | ACC | Other
    polling: false,
  };

  // ---------- utilities ----------
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = v => { if (v === null || v === undefined || v === '') return null; const n = Number(v); return Number.isFinite(n) && n > 0 ? n : null; };
  // Scores show 3 decimals, or 4 when the meet uses quarter-thousandths (e.g. 6-judge panels).
  let prec = 3;
  const needs4 = n => n !== null && n !== undefined && Math.round(n * 10000) % 10 !== 0;
  const fmtScore = n => n === null || n === undefined ? '—' : n.toFixed(Math.max(prec, needs4(n) ? 4 : 3));
  const precisionOf = d => (d && d.teams && d.teams.some(t => needs4(t.score) || t.rotations.some(r => needs4(r.score) || r.gymnasts.some(g => needs4(g.score))))) ? 4 : 3;
  let NOW_OVERRIDE = (() => { const v = new URLSearchParams(location.search).get('now'); return /^\d{4}-\d{2}-\d{2}$/.test(v || '') ? v : null; })();
  let SEASON_OVERRIDE = (() => { const v = new URLSearchParams(location.search).get('season'); return /^\d{4}$/.test(v || '') ? Number(v) : null; })();
  const todayChicago = () => NOW_OVERRIDE || new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const addDays = (ymd, n) => { const d = new Date(ymd + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const seasonFor = ymd => { const [y, m] = ymd.split('-').map(Number); return m >= 7 ? y + 1 : y; };
  const isYmd = s => /^\d{4}-\d{2}-\d{2}$/.test(s || '') && !Number.isNaN(Date.parse(s));
  const longDate = ymd => new Date(ymd + 'T12:00:00Z').toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  const shortDate = ymd => new Date(ymd + 'T12:00:00Z').toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' });
  function formatMeetTime(iso) {
    if (!iso || iso === 'TBD' || iso === 'TBA') return 'Time TBA';
    const ms = Date.parse(iso);
    if (!Number.isFinite(ms)) return 'Time TBA';
    try {
      const parts = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).formatToParts(new Date(ms));
      const get = typ => { const p = parts.find(x => x.type === typ); return p ? p.value : ''; };
      const hour = get('hour'), minute = get('minute'), dayPeriod = get('dayPeriod'), tz = get('timeZoneName');
      if (!hour || !minute) return 'Time TBA';
      const time = dayPeriod ? `${hour}:${minute} ${dayPeriod}` : `${hour}:${minute}`;
      return tz ? `${time} ${tz}` : time;
    } catch {
      return 'Time TBA';
    }
  }
  const timeCT = formatMeetTime;
  const meetKey = m => m.virtius || `rtn-${m.id}`;
  const FAV_KEY = 'tfts-favorites';
  const ATH_FAV_KEY = 'tf_fav_athletes_v1';
  const POWER_CONF = { SEC: 'SEC', 'Big Ten': 'Big Ten', 'Big 12': 'Big 12', ACC: 'ACC' };
  const confGroup = conf => POWER_CONF[conf] || 'Other';
  function loadFavs() {
    try {
      const raw = JSON.parse(localStorage.getItem(FAV_KEY) || '[]');
      state.favs = new Set(Array.isArray(raw) ? raw.filter(s => typeof s === 'string' && s) : []);
    } catch { state.favs = new Set(); }
  }
  function saveFavs() {
    try { localStorage.setItem(FAV_KEY, JSON.stringify([...state.favs])); } catch { /* private mode */ }
  }
  const athleteSlug = name => String(name || '').normalize('NFKD').replace(/\p{M}+/gu, '').toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  function athleteFavKey(teamSlug, slug) { return `${teamSlug || ''}::${slug || ''}`; }
  function loadFavAthletes() {
    try {
      const raw = JSON.parse(localStorage.getItem(ATH_FAV_KEY) || '[]');
      const list = Array.isArray(raw) ? raw : [];
      const seen = new Set();
      state.favAthletes = [];
      for (const row of list) {
        if (!row || typeof row !== 'object') continue;
        const teamSlug = String(row.teamSlug || '').trim();
        const name = String(row.name || '').trim();
        const slug = String(row.slug || row.athleteSlug || athleteSlug(name)).trim();
        if (!teamSlug || !slug || !name) continue;
        const k = athleteFavKey(teamSlug, slug);
        if (seen.has(k)) continue;
        seen.add(k);
        state.favAthletes.push({
          teamSlug,
          athleteId: row.athleteId ?? row.id ?? null,
          slug,
          name,
          teamName: String(row.teamName || '').trim(),
        });
      }
    } catch { state.favAthletes = []; }
  }
  function saveFavAthletes() {
    try { localStorage.setItem(ATH_FAV_KEY, JSON.stringify(state.favAthletes)); } catch { /* private mode */ }
  }
  function isFavAthlete(teamSlug, slug) {
    return state.favAthletes.some(a => a.teamSlug === teamSlug && a.slug === slug);
  }
  function favAthleteRecord(teamSlug, slug, extras = {}) {
    const team = state.d1 && state.d1.bySlug.get(teamSlug);
    return {
      teamSlug,
      athleteId: extras.athleteId ?? extras.id ?? null,
      slug,
      name: extras.name || slug,
      teamName: extras.teamName || (team && team.name) || teamSlug,
    };
  }
  function toggleFavAthlete(teamSlug, slug, extras = {}) {
    if (!teamSlug || !slug) return;
    const i = state.favAthletes.findIndex(a => a.teamSlug === teamSlug && a.slug === slug);
    if (i >= 0) state.favAthletes.splice(i, 1);
    else state.favAthletes.push(favAthleteRecord(teamSlug, slug, extras));
    saveFavAthletes();
    renderFavPicker();
    refreshAthleteStars();
  }
  function refreshAthleteStars() {
    document.querySelectorAll('[data-fav-athlete]').forEach(btn => {
      const slug = btn.dataset.favAthlete;
      const team = btn.dataset.favTeam;
      const on = isFavAthlete(team, slug);
      const name = btn.dataset.favName || 'athlete';
      btn.classList.toggle('on', on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      const label = on ? `Unstar ${name}` : `Star ${name}`;
      btn.setAttribute('aria-label', label);
      btn.title = label;
      btn.textContent = on ? '★' : '☆';
      const row = btn.closest('.fav-pick-item, .team-opt, tr');
      if (row && (row.classList.contains('fav-pick-item') || row.classList.contains('team-opt'))) {
        row.classList.toggle('is-fav', on);
      }
    });
  }
  function athleteStarBtn(teamSlug, slug, name, extras = {}) {
    if (!teamSlug || !slug) return '';
    const on = isFavAthlete(teamSlug, slug);
    const label = on ? `Unstar ${name}` : `Star ${name}`;
    const cls = extras.cls ? ` ${extras.cls}` : '';
    return `<button type="button" class="star-btn${on ? ' on' : ''}${cls}" data-fav-athlete="${esc(slug)}" data-fav-team="${esc(teamSlug)}" data-fav-name="${esc(name)}"${extras.athleteId != null ? ` data-fav-id="${esc(String(extras.athleteId))}"` : ''} aria-pressed="${on}" aria-label="${esc(label)}" title="${esc(label)}">${on ? '★' : '☆'}</button>`;
  }
  function searchSeason() {
    if (state.team && state.teamSeason) return state.teamSeason;
    if (SEASON_OVERRIDE) return SEASON_OVERRIDE;
    return defaultSeason();
  }
  function athleteSeasonCandidates(preferred) {
    const natural = defaultSeason();
    const y = preferred || natural;
    const years = [y];
    if (y !== natural) years.push(natural);
    if (!years.includes(y - 1)) years.push(y - 1);
    if (y + 1 !== natural && y + 1 > natural) { /* don't look into a future unpublished year */ }
    else if (!years.includes(y + 1) && y + 1 <= natural) years.push(y + 1);
    return years;
  }
  function findAthleteInRoster(teamSlug, slug, season) {
    const file = state.rosters[season];
    const rec = file && file.teams && file.teams[teamSlug];
    if (!rec) return null;
    const want = String(slug || '').toLowerCase();
    return (rec.athletes || []).find(a => athleteSlug(a.name) === want || (a.id != null && String(a.id) === want)) || null;
  }
  async function resolveAthleteSeason(teamSlug, slug, preferred) {
    const years = athleteSeasonCandidates(preferred);
    for (const y of years) {
      await loadRoster(y);
      if (findAthleteInRoster(teamSlug, slug, y)) return y;
    }
    return preferred || defaultSeason();
  }
  function collectSearchAthletes() {
    const out = [];
    const seen = new Set();
    const preferred = searchSeason();
    const seasons = [preferred, ...Object.keys(state.rosters).map(Number).filter(y => y !== preferred)].filter(y => state.rosters[y] && state.rosters[y].teams);
    const teams = (state.d1 && state.d1.teams) || [];
    for (const y of seasons) {
      const file = state.rosters[y];
      for (const team of teams) {
        const rec = file.teams[team.slug];
        if (!rec) continue;
        for (const a of rec.athletes || []) {
          const slug = athleteSlug(a.name);
          if (!slug) continue;
          const k = athleteFavKey(team.slug, slug);
          if (seen.has(k)) continue;
          seen.add(k);
          out.push({ name: a.name, slug, athleteId: a.id ?? null, teamSlug: team.slug, teamName: team.name, season: y, color: team.color, color2: team.color2, abbr: team.abbr });
        }
      }
    }
    return out;
  }
  async function ensureRostersForSearch() {
    const y = searchSeason();
    const jobs = [loadRoster(y)];
    const other = y === defaultSeason() ? y - 1 : defaultSeason();
    if (other && other !== y) jobs.push(loadRoster(other));
    await Promise.all(jobs);
  }
  function focusAthleteRow(slug, { instant } = {}) {
    if (!slug) return false;
    const row = document.getElementById(`athlete-${slug}`) || document.querySelector(`tr[data-athlete="${CSS.escape(slug)}"]`);
    if (!row) return false;
    row.scrollIntoView({ behavior: instant ? 'auto' : 'smooth', block: 'center' });
    return true;
  }
  function scheduleAthleteScroll() {
    if (!state.athletePendingScroll || !state.athlete) return;
    const slug = state.athlete;
    const go = (instant) => { if (state.athletePendingScroll && state.athlete === slug) focusAthleteRow(slug, { instant }); };
    requestAnimationFrame(() => requestAnimationFrame(() => go(false)));
  }
  function teamByNameOrSlug(v) {
    return state.d1 && (state.d1.byName.get(v) || state.d1.bySlug.get(v)) || null;
  }
  function isFav(nameOrSlug) {
    const t = teamByNameOrSlug(nameOrSlug);
    return !!(t && state.favs.has(t.slug));
  }
  function toggleFav(slug) {
    if (!slug) return;
    if (state.favs.has(slug)) state.favs.delete(slug); else state.favs.add(slug);
    if (state.filter === 'favorites' && !state.favs.size) state.filter = 'all';
    saveFavs();
    renderFavPicker();
    render();
    if (!state.team) renderFilters();
  }
  function meetNames(meet) {
    const names = new Set([...(meet.d1_teams || []), ...(meet.home || []), ...(meet.away || [])]);
    const d = state.details[meetKey(meet)];
    if (d && d.teams) d.teams.forEach(t => t.name && names.add(t.name));
    return [...names];
  }
  function meetHasFav(meet) { return meetNames(meet).some(n => isFav(n)); }
  function meetConfGroups(meet) {
    const groups = new Set();
    for (const n of meetNames(meet)) {
      const t = teamByNameOrSlug(n);
      if (t && t.conference) groups.add(confGroup(t.conference));
    }
    return groups;
  }
  function top25Names() {
    const season = statsSeason();
    const block = state.rankings && state.rankings.seasons && state.rankings.seasons[season];
    const rank = pickRankings(block, season);
    return new Set((rank.teams || []).filter(t => (t.rank || 99) <= 25).map(t => t.name));
  }
  function meetHasTop25(meet) {
    const top = top25Names();
    return meetNames(meet).some(n => top.has(n));
  }
  function tvLabelFrom(text, url) {
    const raw = String(text || '').trim();
    const lower = raw.toLowerCase();
    const fromUrl = u => {
      if (!u) return '';
      try {
        const x = new URL(u);
        const s = `${x.hostname}${x.pathname}`.toLowerCase();
        if (/bigtenplus|btnplus|b1gplus/.test(s)) return 'Big Ten+';
        if (/youtube\.com|youtu\.be/.test(s)) return 'YouTube';
        if (/foxsports|fox\.com/.test(s)) return 'FOX';
        if (/plus\.espn/.test(s)) return 'ESPN+';
        if (/secnetwork/.test(s)) return 'SEC Network';
        if (/accnetwork|accnx/.test(s)) return 'ACC Network';
      } catch { /* ignore */ }
      return '';
    };
    if (raw && !/^https?:\/\//i.test(raw) && !/virti\.?us/.test(lower)) {
      const rules = [
        [/espn\s*\+/, 'ESPN+'], [/espn2/, 'ESPN2'], [/espn/, 'ESPN'],
        [/secn\+|sec\s*network\+|sec\s*plus/, 'SECN+'],
        [/secn|sec\s*network|^sec$/, 'SEC Network'],
        [/accnx|accn\+|acc\s*network\s*extra/, 'ACCNX'],
        [/accn|acc\s*network/, 'ACC Network'],
        [/b(?:ig)?\s*1?0?\s*ten\+|b1g\+|big\+|bigtenplus/, 'Big Ten+'],
        [/\bbtn\b|big\s*ten\s*network/, 'BTN'],
        [/^big$/, 'Big Ten+'],
        [/^b1g$/, 'Big Ten+'],
        [/fox/, 'FOX'],
        [/youtube|youtu\.be/, 'YouTube'],
      ];
      for (const [re, label] of rules) if (re.test(lower)) return label;
    }
    return fromUrl(raw.startsWith('http') ? raw : url);
  }
  function tvInfo(meet) {
    const label = tvLabelFrom(meet.video_desc, meet.video_link);
    if (label) return { label, href: meet.video_link || null };
    if (meet.video_link) return { label: 'Stream', href: meet.video_link };
    return null;
  }
  function tvBadgeHtml(meet) {
    const info = tvInfo(meet);
    if (!info) return '';
    const body = esc(info.label);
    return info.href
      ? `<a class="tv-badge" href="${esc(info.href)}" target="_blank" rel="noopener" title="${body}">${body}</a>`
      : `<span class="tv-badge">${body}</span>`;
  }
  function starBtn(name, compact) {
    const t = teamByNameOrSlug(name);
    if (!t) return '';
    const on = state.favs.has(t.slug);
    const label = on ? `Unstar ${t.name}` : `Star ${t.name}`;
    return `<span class="star-btn${on ? ' on' : ''}${compact ? ' compact' : ''}" role="button" tabindex="0" data-fav-toggle="${esc(t.slug)}" aria-pressed="${on}" aria-label="${esc(label)}" title="${esc(label)}">${on ? '★' : '☆'}</span>`;
  }
  function flashMeet(key) {
    if (!key) return;
    state.flashKey = key;
    clearTimeout(flashMeet._t);
    flashMeet._t = setTimeout(() => { if (state.flashKey === key) { state.flashKey = null; render(); } }, 2500);
  }
  // Wall-clock time in an IANA zone -> ISO UTC (two passes handle DST edges).
  const tzOffsetMs = (utcMs, tz) => {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
      .formatToParts(new Date(utcMs)).map(x => [x.type, x.value]));
    return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - utcMs;
  };
  const zonedToUtcIso = (ymd, hm, tz) => {
    try {
      const [y, mo, d] = ymd.split('-').map(Number); const [h, mi] = hm.split(':').map(Number);
      const guess = Date.UTC(y, mo - 1, d, h, mi || 0);
      let t = guess - tzOffsetMs(guess, tz); t = guess - tzOffsetMs(t, tz);
      return new Date(t).toISOString();
    } catch { return null; }
  };
  // ?now=YYYY-MM-DD is a preview clock (noon CT that day) so next-meet and status can be tested.
  const nowMs = () => {
    if (!NOW_OVERRIDE) return Date.now();
    const iso = zonedToUtcIso(NOW_OVERRIDE, '12:00', TZ);
    return iso ? Date.parse(iso) : Date.now();
  };

  async function getJson(url, opts = {}) {
    const res = await fetch(url, { cache: 'no-store', ...opts });
    if (!res.ok) throw new Error(`${res.status} ${url}`);
    return res.json();
  }

  // ---------- URL state ----------
  function readHashMeet() {
    const m = location.hash.match(/meet=([A-Za-z0-9_-]+)/);
    return m && m[1].length <= 40 ? m[1] : null;
  }
  const isVirtiusKey = k => VIRTIUS_KEY.test(k || '') && !/^(rtn|iq|adhoc)-/.test(k);
  function syncUrl() {
    const p = new URLSearchParams();
    if (demo) p.set('demo', '');
    if (NOW_OVERRIDE) p.set('now', NOW_OVERRIDE);
    if (SEASON_OVERRIDE && !(state.team && state.teamSeason && state.teamSeason !== defaultSeason())) p.set('season', String(SEASON_OVERRIDE));
    if (state.team) {
      p.set('team', state.team);
      if (state.teamSeason && state.teamSeason !== defaultSeason()) p.set('season', String(state.teamSeason));
      if (state.athlete) p.set('athlete', state.athlete);
      const qs = p.toString().replace(/^demo=&?/, 'demo&').replace(/demo=$/, 'demo');
      history.replaceState(null, '', `${location.pathname}?${qs}`);
      return;
    }
    const last = [...state.open].pop();
    const isDefaultHome = !demo && !NOW_OVERRIDE && !SEASON_OVERRIDE && !state.team && !last && state.date === todayChicago();
    if (state.date && !isDefaultHome) p.set('date', state.date);
    const qs = p.toString().replace(/^demo=&?/, 'demo&').replace(/demo=$/, 'demo');
    const url = `${location.pathname}${qs ? `?${qs}` : ''}${last ? `#meet=${last}` : ''}`;
    history.replaceState(null, '', url);
  }

  // ---------- schedule ----------
  async function loadMain() {
    if (state.main) return state.main;
    try { state.main = await getJson('data/schedule.json'); } catch (e) { state.main = null; }
    if (state.main) state.schedules[state.main.season] = state.main;
    return state.main;
  }
  async function scheduleFor(season) {
    if (season in state.schedules) return state.schedules[season];
    const urls = [
      `data/seasons/${season}.json`,
      `data/seasons/${season}-announced.json`,
      `data/announced-schedule.json`,
    ];
    for (const url of urls) {
      try {
        const j = await getJson(url);
        if (!j) continue;
        const meets = j.meets || j.events || [];
        const yr = j.season || j.requested_season || season;
        if (url.endsWith('announced-schedule.json') && yr !== season) {
          const relevant = meets.filter(m => m.date && seasonFor(m.date) === season);
          if (!relevant.length) continue;
          state.schedules[season] = { ...j, season, meets: relevant };
          return state.schedules[season];
        }
        state.schedules[season] = { ...j, meets, season: yr };
        return state.schedules[season];
      } catch { /* try the next path */ }
    }
    state.schedules[season] = null;
    return null;
  }

  // Deep link to a Virtius session that is not in any schedule: build a meet from the session itself.
  async function adhocMeet(key) {
    if (!isVirtiusKey(key)) return null;
    const j = await getJson(VIRTIUS_API(key));
    const m = j && j.meet;
    if (!m || !m.teams) return null;
    const date = isYmd(m.meet_date) ? m.meet_date : todayChicago();
    const names = m.teams.map(t => t.name).filter(Boolean);
    const meet = {
      id: `adhoc-${key}`, date, adhoc: true, start_utc: null,
      desc: m.name || names.join(' vs '), school: '',
      home: m.teams.filter(t => t.home_team).map(t => t.name),
      away: m.teams.filter(t => !t.home_team).map(t => t.name),
      d1_teams: [], virtius: key, stats_link: VIRTIUS_PAGE(key), video_link: null, video_desc: null, rtn_url: null, source_url: null,
    };
    (state.adhoc[date] ||= []).push(meet);
    state.details[key] = normalizeVirtius(j, meet);
    return meet;
  }

  // ---------- normalization ----------
  function normalizeVirtius(json, meet) {
    const m = json && json.meet;
    if (!m) return null;
    const colors = {};
    (m.event_results || []).forEach(er => (er.gymnasts || []).forEach(g => { if (g.tricode && g.team_color) colors[g.tricode] = g.team_color; }));
    let teams = (m.teams || []).filter(t => t.competing !== 0);
    if (!teams.length) teams = m.teams || [];
    const out = teams.map(t => {
      const rotations = (t.events || []).map(ev => {
        const key = EV_BY_NAME[String(ev.event_name).toUpperCase()] || String(ev.event_name).toLowerCase();
        const gymnasts = (ev.gymnasts || []).slice().sort((a, b) => (a.order || 99) - (b.order || 99)).map(g => {
          const score = num(g.final_score);
          return {
            order: g.order, name: g.full_name || `${g.first_name || ''} ${g.last_name || ''}`.trim(),
            score, counted: score !== null ? g.type === 1 : null, exhibition: (g.order || 0) >= 7,
          };
        });
        const lineup = gymnasts.filter(g => !g.exhibition);
        const score = num(ev.event_score);
        const complete = score !== null && lineup.length > 0 && lineup.every(g => g.score !== null);
        // Only trust Virtius' counted/dropped flag once the event is done.
        if (!complete) gymnasts.forEach(g => { g.counted = null; });
        // While an event is in progress and Virtius has no event score yet, show the running top-5 sum.
        const posted = lineup.map(g => g.score).filter(v => v !== null).sort((a, b) => b - a).slice(0, 5);
        const partial = score === null && posted.length ? posted.reduce((a, b) => a + b, 0) : null;
        return { rotation: ev.rotation, event: key, score, partial, complete, started: score !== null || gymnasts.some(g => g.score !== null), gymnasts };
      }).sort((a, b) => (a.rotation || 0) - (b.rotation || 0));
      const sum = rotations.reduce((s, r) => s + (r.score || r.partial || 0), 0);
      return {
        name: t.name, tricode: t.tricode, home: !!t.home_team, color: colors[t.tricode] || null,
        score: num(t.final_score) ?? (sum > 0 ? sum : null), place: t.place || null, rotations,
      };
    });
    const leaderboards = {};
    (m.event_results || []).forEach(er => {
      const key = EV_BY_NAME[String(er.event_name).toUpperCase()] || String(er.event_name).toLowerCase();
      leaderboards[key] = (er.gymnasts || []).map(g => ({ place: g.place, name: g.full_name, team: g.short_name || g.team_name, tricode: g.tricode, score: num(g.final_score) }))
        .filter(g => g.score !== null);
    });
    const any = out.some(t => t.rotations.some(r => r.started));
    const all = out.length > 0 && out.every(t => EVENTS.every(e => t.rotations.some(r => r.event === e.key && r.complete)));
    const status = inferStatus(any, all, meet);
    const curRot = Math.max(0, ...out.flatMap(t => t.rotations.filter(r => r.started).map(r => r.rotation || 0)));
    const date = (meet && meet.date) || (isYmd(m.meet_date) ? m.meet_date : '') || '';
    return { source: 'virtius', name: m.name, location: m.location, date, status, teams: rankTeams(out, status), leaderboards, rotation: curRot || null, single: out.length === 1 };
  }

  function normalizeRtn(r, meet) {
    if (!r || !r.teams) return null;
    const teams = r.teams.map(t => ({
      name: t.name, home: t.home, color: null, score: num(t.final_score), place: t.place,
      rotations: t.events.map(ev => ({
        rotation: null, event: ev.event, score: num(ev.score), complete: num(ev.score) !== null, started: num(ev.score) !== null,
        // RTN rows are not in lineup order, so no order numbers here.
        gymnasts: ev.gymnasts.map(g => ({ order: null, name: g.name, score: num(g.score), counted: null, exhibition: false })),
      })),
    }));
    const lb = {};
    Object.entries(r.leaderboards || {}).forEach(([k, list]) => { lb[k] = list.map(g => ({ ...g, score: num(g.score) })).filter(g => g.score !== null); });
    const any = teams.some(t => t.score !== null || t.rotations.some(x => x.started));
    let status;
    if (r.live) status = 'LIVE';
    else status = inferStatus(any, any && teams.every(t => t.rotations.every(x => x.complete)), meet);
    const date = (meet && meet.date) || '';
    return { source: 'rtn', name: null, location: null, date, status, teams: rankTeams(teams, status), leaderboards: lb, rotation: null, updated: r.generated_at };
  }

  function inferStatus(any, allDone, meet) {
    const start = meet && meet.start_utc ? Date.parse(meet.start_utc) : null;
    // A clock override (or a mis-set start time) should not treat a meet as final before it begins.
    if (start && nowMs() < start) return 'UPCOMING';
    if (!any) return 'UPCOMING';
    if (allDone) return 'FINAL';
    if (meet && meet.date < todayChicago()) return 'FINAL';
    if (start && nowMs() - start > 6 * 3600e3) return 'FINAL';
    return 'LIVE';
  }

  function rankTeams(teams, status) {
    const scored = teams.filter(t => t.score !== null).sort((a, b) => b.score - a.score);
    // Places come from the current scores (ties share a place), so they are right mid-meet too.
    teams.forEach(t => { t.place = t.score !== null ? 1 + scored.filter(o => o.score - t.score > 1e-6).length : null; });
    if (status === 'UPCOMING') return teams.slice().sort((a, b) => (a.home - b.home));
    return teams.slice().sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
  }

  // ---------- fetching details ----------
  async function loadDetail(meet) {
    const key = meetKey(meet);
    try {
      if (meet.virtius) {
        const j = await getJson(VIRTIUS_API(meet.virtius));
        const d = normalizeVirtius(j, meet);
        if (d) state.details[key] = d;
      } else {
        const r = await getJson(`data/results/${meet.id}.json?t=${Date.now()}`);
        const d = normalizeRtn(r, meet);
        if (d) state.details[key] = d;
      }
    } catch (e) {
      if (!state.details[key]) state.details[key] = { error: true };
    }
    return state.details[key];
  }

  async function pool(items, n, fn) {
    const q = items.slice(); const workers = [];
    for (let i = 0; i < Math.min(n, q.length); i++) workers.push((async () => { while (q.length) await fn(q.shift()); })());
    await Promise.all(workers);
  }

  // ---------- status helpers ----------
  function statusOf(meet) {
    const d = state.details[meetKey(meet)];
    if (d && d.status) return d.status;
    const start = meet.start_utc ? Date.parse(meet.start_utc) : null;
    if (meet.date < todayChicago() || (start && nowMs() - start > 6 * 3600e3)) return 'PAST';
    return 'UPCOMING';
  }
  function shouldPoll(meet) {
    const s = statusOf(meet);
    if (s === 'LIVE') return true;
    if (s !== 'UPCOMING') return false;
    const start = meet.start_utc ? Date.parse(meet.start_utc) : null;
    // Deep-linked sessions often have no start time: watch them all day.
    if (!start && meet.virtius && meet.adhoc) return meet.date === todayChicago();
    // A meet becomes LIVE once its first score posts, so keep checking from 15 min before start.
    return !!start && nowMs() >= start - 15 * 60e3 && nowMs() <= start + 6 * 3600e3;
  }

  // ---------- rendering ----------
  function badge(status, rotation) {
    const map = { LIVE: 'live', FINAL: 'final', UPCOMING: 'upcoming', PAST: 'past' };
    const label = status === 'PAST' ? 'NO LIVE DATA' : status;
    const rot = status === 'LIVE' && rotation ? `<span class="rot">Rot ${rotation}</span>` : '';
    return `<span class="badge ${map[status] || ''}">${status === 'LIVE' ? '<i class="dot"></i>' : ''}${label}${rot}</span>`;
  }

  function meetTitle(meet) {
    if (meet.desc) return meet.desc;
    if (meet.home.length && meet.away.length) return `${meet.away.join(', ')} at ${meet.home.join(', ')}`;
    return [...meet.home, ...meet.away].join(', ');
  }

  function teamRows(meet, d) {
    let rows;
    if (d && d.teams && d.teams.length) {
      rows = d.teams.map(t => ({ name: t.name, home: t.home, score: t.score, place: d.status === 'UPCOMING' || d.single ? null : t.place, color: t.color }));
    } else {
      rows = [...meet.away.map(n => ({ name: n, home: false })), ...meet.home.map(n => ({ name: n, home: true }))];
    }
    return rows.map(r => `
      <li class="team-row${isFav(r.name) ? ' is-fav' : ''}">
        <span class="place">${r.place ? r.place : ''}</span>
        <span class="swatch" style="${r.color ? `background:${esc(r.color)}` : ''}"></span>
        <span class="tname">${starBtn(r.name, true)}${teamLink(r.name)}${r.home ? ' <em class="home">home</em>' : ''}</span>
        <span class="tscore">${r.score !== undefined && r.score !== null ? fmtScore(r.score) : ''}</span>
      </li>`).join('');
  }

  function rotationTable(d) {
    const maxRot = Math.max(0, ...d.teams.flatMap(t => t.rotations.map(r => r.rotation || 0)));
    if (!maxRot) {
      // RTN fallback has no rotation order: show by event.
      return `<div class="table-scroll"><table class="rot-table"><thead><tr><th>Team</th>${EVENTS.map(e => `<th>${e.abbr}</th>`).join('')}<th>Total</th></tr></thead><tbody>
        ${d.teams.map(t => `<tr><th scope="row">${esc(t.name)}</th>${EVENTS.map(e => { const r = t.rotations.find(x => x.event === e.key); return `<td>${r && r.score ? fmtScore(r.score) : '—'}</td>`; }).join('')}<td class="tot">${fmtScore(t.score)}</td></tr>`).join('')}
      </tbody></table></div>`;
    }
    const cols = Array.from({ length: maxRot }, (_, i) => i + 1);
    return `<div class="table-scroll"><table class="rot-table"><thead><tr><th>Team</th>${cols.map(c => `<th>R${c}</th>`).join('')}<th>Total</th></tr></thead><tbody>
      ${d.teams.map(t => `<tr><th scope="row"><span class="swatch" style="${t.color ? `background:${esc(t.color)}` : ''}"></span>${esc(t.tricode || t.name)}</th>${cols.map(c => {
        // Usually one event per rotation; some sessions run two events in one rotation.
        const rs = t.rotations.filter(x => x.rotation === c);
        if (!rs.length) return '<td class="bye">bye</td>';
        return `<td class="${d.status !== 'FINAL' && rs.some(r => r.started && !r.complete) ? 'inprog' : ''}">${rs.map(r => {
          const ev = EVENTS.find(e => e.key === r.event);
          return `<span class="ev">${esc(ev ? ev.abbr : r.event)}</span><span class="sc">${r.score ? fmtScore(r.score) : (r.partial ? `<i title="running">${fmtScore(r.partial)}</i>` : '—')}</span>`;
        }).join('')}</td>`;
      }).join('')}<td class="tot">${fmtScore(t.score)}</td></tr>`).join('')}
    </tbody></table></div>`;
  }

  function eventPanel(d, evKey) {
    if (evKey === 'aa') return leaderboard(d.leaderboards.aa, 'All-around', 2, d.single) || '<p class="muted">No all-around scores yet.</p>';
    const ev = EVENTS.find(e => e.key === evKey);
    const blocks = d.teams.map(t => {
      const r = t.rotations.find(x => x.event === evKey);
      if (!r) return '';
      const rows = r.gymnasts.map(g => `
        <li class="${g.counted === false ? 'dropped' : ''} ${g.exhibition ? 'exh' : ''}">
          <span class="ord">${g.order ?? ''}</span>
          <span class="gname">${esc(g.name)}${g.exhibition ? ' <em>EX</em>' : ''}</span>
          <span class="gscore">${fmtScore(g.score)}</span>
        </li>`).join('');
      return `<div class="lineup">
        <div class="lineup-head"><span class="swatch" style="${t.color ? `background:${esc(t.color)}` : ''}"></span><strong>${esc(t.name)}</strong>
          <span class="muted">${r.rotation ? `Rotation ${r.rotation}` : ''}</span><span class="lscore">${r.score ? fmtScore(r.score) : (r.partial ? `<i title="running">${fmtScore(r.partial)}</i>` : '—')}</span></div>
        <ol class="glist">${rows || '<li class="muted">Lineup not posted</li>'}</ol>
      </div>`;
    }).join('');
    return `<div class="lineups">${blocks || '<p class="muted">No lineups yet.</p>'}</div>${leaderboard(d.leaderboards[evKey], `${ev.label} leaders`, 1, d.single) || ''}`;
  }

  function leaderboard(list, title, minScoreForAA, hideTeam) {
    if (!list || !list.length) return '';
    const top = list.slice(0, 10);
    return `<div class="leaders"><h4>${esc(title)}</h4><ol class="lb">${top.map(g => `
      <li><span class="ord">${g.place ?? ''}</span><span class="gname">${esc(g.name)} <span class="muted">${hideTeam ? '' : esc(g.team || '')}</span></span><span class="gscore">${fmtScore(g.score)}</span></li>`).join('')}</ol></div>`;
  }

  function detailHtml(meet) {
    const key = meetKey(meet);
    const d = state.details[key];
    const links = [
      meet.virtius ? `<a href="${esc(VIRTIUS_PAGE(meet.virtius))}" target="_blank" rel="noopener">Virtius live stats</a>` : (meet.stats_link ? `<a href="${esc(meet.stats_link)}" target="_blank" rel="noopener">Live stats</a>` : ''),
      meet.video_link ? `<a href="${esc(meet.video_link)}" target="_blank" rel="noopener">Watch${meet.video_desc ? ` (${esc(meet.video_desc)})` : ''}</a>` : '',
      meet.rtn_url ? `<a href="${esc(meet.rtn_url)}" target="_blank" rel="noopener">Road to Nationals</a>` : '',
      meet.source_url && !/virti\.us/.test(meet.source_url) ? `<a href="${esc(meet.source_url)}" target="_blank" rel="noopener">Event info</a>` : '',
    ].filter(Boolean).join(' · ');
    if (!d || d.error || !d.teams || !d.teams.length || d.status === 'UPCOMING' && !d.teams.some(t => t.rotations.some(r => r.gymnasts.length))) {
      const msg = d && d.error ? 'Scores unavailable right now.' : (meet.virtius ? 'Scores will appear here once the meet starts.' :
        (statusOf(meet) === 'PAST' ? 'This meet was not scored on Virtius; see the links for results.' : 'This meet is not on Virtius; results refresh from Road to Nationals about every 10 minutes once it starts.'));
      return `<div class="detail"><p class="muted">${msg}</p><p class="links">${links}</p></div>`;
    }
    const tab = state.tab[key] || defaultTab(d);
    const tabs = [...EVENTS, { key: 'aa', abbr: 'AA', label: 'All-around' }];
    return `<div class="detail">
      ${d.location ? `<p class="muted loc">${esc(d.location)}</p>` : ''}
      <h3>${d.teams.some(t => t.rotations.some(r => r.rotation)) ? 'Rotations' : 'Event totals'}</h3>
      ${rotationTable(d)}
      <div class="tabs" role="tablist">${tabs.map(t => `<button role="tab" class="tab ${t.key === tab ? 'on' : ''}" data-tab="${t.key}" data-meet="${esc(key)}" aria-selected="${t.key === tab}">${t.abbr}<span class="tl"> ${t.label}</span></button>`).join('')}</div>
      <div class="tabpanel">${eventPanel(d, tab)}</div>
      <p class="legend muted">${d.source === 'virtius' ? 'Struck-through scores were dropped (top five count). EX = exhibition.' : ''} ${d.source === 'rtn' ? `Fallback data from Road to Nationals${d.updated ? `, updated ${new Date(d.updated).toLocaleTimeString('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' })} CT` : ''}.` : ''}</p>
      <p class="links">${links}</p>
    </div>`;
  }

  function defaultTab(d) {
    if (d.status === 'LIVE') {
      // the event the leading team is currently on
      const t = d.teams[0];
      const cur = t && t.rotations.filter(r => r.started).pop();
      if (cur && EVENTS.some(e => e.key === cur.event)) return cur.event;
    }
    return 'vault';
  }

  function cardHtml(meet) {
    const key = meetKey(meet);
    const d = state.details[key];
    const status = statusOf(meet);
    const open = state.open.has(key);
    prec = precisionOf(d);
    const fav = meetHasFav(meet);
    return `<article class="card ${status.toLowerCase()} ${open ? 'open' : ''}${fav ? ' is-fav' : ''}${state.flashKey === key ? ' flash' : ''}" id="meet-${esc(key)}" data-key="${esc(key)}">
      <button class="card-head" aria-expanded="${open}" data-toggle="${esc(key)}">
        <div class="meta">
          <span class="time">${esc(formatMeetTime(meet.start_utc))}</span>
          ${badge(status, d && d.rotation)}
          ${tvBadgeHtml(meet)}
          ${fav ? '<span class="fav-flag" title="Favorite team in this meet">★ Favorite</span>' : ''}
        </div>
        <h2 class="mtitle">${esc(d && d.name && meet.desc ? meet.desc : meetTitle(meet))}</h2>
        <ul class="teams">${teamRows(meet, d)}</ul>
        <span class="chev" aria-hidden="true">${open ? '▴' : '▾'} ${open ? 'Hide' : 'Rotations & athletes'}</span>
      </button>
      ${open ? detailHtml(meet) : ''}
      <button type="button" class="share" data-share="${esc(key)}" title="Share this meet" aria-label="Share this meet">Share</button>
    </article>`;
  }

  function render() {
    if (state.date) {
      el.dateText.textContent = matchMedia('(max-width: 430px)').matches ? shortDate(state.date) + ', ' + state.date.slice(0, 4) : longDate(state.date);
      el.date.value = state.date;
    }
    const t = todayChicago();
    el.today.hidden = !state.team && state.date === t && !demo;
    if (state.team) {
      if (el.pulse) el.pulse.hidden = true;
      if (el.hero) el.hero.hidden = true;
      renderTeamProfile();
      scheduleAthleteScroll();
      return;
    }
    if (el.pulse) el.pulse.hidden = false;
    if (el.hero) el.hero.hidden = false;
    renderSeasonPulse();
    if (!state.meets.length) {
      renderFilters();
      el.meets.innerHTML = emptyHtml();
      return;
    }
    const shown = visibleMeets();
    if (!shown.length) {
      renderFilters();
      el.status.innerHTML = statusLineHtml();
      el.meets.innerHTML = `<div class="empty"><h2>No meets match this filter</h2><p><button type="button" class="jump" data-filter="all">Show all meets</button></p></div>`;
      return;
    }
    el.meets.innerHTML = shown.map(cardHtml).join('');
    renderFilters();
    el.status.innerHTML = statusLineHtml();
    tickAgo();
  }
  function visibleMeets() {
    const order = { LIVE: 0, UPCOMING: 1, FINAL: 2, PAST: 3 };
    const f = state.filter || 'all';
    const rows = state.meets.filter(m => {
      if (f === 'all') return true;
      if (f === 'live') return statusOf(m) === 'LIVE';
      if (f === 'favorites') return meetHasFav(m);
      if (f === 'top25') return meetHasTop25(m);
      return meetConfGroups(m).has(f);
    });
    return rows.slice().sort((a, b) => {
      const fa = meetHasFav(a) ? 0 : 1, fb = meetHasFav(b) ? 0 : 1;
      return (fa - fb) || (order[statusOf(a)] - order[statusOf(b)]) || (a.start_utc || '').localeCompare(b.start_utc || '');
    });
  }
  function agoText(then) {
    if (!then) return '';
    const s = Math.max(0, Math.floor((Date.now() - then.getTime()) / 1000));
    if (s < 2) return 'Updated just now';
    if (s < 60) return `Updated ${s}s ago`;
    const m = Math.floor(s / 60);
    if (m < 60) return `Updated ${m}m ago`;
    return `Updated ${Math.floor(m / 60)}h ago`;
  }
  function statusLineHtml() {
    const live = state.meets.filter(m => statusOf(m) === 'LIVE').length;
    const n = state.meets.length;
    const shown = (state.filter && state.filter !== 'all') ? visibleMeets().length : n;
    const count = shown === n ? `${n} D1 meet${n === 1 ? '' : 's'}` : `${shown} of ${n} D1 meets`;
    const liveBit = live ? ` · <strong class="livecount">${live} live</strong>` : '';
    const pollBit = state.polling && state.lastUpdate
      ? ` · <span class="live-ago" id="live-ago">${esc(agoText(state.lastUpdate))}</span>`
      : (state.lastUpdate && !state.polling ? '' : '');
    return `${count}${liveBit}${pollBit}`;
  }
  function tickAgo() {
    const node = document.getElementById('live-ago');
    if (node && state.lastUpdate) node.textContent = agoText(state.lastUpdate);
  }
  function renderFilters() {
    const box = el.filters;
    if (!box) return;
    if (state.team || !state.meets.length) { box.hidden = true; box.innerHTML = ''; return; }
    const live = state.meets.filter(m => statusOf(m) === 'LIVE').length;
    const pills = [
      { id: 'all', label: 'All' },
      { id: 'live', label: 'Live now', count: live, show: true, live: true },
      { id: 'favorites', label: 'Favorites', show: state.favs.size > 0 },
      { id: 'top25', label: 'Top 25' },
      { id: 'SEC', label: 'SEC' },
      { id: 'Big Ten', label: 'Big Ten' },
      { id: 'Big 12', label: 'Big 12' },
      { id: 'ACC', label: 'ACC' },
      { id: 'Other', label: 'Other' },
    ];
    const html = pills.filter(p => p.show !== false).map(p => {
      const on = (state.filter || 'all') === p.id;
      const count = p.id === 'live' && p.count ? `<span class="pill-count">${p.count}</span>` : '';
      return `<button type="button" class="pill${on ? ' on' : ''}${p.live && p.count ? ' has-live' : ''}" data-filter="${esc(p.id)}" role="tab" aria-selected="${on}">${esc(p.label)}${count}</button>`;
    }).join('');
    box.hidden = false;
    box.innerHTML = html;
  }

  function emptyHtml() {
    el.status.textContent = '';
    const sched = state.currentSchedule;
    const main = state.main;
    const dateLink = (ymd, label) => `<a class="jump" href="${dateHref(ymd)}" data-date="${ymd}">${esc(label || shortDate(ymd))}</a>`;
    let html = `<div class="empty"><h2>No D1 meets on ${esc(shortDate(state.date))}</h2>`;
    const src = sched || main;
    const dates = [...new Set([...(src ? src.meets : []), ...Object.values(state.adhoc).flat()].map(m => m.date))].sort();
    const next = dates.find(d => d > state.date);
    const prev = [...dates].reverse().find(d => d < state.date);
    if (next) html += `<p>Next meet day: ${dateLink(next, longDate(next))}</p>`;
    if (!next) {
      const season = seasonFor(state.date);
      if (main && main.season_published === false && main.requested_season >= season) {
        html += `<p>Road to Nationals hasn't published the ${main.requested_season} schedule yet. The season usually starts in early January — check back soon.</p>`;
      } else if (!sched) {
        html += `<p>No schedule data for the ${season} season.</p>`;
      }
      html += `<p>Preview the scoreboard with real data: <a class="jump" href="?demo">2026 NCAA Championship final</a> · <a class="jump" href="?demo&date=${DEMO.regular}">a 2026 regular-season Friday</a></p>`;
    }
    if (prev) html += `<p class="muted">Previous meet day: ${dateLink(prev, longDate(prev))}</p>`;
    return html + '</div>';
  }

  function dateHref(ymd) { return `?${demo ? 'demo&' : ''}${NOW_OVERRIDE ? `now=${NOW_OVERRIDE}&` : ''}${SEASON_OVERRIDE ? `season=${SEASON_OVERRIDE}&` : ''}date=${ymd}`; }

  // ---------- teams ----------
  const teamSlug = name => String(name || '').toLowerCase().replace(/&/g, 'and').replace(/s\.e\./g, 'se').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  function defaultSeason() {
    const main = state.main;
    const natural = seasonFor(todayChicago()); // Jul–Dec → next spring year (Nov 2026 → 2027)
    if (main && main.season_published && main.season) return main.season;
    return natural;
  }
  async function loadTeams() {
    if (state.d1) return state.d1;
    const [raw, meta] = await Promise.all([
      getJson('data/d1-teams.json').catch(() => null),
      getJson('data/team-meta.json').catch(() => null),
    ]);
    const metaByName = new Map(((meta && meta.teams) || []).map(t => [t.name, t]));
    const list = ((raw && raw.teams) || []).map(t => {
      const m = metaByName.get(t.name) || {};
      return {
        tid: t.tid, name: t.name, conference: t.conference || m.conference || '',
        slug: m.slug || teamSlug(t.name), abbr: m.abbr || t.name.slice(0, 4).toUpperCase(),
        color: m.color || '#3a6df0', color2: m.color2 || '#ffffff',
      };
    });
    state.d1 = {
      teams: list,
      bySlug: new Map(list.map(t => [t.slug, t])),
      byName: new Map(list.map(t => [t.name, t])),
    };
    return state.d1;
  }
  function teamHref(slug, season, athlete) {
    const p = [];
    if (demo) p.push('demo');
    if (NOW_OVERRIDE) p.push(`now=${NOW_OVERRIDE}`);
    p.push(`team=${encodeURIComponent(slug)}`);
    if (season && season !== defaultSeason()) p.push(`season=${season}`);
    else if (SEASON_OVERRIDE && SEASON_OVERRIDE !== defaultSeason()) p.push(`season=${SEASON_OVERRIDE}`);
    if (athlete) p.push(`athlete=${encodeURIComponent(athlete)}`);
    return `?${p.join('&')}`;
  }
  function teamLink(name, season) {
    const t = state.d1 && state.d1.byName.get(name);
    if (!t) return esc(name);
    const yr = season || SEASON_OVERRIDE || undefined;
    return `<a class="team-link" href="${esc(teamHref(t.slug, yr))}" data-team="${esc(t.slug)}"${yr ? ` data-team-season="${yr}"` : ''}>${esc(name)}</a>`;
  }
  function teamInMeet(m, name) {
    return (m.d1_teams || []).includes(name) || (m.home || []).includes(name) || (m.away || []).includes(name);
  }
  function meetHa(m, name) {
    if ((m.home || []).includes(name)) return 'Home';
    if ((m.away || []).includes(name) && (m.home || []).length) return 'Away';
    return 'Neutral';
  }
  function meetOpponents(m, name) {
    return [...(m.home || []), ...(m.away || [])].filter(t => t !== name);
  }
  function meetHref(m) {
    const key = meetKey(m);
    return `${dateHref(m.date)}${m.virtius || m.id ? `#meet=${encodeURIComponent(key)}` : ''}`;
  }
  function teamScoreRow(meet, name) {
    const d = state.details[meetKey(meet)];
    if (!d || !d.teams || !d.teams.length) return null;
    const mine = d.teams.find(t => t.name === name);
    if (!mine || mine.score == null) return { location: d.location, status: d.status };
    const others = d.teams.filter(t => t.name !== name && t.score != null).sort((a, b) => (a.place || 99) - (b.place || 99));
    const placed = d.teams.filter(t => t.score != null).length;
    const win = mine.place === 1;
    return { score: mine.score, place: mine.place, field: placed, win, others, location: d.location, status: d.status };
  }

  async function openTeam(slug, season, athlete) {
    closePollModal();
    closeFavPicker();
    const teamSearch = document.getElementById('team-search');
    const teamList = document.getElementById('team-list');
    if (teamList) teamList.hidden = true;
    if (teamSearch) {
      teamSearch.value = '';
      teamSearch.setAttribute('aria-expanded', 'false');
    }
    await Promise.all([loadMain(), loadTeams()]);
    const team = state.d1.bySlug.get(slug);
    if (!team) {
      el.status.textContent = 'That team was not found.';
      return;
    }
    const wantAthlete = athlete ? String(athlete).toLowerCase() : null;
    let yr = season || defaultSeason();
    if (wantAthlete) yr = await resolveAthleteSeason(team.slug, wantAthlete, yr);
    state.team = team.slug;
    state.teamSeason = yr;
    state.athlete = wantAthlete;
    state.athletePendingScroll = !!wantAthlete;
    state.rosterSort = { key: 'name', dir: 1 };
    state.coachesShowAll = false;
    if (!state.date) state.date = todayChicago();
    clearTimeout(state.timer);
    document.title = wantAthlete
      ? `${(findAthleteInRoster(team.slug, wantAthlete, yr) || {}).name || wantAthlete} · ${team.name} — The Five That Score`
      : `${team.name} — The Five That Score`;
    ++state.renderToken;
    const token = state.renderToken;
    const [lists] = await Promise.all([teamMeetLists(team.name, yr), loadCoaches(), loadRoster(yr)]);
    if (token !== state.renderToken) return;
    state.teamLists = lists;
    syncUrl();
    render();
    renderNextMeet();
    scheduleAthleteScroll();
    const { upcoming, past } = state.teamLists;
    await pool([...past, ...upcoming.slice(0, 6)], 4, loadDetail);
    if (token !== state.renderToken || state.team !== team.slug) return;
    render();
    scheduleAthleteScroll();
    setTimeout(() => { if (token === state.renderToken) state.athletePendingScroll = false; }, 500);
  }
  function closeTeam() {
    state.team = null;
    state.teamSeason = null;
    state.athlete = null;
    state.athletePendingScroll = false;
    document.title = 'The Five That Score — Live D1 Scoreboard';
  }

  async function teamMeetLists(name, yr) {
    const natural = defaultSeason();
    const today = todayChicago();
    const thisSched = await scheduleFor(yr);
    const lastYear = yr - 1;
    const lastSched = await scheduleFor(lastYear);
    const from = sched => ((sched && sched.meets) || []).filter(m => teamInMeet(m, name))
      .sort((a, b) => (a.date + (a.start_utc || '')).localeCompare(b.date + (b.start_utc || '')) || a.id - b.id);
    const current = from(thisSched);
    const stillUp = m => {
      if (m.date > today) return true;
      if (m.date < today) return false;
      const st = statusOf(m);
      if (st === 'FINAL' || st === 'PAST') return false;
      return true;
    };
    let upcoming = current.filter(stillUp);
    let past = current.filter(m => !stillUp(m));
    let upcomingYear = yr, pastYear = yr, upcomingSoon = false;
    // Default preseason view (e.g. Nov 2026 looking at 2027): if this season has no past
    // meets yet, show last season's results. If the new season file is missing, say so.
    if (!thisSched && yr === natural) {
      upcoming = [];
      upcomingSoon = true;
      past = from(lastSched);
      pastYear = lastYear;
    } else if (thisSched && !past.length && lastSched && yr === natural) {
      past = from(lastSched);
      pastYear = lastYear;
    } else if (!thisSched) {
      upcomingSoon = true;
    }
    return { upcoming, past, upcomingYear, pastYear, upcomingSoon, hasThis: !!thisSched, hasLast: !!lastSched };
  }


  function normAthleteName(s) {
    return String(s || '').normalize('NFKD').replace(/\p{M}+/gu, '').toLowerCase().replace(/[’']/g, "'").replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  }
  async function loadCoaches() {
    if (state.coachesData) return state.coachesData;
    try { state.coachesData = await getJson('data/coaches.json'); }
    catch { state.coachesData = { teams: {} }; }
    return state.coachesData;
  }
  async function loadRoster(season) {
    if (state.rosters[season]) return state.rosters[season];
    try { state.rosters[season] = await getJson(`data/rosters/${season}.json`); }
    catch { state.rosters[season] = { season, teams: {} }; }
    return state.rosters[season];
  }
  function liveHighsForTeam(teamName, season) {
    const evMap = { vault: 'vt', bars: 'ub', beam: 'bb', floor: 'fx', VAULT: 'vt', BARS: 'ub', BEAM: 'bb', FLOOR: 'fx' };
    const highs = new Map();
    const bump = (name, ev, score) => {
      if (!name || score == null || !Number.isFinite(score) || score < 0.1) return;
      const key = normAthleteName(name);
      const rec = highs.get(key) || { vt: null, ub: null, bb: null, fx: null, aa: null, events: {} };
      rec[ev] = rec[ev] == null ? score : Math.max(rec[ev], score);
      rec.events[ev] = rec[ev];
      if (['vt', 'ub', 'bb', 'fx'].every(e => rec[e] != null)) {
        rec.aa = Number((rec.vt + rec.ub + rec.bb + rec.fx).toFixed(4));
      }
      highs.set(key, rec);
    };
    for (const d of Object.values(state.details || {})) {
      if (!d || d.error || !d.teams) continue;
      const date = d.date || d.meet_date || '';
      // Undated details must not leak another season's scores onto the current roster.
      if (!date || !isYmd(date) || seasonFor(date) !== season) continue;
      const team = d.teams.find(tm => tm.name === teamName);
      if (!team) continue;
      const aaParts = new Map();
      for (const rot of team.rotations || []) {
        const ev = evMap[rot.event];
        if (!ev) continue;
        for (const g of rot.gymnasts || []) {
          if (g.exhibition) continue;
          const name = g.name || g.full_name || '';
          const score = num(g.score);
          bump(name, ev, score);
          if (name && score != null) {
            const rec = aaParts.get(normAthleteName(name)) || {};
            rec[ev] = rec[ev] == null ? score : Math.max(rec[ev], score);
            aaParts.set(normAthleteName(name), rec);
          }
        }
      }
    }
    return highs;
  }
  function applyLiveHighs(athletes, teamName, season) {
    const highs = liveHighsForTeam(teamName, season);
    if (!highs.size) return athletes;
    return athletes.map(a => {
      const rec = highs.get(normAthleteName(a.name));
      if (!rec) return a;
      const out = { ...a };
      for (const ev of ['vt', 'ub', 'bb', 'fx', 'aa']) {
        if (rec[ev] == null) continue;
        if (out[ev] == null || rec[ev] > out[ev] + 1e-9) out[ev] = rec[ev];
      }
      return out;
    });
  }
  function fmtEventScore(n) {
    if (n == null || n === '') return '<span class="na">n/a</span>';
    const s = Number(n).toFixed(3);
    if (Math.abs(Number(n) - 10) < 0.00005) return `<span class="is-ten">${s}</span>`;
    return s;
  }
  function coachesCardHtml(team) {
    const rec = state.coachesData && state.coachesData.teams && state.coachesData.teams[team.slug];
    const official = rec && rec.sourceUrl
      ? `<a class="staff-src" href="${esc(rec.sourceUrl)}" target="_blank" rel="noopener">Official staff page</a>`
      : '';
    if (!rec || !(rec.coaches || []).length) {
      return `<section class="profile-section staff-card">
        <div class="staff-head"><h3>Coaching Staff</h3>${official}</div>
        <p class="muted">Coaching staff details are not available yet.</p>
      </section>`;
    }
    const all = rec.coaches;
    const shown = state.coachesShowAll || all.length <= 3 ? all : all.slice(0, 3);
    const rows = shown.map(c => {
      const head = c.role === 'head' || /^(interim\s+)?head coach\b/i.test(c.title || '') && !/associate|assistant|volunteer|student|graduate/i.test(c.title || '');
      return `<article class="coach${head ? ' is-head' : ''}">
        <header class="coach-id">
          <h4>${esc(c.name)}</h4>
          <p class="coach-title">${esc(c.title)}</p>
        </header>
        ${c.bio ? `<p class="coach-bio">${esc(c.bio)}</p>` : ''}
      </article>`;
    }).join('');
    const more = all.length > 3
      ? `<button type="button" class="staff-toggle" data-coaches-more>${state.coachesShowAll ? 'Show fewer coaches' : `Show all ${all.length} coaches`}</button>`
      : '';
    return `<section class="profile-section staff-card">
      <div class="staff-head"><h3>Coaching Staff</h3>${official}</div>
      <div class="staff-list">${rows}</div>
      ${more}
    </section>`;
  }
  function rosterCardHtml(team, season) {
    const file = state.rosters[season];
    const rec = file && file.teams && file.teams[team.slug];
    if (!rec || !(rec.athletes || []).length) {
      return `<section class="profile-section roster-card">
        <div class="staff-head"><h3>Roster &amp; Season Highs</h3></div>
        <p class="muted">A ${esc(String(season))} roster is not available yet.</p>
      </section>`;
    }
    const athletes = applyLiveHighs(rec.athletes, team.name, season);
    const sort = state.rosterSort || { key: 'name', dir: 1 };
    const yearRank = { 'Fr.': 1, 'So.': 2, 'Jr.': 3, 'Sr.': 4, 'Gr.': 5 };
    const sorted = athletes.slice().sort((a, b) => {
      const key = sort.key, dir = sort.dir;
      let av, bv, cmp;
      if (key === 'name') cmp = (a.name || '').localeCompare(b.name || '');
      else if (key === 'year') cmp = (yearRank[a.year] || 99) - (yearRank[b.year] || 99) || (a.year || '').localeCompare(b.year || '');
      else {
        av = a[key]; bv = b[key];
        if (av == null && bv == null) cmp = 0;
        else if (av == null) cmp = 1;
        else if (bv == null) cmp = -1;
        else cmp = av - bv;
      }
      if (!cmp && key !== 'name') cmp = (a.name || '').localeCompare(b.name || '');
      return cmp * dir;
    });
    const cols = [
      { key: 'name', label: 'Athlete', cls: 'ath' },
      { key: 'year', label: 'Yr', cls: 'yr' },
      { key: 'vt', label: 'VT', cls: 'num' },
      { key: 'ub', label: 'UB', cls: 'num' },
      { key: 'bb', label: 'BB', cls: 'num' },
      { key: 'fx', label: 'FX', cls: 'num' },
      { key: 'aa', label: 'AA', cls: 'num' },
    ];
    const th = cols.map(c => {
      const on = sort.key === c.key;
      const arrow = on ? (sort.dir === 1 ? ' ▲' : ' ▼') : '';
      return `<th class="${c.cls}"><button type="button" class="roster-sort${on ? ' is-on' : ''}" data-roster-sort="${c.key}" aria-pressed="${on ? 'true' : 'false'}">${c.label}${arrow}</button></th>`;
    }).join('');
    const body = sorted.map(a => {
      const slug = athleteSlug(a.name);
      const focus = state.athlete && slug === state.athlete;
      return `<tr id="athlete-${esc(slug)}" data-athlete="${esc(slug)}" class="${focus ? 'is-focus-athlete' : ''}">
      <th scope="row" class="ath">${athleteStarBtn(team.slug, slug, a.name, { cls: 'ath-star fav-star', athleteId: a.id }) }<span class="ath-name">${esc(a.name)}</span></th>
      <td class="yr">${a.year ? esc(a.year) : '<span class="na">n/a</span>'}</td>
      <td class="num">${fmtEventScore(a.vt)}</td>
      <td class="num">${fmtEventScore(a.ub)}</td>
      <td class="num">${fmtEventScore(a.bb)}</td>
      <td class="num">${fmtEventScore(a.fx)}</td>
      <td class="num">${fmtEventScore(a.aa)}</td>
    </tr>`;
    }).join('');
    const src = rec.sourceUrl ? `<a class="staff-src" href="${esc(rec.sourceUrl)}" target="_blank" rel="noopener">${/roadtonationals/i.test(rec.sourceUrl) ? 'Road to Nationals' : 'Official roster'}</a>` : '';
    const note = season >= defaultSeason()
      ? `<p class="roster-note muted">Season highs will fill in as official ${esc(String(season))} meet scores are posted. Events not yet competed show n/a.</p>`
      : `<p class="roster-note muted">Season highs are each gymnast’s best official ${esc(String(season))} score on that event. n/a means she did not compete it this season.</p>`;
    return `<section class="profile-section roster-card">
      <div class="staff-head"><h3>Roster &amp; Season Highs <span class="muted">· ${esc(String(season))}</span></h3>${src}</div>
      ${note}
      <div class="roster-wrap">
        <table class="roster-table">
          <thead><tr>${th}</tr></thead>
          <tbody>${body}</tbody>
        </table>
      </div>
    </section>`;
  }

  function renderTeamProfile() {
    if (el.filters) { el.filters.hidden = true; el.filters.innerHTML = ''; }
    const team = state.d1 && state.d1.bySlug.get(state.team);
    if (!team) { el.meets.innerHTML = `<div class="empty"><h2>Team not found</h2><p><a class="jump" href="${dateHref(todayChicago())}" data-date="${todayChicago()}">Back to the scoreboard</a></p></div>`; return; }
    const lists = state.teamLists || { upcoming: [], past: [], upcomingYear: state.teamSeason, pastYear: state.teamSeason, upcomingSoon: false, hasLast: false };
    const { upcoming, past, upcomingYear, pastYear, upcomingSoon, hasLast } = lists;
    const scored = past.map(m => ({ m, s: teamScoreRow(m, team.name) })).filter(x => x.s && x.s.score != null);
    const wins = scored.filter(x => x.s.win).length;
    const losses = scored.length - wins;
    const high = scored.reduce((a, x) => Math.max(a, x.s.score), 0);
    const avg = scored.length ? scored.reduce((a, x) => a + x.s.score, 0) / scored.length : 0;
    const natural = defaultSeason();
    const seasonNote = state.teamSeason !== natural
      ? `<a class="jump" href="${esc(teamHref(team.slug, natural))}" data-team="${esc(team.slug)}" data-team-season="${natural}">Current season</a>`
      : (hasLast || pastYear === natural - 1 ? `<a class="jump" href="${esc(teamHref(team.slug, natural - 1))}" data-team="${esc(team.slug)}" data-team-season="${natural - 1}">View ${natural - 1} season</a>` : '');
    const stats = scored.length
      ? `<div class="profile-stats"><span><strong>${wins}–${losses}</strong> meet record</span><span>High <strong>${high.toFixed(3)}</strong></span><span>Avg <strong>${avg.toFixed(3)}</strong></span></div>`
      : (past.length ? `<div class="profile-stats muted">Loading scores…</div>` : '');
    const upHtml = upcomingSoon && !upcoming.length
      ? `<p class="muted">Upcoming: ${esc(String(upcomingYear || natural))} schedule coming soon${upcomingYear || natural ? ' (season starts in January)' : ''}.</p>`
      : (upcoming.length ? `<ol class="profile-meets">${upcoming.map((m, i) => teamMeetRow(m, team.name, { upcoming: true, highlight: i === 0 })).join('')}</ol>`
        : `<p class="muted">No upcoming meets on the ${esc(String(upcomingYear || state.teamSeason))} schedule.</p>`);
    const pastHtml = past.length
      ? `<ol class="profile-meets">${past.slice().reverse().map(m => teamMeetRow(m, team.name, { upcoming: false })).join('')}</ol>`
      : `<p class="muted">No previous results in the ${esc(String(pastYear || state.teamSeason))} season yet.</p>`;
    el.status.textContent = '';
    el.meets.innerHTML = `<article class="profile">
      <p class="profile-back"><a class="jump" href="${dateHref(todayChicago())}" data-date="${todayChicago()}">‹ All meets</a></p>
      <header class="profile-head">
        <div class="crest" style="background:${esc(team.color)};color:${esc(crestInk(team))}">${esc(team.abbr)}</div>
        <div class="profile-id">
          <h2>${esc(team.name)} ${starBtn(team.name)}</h2>
          <p class="muted">${esc(team.conference)}${team.conference ? ' · ' : ''}<span class="season-tag">${esc(String(pastYear || state.teamSeason))} season</span>${upcomingYear && upcomingYear !== pastYear && upcoming.length ? ` · ${esc(String(upcomingYear))} upcoming` : ''}</p>
          ${seasonNote ? `<p class="season-switch">${seasonNote}</p>` : ''}
        </div>
      </header>
      ${teamRankHtml(team, state.teamSeason)}
      ${stats}
      ${coachesCardHtml(team)}
      ${rosterCardHtml(team, state.teamSeason)}
      <section class="profile-section">
        <h3>Upcoming</h3>
        ${upHtml}
      </section>
      <section class="profile-section">
        <h3>Previous results${pastYear && (!upcoming.length || pastYear !== upcomingYear) ? ` <span class="muted">· ${esc(String(pastYear))} season</span>` : ''}</h3>
        ${pastHtml}
      </section>
    </article>`;
  }
  function crestInk(team) {
    const c = (team.color2 || '#fff').replace('#', '');
    const hex = c.length === 3 ? c.split('').map(x => x + x).join('') : c;
    if (!/^[0-9a-fA-F]{6}$/.test(hex)) return '#fff';
    const r = parseInt(hex.slice(0, 2), 16), g = parseInt(hex.slice(2, 4), 16), b = parseInt(hex.slice(4, 6), 16);
    // Prefer the secondary color when it stays readable on the primary.
    const pr = team.color.replace('#', '');
    const phex = pr.length === 3 ? pr.split('').map(x => x + x).join('') : pr;
    const prr = parseInt(phex.slice(0, 2), 16), pg = parseInt(phex.slice(2, 4), 16), pb = parseInt(phex.slice(4, 6), 16);
    const contrast = (a, b) => {
      const L = x => { const s = x / 255; const y = s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; return y; };
      const la = 0.2126 * L(a[0]) + 0.7152 * L(a[1]) + 0.0722 * L(a[2]);
      const lb = 0.2126 * L(b[0]) + 0.7152 * L(b[1]) + 0.0722 * L(b[2]);
      const hi = Math.max(la, lb), lo = Math.min(la, lb);
      return (hi + 0.05) / (lo + 0.05);
    };
    return contrast([prr, pg, pb], [r, g, b]) >= 2.2 ? team.color2 : '#fff';
  }
  function teamMeetRow(m, name, { upcoming, highlight }) {
    const ha = meetHa(m, name);
    const opps = meetOpponents(m, name);
    const title = m.desc ? m.desc : (opps.length ? `${ha === 'Home' ? 'vs' : ha === 'Away' ? 'at' : 'with'} ${opps.join(', ')}` : meetTitle(m));
    const href = meetHref(m);
    const s = teamScoreRow(m, name);
    const loc = (s && s.location) || m.location || m.venue || '';
    let result = '';
    if (!upcoming) {
      if (s && s.score != null) {
        const wl = s.win ? '<span class="wl win">W</span>' : '<span class="wl loss">L</span>';
        const place = s.place ? `${s.place}${placeSuffix(s.place)}${s.field ? ` of ${s.field}` : ''}` : '';
        const others = (s.others || []).map(o => `${teamLink(o.name)} ${fmtScore(o.score)}`).join(' · ');
        result = `<div class="pm-result">${wl}<span class="pm-score">${fmtScore(s.score)}</span><span class="muted">${esc(place)}</span></div>${others ? `<div class="pm-others muted">${others}</div>` : ''}`;
      } else if (s && (s.status === 'FINAL' || statusOf(m) === 'PAST' || statusOf(m) === 'FINAL')) {
        result = `<div class="pm-result muted">Score not on Virtius</div>`;
      } else {
        result = `<div class="pm-result muted">Loading…</div>`;
      }
    }
    const when = `${shortDate(m.date)} · ${esc(timeCT(m.start_utc))}`;
    return `<li class="pm-row${highlight ? ' next-up' : ''}">
      <div class="pm-main" data-nm-date="${m.date}" data-nm-key="${esc(meetKey(m))}" role="link" tabindex="0">
        <span class="pm-when">${when}</span>
        <strong class="pm-title">${m.desc ? `${esc(m.desc)}${opps.length ? ` · ${opps.map(teamLink).join(', ')}` : ''}` : `${ha === 'Home' ? 'vs ' : ha === 'Away' ? 'at ' : ''}${opps.map(teamLink).join(', ') || esc(meetTitle(m))}`}</strong>
        <span class="pm-meta muted">${esc(ha)}${loc ? ` · ${esc(loc)}` : ''}</span>
        ${result}
      </div>
    </li>`;
  }
  function placeSuffix(n) {
    const v = n % 100, d = n % 10;
    if (v >= 11 && v <= 13) return 'th';
    return d === 1 ? 'st' : d === 2 ? 'nd' : d === 3 ? 'rd' : 'th';
  }

  function initTeamPicker() {
    const input = document.getElementById('team-search');
    const list = document.getElementById('team-list');
    if (!input || !list) return;
    let active = -1;
    let paintToken = 0;
    const close = () => { list.hidden = true; input.setAttribute('aria-expanded', 'false'); active = -1; };
    const open = () => { list.hidden = false; input.setAttribute('aria-expanded', 'true'); };
    const items = () => [...list.querySelectorAll('[role="option"]')];
    const teamRow = t => `<li role="option" data-team="${esc(t.slug)}" id="opt-${esc(t.slug)}" class="team-opt">
        <span class="team-opt-main">
          <span class="crest tiny" style="background:${esc(t.color)};color:${esc(crestInk(t))}">${esc(t.abbr)}</span>
          <span class="opt-name">${esc(t.name)}</span>
          <span class="opt-con muted">${esc(t.conference)}</span>
        </span>
        ${starBtn(t.name)}
      </li>`;
    const athleteRow = a => `<li role="option" data-team="${esc(a.teamSlug)}" data-athlete="${esc(a.slug)}" data-team-season="${a.season}" id="opt-ath-${esc(a.teamSlug)}-${esc(a.slug)}" class="team-opt athlete-opt${isFavAthlete(a.teamSlug, a.slug) ? ' is-fav' : ''}">
        <span class="team-opt-main">
          <span class="opt-name">${esc(a.name)}</span>
          <span class="opt-con muted">${esc(a.teamName)}</span>
        </span>
        ${athleteStarBtn(a.teamSlug, a.slug, a.name, { athleteId: a.athleteId })}
      </li>`;
    const paint = async () => {
      const token = ++paintToken;
      const q = input.value.trim().toLowerCase();
      const teams = (state.d1 && state.d1.teams) || [];
      const filtered = teams.filter(t => !q || t.name.toLowerCase().includes(q) || t.abbr.toLowerCase().includes(q) || t.slug.includes(q) || (t.conference || '').toLowerCase().includes(q));
      let athletes = [];
      if (q.length >= 2) {
        await ensureRostersForSearch();
        if (token !== paintToken) return;
        const nq = q.replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
        athletes = collectSearchAthletes().filter(a =>
          a.name.toLowerCase().includes(q) ||
          a.slug.includes(q.replace(/\s+/g, '-')) ||
          a.teamName.toLowerCase().includes(q) ||
          (nq && normAthleteName(a.name).includes(nq))
        ).slice(0, 12);
      }
      const shownTeams = filtered;
      let html = '';
      if (shownTeams.length) html += shownTeams.map(teamRow).join('');
      if (athletes.length) {
        html += `<li class="search-group-label fav-group-label" aria-disabled="true">Athletes</li>` + athletes.map(athleteRow).join('');
      }
      if (!html) html = `<li class="muted" aria-disabled="true">No teams or athletes match “${esc(input.value)}”</li>`;
      list.innerHTML = html;
      open();
      active = items().length ? 0 : -1;
      highlight();
    };
    const highlight = () => {
      items().forEach((it, i) => it.setAttribute('aria-selected', i === active ? 'true' : 'false'));
      const cur = items()[active];
      if (cur) { input.setAttribute('aria-activedescendant', cur.id); cur.scrollIntoView({ block: 'nearest' }); }
    };
    const choose = (slug, athlete, season) => {
      close();
      input.value = '';
      input.blur();
      if (slug) openTeam(slug, season || undefined, athlete || undefined);
    };
    input.addEventListener('focus', () => { if (state.d1) paint(); });
    input.addEventListener('input', paint);
    input.addEventListener('keydown', e => {
      const opts = items();
      if (e.key === 'ArrowDown') { e.preventDefault(); if (list.hidden) paint(); active = Math.min(opts.length - 1, active + 1); highlight(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); active = Math.max(0, active - 1); highlight(); }
      else if (e.key === 'Enter') {
        e.preventDefault();
        const it = opts[active];
        if (it) choose(it.dataset.team, it.dataset.athlete, it.dataset.teamSeason ? Number(it.dataset.teamSeason) : undefined);
      }
      else if (e.key === 'Escape') { close(); }
    });
    list.addEventListener('mousedown', e => {
      if (e.target.closest('[data-fav-toggle], [data-fav-athlete]')) { e.preventDefault(); e.stopPropagation(); return; }
      const it = e.target.closest('[data-team]');
      if (it) {
        e.preventDefault();
        choose(it.dataset.team, it.dataset.athlete, it.dataset.teamSeason ? Number(it.dataset.teamSeason) : undefined);
      }
    });
    document.addEventListener('click', e => {
      if (!e.target.closest('.team-picker')) close();
    });
  }


  function favRow(t) {
    const on = state.favs.has(t.slug);
    const label = on ? `Unstar ${t.name}` : `Star ${t.name}`;
    return `<li class="fav-pick-item${on ? ' is-fav' : ''}">
      <button type="button" class="star-btn fav-star${on ? ' on' : ''}" data-fav-toggle="${esc(t.slug)}" aria-pressed="${on}" aria-label="${esc(label)}" title="${esc(label)}">${on ? '★' : '☆'}</button>
      <a class="fav-pick-main" href="${esc(teamHref(t.slug))}" data-team="${esc(t.slug)}">
        <span class="crest tiny" style="background:${esc(t.color)};color:${esc(crestInk(t))}">${esc(t.abbr)}</span>
        <span class="opt-name">${esc(t.name)}</span>
        <span class="opt-con muted">${esc(t.conference)}</span>
      </a>
    </li>`;
  }
  function favAthleteRow(a) {
    const on = isFavAthlete(a.teamSlug, a.slug);
    const season = a.season || undefined;
    return `<li class="fav-pick-item is-athlete${on ? ' is-fav' : ''}">
      ${athleteStarBtn(a.teamSlug, a.slug, a.name, { cls: 'fav-star', athleteId: a.athleteId })}
      <a class="fav-pick-main" href="${esc(teamHref(a.teamSlug, season, a.slug))}" data-team="${esc(a.teamSlug)}" data-athlete="${esc(a.slug)}"${season ? ` data-team-season="${season}"` : ''}>
        <span class="opt-name">${esc(a.name)}</span>
        <span class="opt-con muted">${esc(a.teamName)}</span>
      </a>
    </li>`;
  }
  function renderFavPicker() {
    const btn = document.getElementById('fav-picker-btn');
    const list = document.getElementById('fav-picker-list');
    const search = document.getElementById('fav-picker-search');
    if (!btn || !list) return;
    const n = state.favs.size + state.favAthletes.length;
    btn.classList.toggle('has-favs', n > 0);
    btn.innerHTML = n ? `★ Favorites <span class="pill-count">${n}</span>` : '★ Favorites';
    const q = (search && search.value || '').trim().toLowerCase();
    const qSlug = q.replace(/\s+/g, '-');
    const matchTeam = t => !q || t.name.toLowerCase().includes(q) || t.abbr.toLowerCase().includes(q) || t.slug.includes(q) || (t.conference || '').toLowerCase().includes(q);
    const matchAth = a => !q || a.name.toLowerCase().includes(q) || a.slug.includes(qSlug) || (a.teamName || '').toLowerCase().includes(q);
    const allTeams = ((state.d1 && state.d1.teams) || []).filter(matchTeam);
    const favTeams = allTeams.filter(t => state.favs.has(t.slug)).sort((a, b) => a.name.localeCompare(b.name));
    const restTeams = allTeams.filter(t => !state.favs.has(t.slug)).sort((a, b) => a.name.localeCompare(b.name));
    const favAths = state.favAthletes.filter(matchAth).slice().sort((a, b) => a.name.localeCompare(b.name) || a.teamName.localeCompare(b.teamName));
    let extraAths = [];
    if (q.length >= 2) {
      extraAths = collectSearchAthletes().filter(a => matchAth(a) && !isFavAthlete(a.teamSlug, a.slug)).slice(0, 10);
    }
    let html = '';
    if (favAths.length) html += `<li class="fav-group-label">Favorite Athletes</li>` + favAths.map(favAthleteRow).join('');
    else if (!q && !state.favAthletes.length) { /* leave room for the teams lists */ }
    if (favTeams.length) html += `<li class="fav-group-label">Favorite Teams</li>` + favTeams.map(favRow).join('');
    if (extraAths.length) html += `<li class="fav-group-label">Athletes</li>` + extraAths.map(favAthleteRow).join('');
    if (restTeams.length) html += `<li class="fav-group-label">${favTeams.length || favAths.length ? 'All teams' : 'Teams'}</li>` + restTeams.map(favRow).join('');
    if (!html) html = `<li class="muted fav-empty">No teams or athletes match.</li>`;
    list.innerHTML = html;
  }
  function closeFavPicker() {
    const box = document.getElementById('fav-picker');
    const btn = document.getElementById('fav-picker-btn');
    if (box) box.hidden = true;
    if (btn) btn.setAttribute('aria-expanded', 'false');
  }
  function initFavPicker() {
    const btn = document.getElementById('fav-picker-btn');
    const box = document.getElementById('fav-picker');
    const search = document.getElementById('fav-picker-search');
    if (!btn || !box) return;
    const open = () => {
      renderFavPicker();
      box.hidden = false;
      btn.setAttribute('aria-expanded', 'true');
      search && search.focus();
      ensureRostersForSearch().then(() => { if (!box.hidden) renderFavPicker(); });
    };
    btn.addEventListener('click', e => { e.stopPropagation(); box.hidden ? open() : closeFavPicker(); });
    if (search) search.addEventListener('input', () => {
      renderFavPicker();
      if ((search.value || '').trim().length >= 2) ensureRostersForSearch().then(() => { if (!box.hidden) renderFavPicker(); });
    });
    document.addEventListener('click', e => {
      if (box.hidden) return;
      // Re-rendering the list during a star click detaches the target, so also
      // ignore detached star clicks and anything still inside the picker.
      if (e.target.closest('#fav-picker, #fav-picker-btn, [data-fav-toggle], [data-fav-athlete]')) return;
      closeFavPicker();
    });
    renderFavPicker();
  }


  // ---------- national rankings + season highlights ----------
  const EVENT_LABEL = { vault: 'Vault', bars: 'Bars', beam: 'Beam', floor: 'Floor' };
  function statsSeason() {
    if (SEASON_OVERRIDE) return SEASON_OVERRIDE;
    return seasonFor(todayChicago());
  }
  function statsAsOf(season) {
    const today = todayChicago();
    if (seasonFor(today) === season) return today;
    if (NOW_OVERRIDE && seasonFor(NOW_OVERRIDE) === season) return NOW_OVERRIDE;
    return null; // viewing a completed season in full
  }
  async function loadSeasonData() {
    if (!state.rankings) {
      try { state.rankings = await getJson('data/rankings.json'); } catch { state.rankings = { seasons: {} }; }
    }
    if (!state.seasonStats) {
      try { state.seasonStats = await getJson('data/season-stats.json'); } catch { state.seasonStats = { seasons: {} }; }
    }
    return { rankings: state.rankings, stats: state.seasonStats };
  }
  function seasonBlock(kind) {
    const yr = statsSeason();
    const root = kind === 'rankings' ? state.rankings : state.seasonStats;
    return root && root.seasons && root.seasons[yr] || null;
  }
  function finalBlock(block, seasonYear) {
    if (block && block.final && block.final.teams && block.final.teams.length) {
      return { ...block.final, seasonYear: seasonYear || null };
    }
    return null;
  }
  function asFinalRank(fin) {
    if (!fin) return null;
    return {
      kind: 'final',
      teams: fin.teams,
      label: fin.label || `${fin.seasonYear || ''} Final Standings (after NCAA Championships)`.trim(),
      date: fin.date,
      source: fin.source,
      source_url: fin.source_url,
      metric: 'score',
      week: null,
      message: null,
      seasonYear: fin.seasonYear || null,
    };
  }
  function pickRankings(block, season) {
    const asOf = statsAsOf(season);
    const weeks = ((block && block.weeks) || []).slice().sort((a, b) => a.week - b.week);
    const inSeason = weeks.filter(w => w.teams && w.teams.length && (!asOf || (w.date && w.date <= asOf)));
    const latest = inSeason.length ? inSeason[inSeason.length - 1] : null;
    const poll = block && block.preseason;
    const pollOut = poll && poll.status === 'published' && poll.teams && poll.teams.length;
    const firstWeek = weeks.find(w => w.teams && w.teams.length);
    const fin = finalBlock(block, season);
    const afterChamps = !!(fin && (!asOf || (fin.date && asOf >= fin.date)));
    // Regular season (and mid-season previews): weekly RTN NQS, until championships are over.
    if (latest && !afterChamps) {
      const cur = block.current && block.current.week === latest.week ? block.current : null;
      const label = cur && cur.label
        ? cur.label
        : `RTN National Rankings, updated ${latest.date || ''}`.trim();
      return {
        kind: 'rtn',
        teams: latest.teams,
        label,
        date: latest.date,
        week: latest.week,
        metric: latest.metric || 'NQS',
        source: 'Road to Nationals',
        message: null,
      };
    }
    if (afterChamps) return asFinalRank(fin);
    const beforeWeekly = !latest && pollOut;
    const pollStillLeads = pollOut && asOf && firstWeek && firstWeek.date && asOf < firstWeek.date;
    if (beforeWeekly || pollStillLeads || (pollOut && !latest)) {
      return {
        kind: 'preseason',
        teams: poll.teams,
        also: poll.also_receiving || [],
        label: poll.label || 'Preseason Coaches Poll',
        date: poll.date,
        source: poll.source,
        metric: 'points',
        week: null,
        message: null,
      };
    }
    // New season, poll not out yet: show last season's official championship standings.
    const prev = state.rankings && state.rankings.seasons && state.rankings.seasons[season - 1];
    const prevFinal = asFinalRank(finalBlock(prev, season - 1));
    if (prevFinal) return prevFinal;
    if (poll && poll.status === 'upcoming') {
      return { kind: 'upcoming', teams: [], label: poll.label || 'Preseason Coaches Poll', date: null, message: poll.message || 'Preseason poll coming soon', metric: null, week: null };
    }
    return { kind: 'none', teams: [], label: 'National rankings', date: null, message: 'Rankings are not available yet.', metric: null, week: null };
  }
  function fmtMove(move) {
    if (move == null || move === 0) return '<span class="rank-move same">—</span>';
    if (move > 0) return `<span class="rank-move up">▲${move}</span>`;
    return `<span class="rank-move down">▼${Math.abs(move)}</span>`;
  }
  function metricCell(t, metric) {
    if (metric === 'points') return t.points != null ? t.points.toLocaleString('en-US') : '—';
    const n = metric === 'score' ? (t.score != null ? t.score : t.ncaa_final || t.ncaa || t.regional || t.nqs)
      : (t.nqs != null ? t.nqs : t.avg);
    if (n == null) return '—';
    return fmtScore(Number(n));
  }
  function meetJumpHref(date, key) {
    if (!date) return null;
    return `${dateHref(date)}${key ? `#meet=${encodeURIComponent(key)}` : ''}`;
  }
  function sundayOf(ymd) {
    const d = new Date(ymd + 'T12:00:00Z');
    const add = d.getUTCDay() === 0 ? 0 : 7 - d.getUTCDay();
    d.setUTCDate(d.getUTCDate() + add);
    return d.toISOString().slice(0, 10);
  }
  function weekendHasHighs(w) {
    if (!w) return false;
    if ((w.team197 || []).length) return true;
    const eh = w.eventHighs || {};
    return EVENTS.some(e => (eh[e.key] || []).length);
  }
  function liveWeekendBits(season, asOf) {
    const today = todayChicago();
    if (seasonFor(today) !== season) return null;
    const team197 = [];
    const eventHighs = { vault: [], bars: [], beam: [], floor: [] };
    let start = null, end = null;
    const consider = (date, meet, title, virtius, teams) => {
      if (!date || (asOf && date > asOf)) return;
      if (seasonFor(date) !== season) return;
      start = start ? (date < start ? date : start) : date;
      end = end ? (date > end ? date : end) : date;
      for (const t of teams || []) {
        if (t.score != null && t.score >= 197 - 1e-9) {
          team197.push({ team: t.name, score: t.score, date, meet: title, virtius });
        }
        for (const r of t.rotations || []) {
          if (!eventHighs[r.event]) continue;
          for (const g of r.gymnasts || []) {
            if (g.exhibition || g.score == null) continue;
            eventHighs[r.event].push({ athlete: g.name, team: t.name, event: r.event, score: g.score, date, meet: title, virtius });
          }
        }
      }
    };
    for (const meet of state.meets || []) {
      const d = state.details[meetKey(meet)];
      if (!d || !d.teams) continue;
      consider(meet.date, meet, d.name || meetTitle(meet), meet.virtius, d.teams);
    }
    if (!start) return null;
    // Keep only the current (latest) weekend's live scores.
    const id = sundayOf(end || start);
    const inWeek = x => x.date && sundayOf(x.date) === id;
    const trim = list => {
      const best = list.length ? Math.max(...list.map(x => x.score)) : null;
      return best == null ? [] : list.filter(x => inWeek(x) && Math.abs(x.score - best) < 1e-9);
    };
    return {
      id, start, end, label: '',
      team197: team197.filter(inWeek).sort((a, b) => b.score - a.score),
      eventHighs: Object.fromEntries(EVENTS.map(e => [e.key, trim(eventHighs[e.key])])),
    };
  }
  function pickWeekend(block, asOf, season) {
    const list = ((block && block.weekends) || []).filter(w => !asOf || (w.start && w.start <= asOf));
    let w = list.length ? { ...list[list.length - 1] } : null;
    const live = liveWeekendBits(season, asOf);
    if (live && (!w || live.id === w.id || live.end >= (w.end || ''))) {
      if (!w || live.id !== w.id) w = { id: live.id, start: live.start, end: live.end, label: '', team197: [], eventHighs: { vault: [], bars: [], beam: [], floor: [] } };
      const byKey = (arr, x) => `${x.date}|${x.virtius || ''}|${x.team}|${x.athlete || ''}|${x.score}`;
      const merge197 = [...(w.team197 || [])];
      for (const t of live.team197) if (!merge197.some(x => byKey(merge197, x) === byKey(merge197, t))) merge197.push(t);
      const eh = { ...(w.eventHighs || {}) };
      for (const e of EVENTS) {
        const cur = [...(eh[e.key] || [])];
        for (const x of (live.eventHighs[e.key] || [])) if (!cur.some(y => byKey(cur, y) === byKey(cur, x))) cur.push(x);
        const best = cur.length ? Math.max(...cur.map(x => x.score)) : null;
        eh[e.key] = best == null ? [] : cur.filter(x => Math.abs(x.score - best) < 1e-9);
      }
      w = { ...w, start: !w.start || live.start < w.start ? live.start : w.start, end: !w.end || live.end > w.end ? live.end : w.end, team197: merge197.sort((a, b) => b.score - a.score), eventHighs: eh };
    }
    if (!w) return null;
    if (asOf) {
      w = {
        ...w,
        team197: (w.team197 || []).filter(t => !t.date || t.date <= asOf),
        eventHighs: Object.fromEntries(EVENTS.map(e => {
          const list = (w.eventHighs && w.eventHighs[e.key]) || [];
          const cut = list.filter(x => !x.date || x.date <= asOf);
          const best = cut.length ? Math.max(...cut.map(x => x.score)) : null;
          return [e.key, best == null ? [] : cut.filter(x => Math.abs(x.score - best) < 1e-9)];
        })),
      };
    }
    return w;
  }
  const POLL_API = 'https://live-scoreboard-polls.thefivegym.workers.dev';
  const POLL_STORE_KEY = 'tf_poll_votes_v1';

  function emptyPollStore() {
    const voterId = (crypto.randomUUID && crypto.randomUUID()) || (`v-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    return { voterId, votes: {} };
  }
  function loadPollStore() {
    try {
      const raw = JSON.parse(localStorage.getItem(POLL_STORE_KEY) || 'null');
      if (raw && typeof raw === 'object' && typeof raw.voterId === 'string' && raw.voterId.length >= 8) {
        return { voterId: raw.voterId, votes: raw.votes && typeof raw.votes === 'object' ? raw.votes : {} };
      }
    } catch {}
    const store = emptyPollStore();
    savePollStore(store);
    return store;
  }
  function savePollStore(store) {
    try { localStorage.setItem(POLL_STORE_KEY, JSON.stringify({ voterId: store.voterId, votes: store.votes || {} })); } catch {}
  }
  function pollById(id) {
    return (state.polls || []).find(p => p.id === id) || null;
  }
  function lockedOption(poll) {
    if (!poll) return null;
    const store = loadPollStore();
    return poll.myVote || store.votes[poll.id] || null;
  }
  function pollSummaryLine(poll) {
    if (!poll) return 'Loading live tallies…';
    if (!poll.totalVotes) return 'Be the first to vote';
    const lead = poll.leader ? `${poll.leader.label} leads` : 'No leader yet';
    const n = poll.totalVotes;
    return `${lead} · ${n} vote${n === 1 ? '' : 's'}`;
  }
  function fanPollsHtml() {
    let rows;
    if (state.pollError && !state.polls) {
      rows = `<div class="fp-status">Live tallies could not be loaded. The rest of the scoreboard is still up to date. <button type="button" class="fp-retry" data-poll-retry>Retry</button></div>`;
    } else if (!state.polls) {
      rows = `<div class="fp-status">Loading live tallies…</div>`;
    } else {
      rows = `<div class="fp-list">${state.polls.map(p => {
        const locked = lockedOption(p);
        const cta = locked ? 'View results · Voted' : 'Vote';
        return `<div class="fp-row" data-poll-open="${esc(p.id)}">
          <span class="fp-copy"><span class="fp-title">${esc(p.title)}</span><span class="fp-blurb">${esc(pollSummaryLine(p))}</span></span>
          <button type="button" class="fp-vote" data-poll-open="${esc(p.id)}">${esc(cta)}</button>
        </div>`;
      }).join('')}</div>`;
      if (state.pollError) rows += `<p class="fp-status muted">Couldn’t refresh tallies. <button type="button" class="fp-retry" data-poll-retry>Retry</button></p>`;
    }
    return `<section class="fan-polls" id="fan-polls" aria-label="Fan Polls">
      <div class="fp-head"><h2>Fan Polls</h2><p class="fp-lead">Make your pick for the 2027 season.</p></div>
      ${rows}
    </section>`;
  }
  function paintFanPolls() {
    if (el.hero && el.hero.hidden) return;
    const card = document.getElementById('fan-polls');
    const html = fanPollsHtml();
    if (card) card.outerHTML = html;
    else if (el.hero && !el.hero.hidden && el.hero.innerHTML) el.hero.insertAdjacentHTML('beforeend', html);
  }
  async function loadFanPolls() {
    if (state.pollLoading) return;
    state.pollLoading = true;
    paintFanPolls();
    try {
      const store = loadPollStore();
      const res = await fetch(`${POLL_API}/api/polls?voterId=${encodeURIComponent(store.voterId)}`, {
        headers: { 'X-Voter-Id': store.voterId },
      });
      if (!res.ok) throw new Error('polls-http');
      const data = await res.json();
      const polls = Array.isArray(data.polls) ? data.polls : [];
      state.polls = polls;
      state.pollError = false;
      for (const p of polls) {
        if (p.myVote) store.votes[p.id] = p.myVote;
      }
      savePollStore(store);
    } catch {
      state.pollError = true;
    } finally {
      state.pollLoading = false;
      paintFanPolls();
      if (state.pollOpen) paintPollModal();
    }
  }
  function closePollModal() {
    const modal = document.getElementById('poll-modal');
    if (modal) modal.hidden = true;
    document.body.classList.remove('poll-open');
    state.pollOpen = null;
    state.pollFilter = '';
    state.pollPicked = null;
    state.pollShowAll = false;
    state.pollBusy = false;
    state.pollVoteError = null;
  }
  function openPollModal(pollId) {
    const poll = pollById(pollId);
    if (!poll) { loadFanPolls(); return; }
    state.pollOpen = pollId;
    state.pollFilter = '';
    state.pollPicked = lockedOption(poll);
    state.pollShowAll = false;
    state.pollVoteError = null;
    const modal = document.getElementById('poll-modal');
    if (modal) modal.hidden = false;
    document.body.classList.add('poll-open');
    paintPollModal();
    loadFanPolls();
    const search = document.getElementById('poll-search');
    if (search) search.focus();
  }
  function optionMatches(opt, q) {
    if (!q) return true;
    const hay = [opt.label, opt.sublabel, opt.id, opt.meta && opt.meta.abbr, opt.meta && opt.meta.school, opt.meta && opt.meta.conference, opt.meta && opt.meta.mascot].filter(Boolean).join(' ').toLowerCase();
    return hay.includes(q);
  }
  function ballotOptions(poll, q) {
    const list = poll.options.slice().filter(o => optionMatches(o, q));
    list.sort((a, b) => {
      const ac = a.meta && a.meta.contender ? 0 : 1;
      const bc = b.meta && b.meta.contender ? 0 : 1;
      if (ac !== bc) return ac - bc;
      return (a.sortOrder - b.sortOrder) || a.label.localeCompare(b.label);
    });
    return list;
  }
  function resultOptions(poll, locked) {
    const ranked = poll.options.slice().sort((a, b) => b.votes - a.votes || a.label.localeCompare(b.label));
    if (state.pollShowAll || ranked.length <= (poll.resultsPreview || 15)) return ranked;
    const keep = new Set(ranked.slice(0, poll.resultsPreview || 15).map(o => o.id));
    if (locked) keep.add(locked);
    return ranked.filter(o => keep.has(o.id));
  }
  function paintPollModal() {
    const body = document.getElementById('poll-modal-body');
    const poll = pollById(state.pollOpen);
    if (!body) return;
    if (!poll) {
      body.innerHTML = `<h2 id="poll-title">Fan Polls</h2><p class="poll-note">${state.pollError ? 'Couldn’t load this poll.' : 'Loading…'} ${state.pollError ? '<button type="button" class="fp-retry" data-poll-retry>Retry</button>' : ''}</p>`;
      return;
    }
    const locked = lockedOption(poll);
    const title = `<h2 id="poll-title">${esc(poll.title)}</h2>
      <p class="poll-sub">${esc(poll.subtitle || '')}</p>
      <p class="poll-note">${esc(poll.note || 'One vote per poll — your pick is final.')}</p>`;
    if (locked) {
      const shown = resultOptions(poll, locked);
      const hidden = poll.options.length - shown.length;
      const rows = shown.map((o, i) => {
        const mine = o.id === locked;
        const rank = poll.options.slice().sort((a, b) => b.votes - a.votes || a.label.localeCompare(b.label)).findIndex(x => x.id === o.id) + 1;
        return `<li class="poll-result${mine ? ' is-mine' : ''}">
          <div class="poll-result-top">
            <span class="poll-rank">${rank}</span>
            <span class="poll-result-who"><strong>${esc(o.label)}</strong>${o.sublabel ? `<span class="poll-result-sub">${esc(o.sublabel)}</span>` : ''}${mine ? ' <span class="poll-yours">Your pick</span>' : ''}</span>
            <span class="poll-result-n">${o.votes}<span class="poll-pct">${o.pct}%</span></span>
          </div>
          <span class="poll-bar" aria-hidden="true"><span class="poll-bar-fill${mine ? ' is-mine' : ''}" style="width:${Math.max(o.pct, o.votes ? 1.5 : 0)}%"></span></span>
        </li>`;
      }).join('');
      body.innerHTML = `${title}
        <p class="poll-tally"><strong>${poll.totalVotes}</strong> vote${poll.totalVotes === 1 ? '' : 's'} · ${esc(pollSummaryLine(poll))}</p>
        <ol class="poll-results">${rows}</ol>
        ${hidden > 0 ? `<button type="button" class="poll-all" data-poll-all>Show all ${poll.options.length} ${poll.kind === 'athlete' ? 'gymnasts' : 'teams'}</button>` : (poll.options.length > (poll.resultsPreview || 15) && state.pollShowAll ? `<button type="button" class="poll-all" data-poll-all>Show top ${poll.resultsPreview || 15}</button>` : '')}`;
      return;
    }
    const q = (state.pollFilter || '').trim().toLowerCase();
    const opts = ballotOptions(poll, q);
    const search = poll.searchable && poll.options.length > 10
      ? `<label class="poll-search-label">Find your ${poll.kind === 'athlete' ? 'gymnast' : 'team'}
          <input id="poll-search" class="poll-search" type="search" placeholder="${poll.kind === 'athlete' ? 'Search gymnasts…' : 'Search teams…'}" value="${esc(state.pollFilter || '')}" autocomplete="off" spellcheck="false">
        </label>`
      : '';
    const cards = opts.length
      ? opts.map(o => {
          const on = state.pollPicked === o.id;
          return `<label class="poll-opt${on ? ' is-on' : ''}" data-poll-option="${esc(o.id)}">
            <input type="radio" name="poll-option" value="${esc(o.id)}" ${on ? 'checked' : ''}>
            <span class="poll-opt-copy"><span class="poll-opt-name">${esc(o.label)}</span>${o.sublabel ? `<span class="poll-opt-sub">${esc(o.sublabel)}</span>` : ''}</span>
          </label>`;
        }).join('')
      : `<p class="poll-empty">No matches. Try another search.</p>`;
    const err = state.pollVoteError ? `<p class="poll-error">${esc(state.pollVoteError)}</p>` : '';
    body.innerHTML = `${title}${search}
      <div class="poll-options" role="radiogroup" aria-label="${esc(poll.title)}">${cards}</div>
      ${err}
      <button type="button" class="poll-lock" data-poll-lock ${!state.pollPicked || state.pollBusy ? 'disabled' : ''}>${state.pollBusy ? 'Locking in…' : 'Lock in vote'}</button>`;
    const input = document.getElementById('poll-search');
    if (input) {
      const val = input.value;
      input.focus();
      try { input.setSelectionRange(val.length, val.length); } catch {}
    }
  }
  async function submitPollVote() {
    const poll = pollById(state.pollOpen);
    const optionId = state.pollPicked;
    if (!poll || !optionId || state.pollBusy || lockedOption(poll)) return;
    state.pollBusy = true;
    state.pollVoteError = null;
    paintPollModal();
    const store = loadPollStore();
    try {
      const res = await fetch(`${POLL_API}/api/polls/${encodeURIComponent(poll.id)}/vote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Voter-Id': store.voterId },
        body: JSON.stringify({ optionId, voterId: store.voterId }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.poll) {
        state.polls = (state.polls || []).map(p => p.id === data.poll.id ? data.poll : p);
      }
      const locked = data.lockedOptionId || (data.poll && data.poll.myVote);
      if (locked) {
        store.votes[poll.id] = locked;
        savePollStore(store);
        state.pollPicked = locked;
        state.pollBusy = false;
        state.pollVoteError = null;
        paintFanPolls();
        paintPollModal();
        return;
      }
      throw new Error(data.error || 'vote-failed');
    } catch {
      state.pollBusy = false;
      state.pollVoteError = 'Your vote could not be saved. Check your connection and try again.';
      paintPollModal();
    }
  }
  function weekendWatchHtml(block, asOf, season) {
    const stored = (block && block.weekends) || [];
    const w = pickWeekend(block, asOf, season);
    const label = (w && (w.label || weekendRangeLabel(w.start, w.end))) || '';
    if (!stored.length && !weekendHasHighs(w)) {
      return `<section class="weekend-watch" id="weekend-watch" aria-label="Weekend Highs and 197+ Watch">
        <div class="ww-head"><h2>Weekend Highs &amp; 197+ Watch</h2></div>
        <p class="ww-empty">The first 197+ team score and event highs of the season will land here.</p>
      </section>`;
    }
    if (!w) {
      return `<section class="weekend-watch" id="weekend-watch" aria-label="Weekend Highs and 197+ Watch">
        <div class="ww-head"><h2>Weekend Highs &amp; 197+ Watch</h2></div>
        <p class="ww-empty">The first 197+ team score and event highs of the season will land here.</p>
      </section>`;
    }
    const scores = w.team197 || [];
    const n197 = scores.length;
    const shown = scores.slice(0, 8);
    const rest197 = n197 - shown.length;
    const top = shown.map(t => {
      const href = meetJumpHref(t.date, t.virtius);
      const body = `<span class="ww-team">${esc(t.team)}</span><span class="ww-score">${fmtScore(t.score)}</span>`;
      return href
        ? `<li><a class="jump ww-row" href="${esc(href)}" data-date="${esc(t.date || '')}" data-meet="${esc(t.virtius || '')}">${body}</a></li>`
        : `<li><span class="ww-row">${body}</span></li>`;
    }).join('');
    const evCells = EVENTS.map(e => {
      const tied = (w.eventHighs && w.eventHighs[e.key]) || [];
      if (!tied.length) return `<div class="ww-ev"><span class="ww-abbr">${e.abbr}</span><span class="ww-ev-empty">—</span></div>`;
      const first = tied[0];
      const extra = tied.length > 1 ? `<span class="ww-tie">+${tied.length - 1} tied</span>` : '';
      const href = meetJumpHref(first.date, first.virtius);
      const who = `${esc(first.athlete)} · ${esc(first.team)}`;
      const inner = `<span class="ww-abbr">${e.abbr}</span><span class="ww-ev-score">${fmtScore(first.score)}</span><span class="ww-ev-who">${who}</span>${extra}`;
      return href
        ? `<a class="ww-ev jump" href="${esc(href)}" data-date="${esc(first.date || '')}" data-meet="${esc(first.virtius || '')}">${inner}</a>`
        : `<div class="ww-ev">${inner}</div>`;
    }).join('');
    const countLine = n197
      ? `<p class="ww-count"><strong>${n197}</strong> team score${n197 === 1 ? '' : 's'} of 197+</p>`
      : `<p class="ww-count muted">No 197+ team scores this weekend.</p>`;
    return `<section class="weekend-watch" id="weekend-watch" aria-label="Weekend Highs and 197+ Watch">
      <div class="ww-head"><h2>Weekend Highs &amp; 197+ Watch</h2>${label ? `<p class="ww-when">${esc(label)}</p>` : ''}</div>
      ${countLine}
      ${n197 ? `<ol class="ww-197">${top}</ol>${rest197 > 0 ? `<p class="ww-more muted">+${rest197} more</p>` : ''}` : ''}
      <div class="ww-events">${evCells}</div>
    </section>`;
  }
  function weekendRangeLabel(start, end) {
    if (!start) return '';
    if (!end || start === end) return shortDate(start);
    const a = new Date(start + 'T12:00:00Z');
    const b = new Date(end + 'T12:00:00Z');
    const sameMonth = a.getUTCMonth() === b.getUTCMonth();
    const left = a.toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' });
    const right = b.toLocaleDateString('en-US', { timeZone: 'UTC', month: sameMonth ? undefined : 'short', day: 'numeric' });
    return `${left}–${right}`;
  }
  function liveSeasonExtras(season, asOf) {
    const tens = [];
    const aas = [];
    if (seasonFor(todayChicago()) !== season) return { tens, aas };
    const meetByKey = new Map();
    const pushMeet = m => { if (m) meetByKey.set(meetKey(m), m); };
    (state.meets || []).forEach(pushMeet);
    Object.values(state.schedules || {}).forEach(s => ((s && s.meets) || []).forEach(pushMeet));
    for (const [key, d] of Object.entries(state.details || {})) {
      if (!d || !d.teams) continue;
      const meet = meetByKey.get(key);
      const date = (meet && meet.date) || todayChicago();
      if (asOf && date > asOf) continue;
      if (seasonFor(date) !== season) continue;
      const title = (d.name) || (meet && (meet.desc || meetTitle(meet))) || 'Meet';
      for (const team of d.teams) {
        const byAthlete = new Map();
        for (const rot of team.rotations || []) {
          const event = rot.event;
          if (!EVENT_LABEL[event]) continue;
          for (const g of rot.gymnasts || []) {
            if (g.exhibition || g.score == null) continue;
            if (Math.abs(g.score - 10) < 0.00005) {
              tens.push({ athlete: g.name, team: team.name, event, score: 10, date, meet: title, virtius: meet && meet.virtius || key, live: true });
            }
            if (!g.name) continue;
            const rec = byAthlete.get(g.name) || { events: {} };
            if (rec.events[event] == null) rec.events[event] = g.score;
            byAthlete.set(g.name, rec);
          }
        }
        for (const [name, rec] of byAthlete) {
          if (!['vault', 'bars', 'beam', 'floor'].every(e => rec.events[e] != null)) continue;
          const score = Number(['vault', 'bars', 'beam', 'floor'].reduce((s, e) => s + rec.events[e], 0).toFixed(4));
          if (score < 36 || score > 40.0001) continue;
          aas.push({ athlete: name, team: team.name, score, date, meet: title, virtius: meet && meet.virtius || key, live: true });
        }
      }
    }
    return { tens, aas };
  }
  function tenKey(p) { return `${p.date}|${p.virtius || ''}|${p.athlete}|${p.event}|${p.team}`; }
  function mergePerfect10s(stored, live) {
    const out = [];
    const seen = new Set();
    for (const p of [...(stored || []), ...live]) {
      const k = tenKey(p);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(p);
    }
    return out.sort((a, b) => (a.date || '').localeCompare(b.date || '') || a.athlete.localeCompare(b.athlete) || a.event.localeCompare(b.event));
  }
  function aaHighAsOf(block, asOf, liveAAs) {
    let candidates = [];
    if (block && block.allAroundHighByDate && block.allAroundHighByDate.length) {
      const rows = asOf
        ? block.allAroundHighByDate.filter(r => r.as_of && r.as_of <= asOf)
        : block.allAroundHighByDate;
      const last = rows[rows.length - 1];
      if (last) candidates = (last.tied || []).map(t => ({ ...t, score: last.score }));
    } else if (block && block.allAroundHigh && block.allAroundHigh.score != null) {
      candidates = (block.allAroundHigh.tied || []).filter(t => !asOf || (t.date && t.date <= asOf));
    }
    for (const a of liveAAs || []) {
      if (asOf && a.date > asOf) continue;
      candidates.push(a);
    }
    if (!candidates.length) return { score: null, tied: [] };
    const best = Math.max(...candidates.map(a => a.score));
    const tied = candidates.filter(a => Math.abs(a.score - best) < 1e-9)
      .filter((a, i, arr) => arr.findIndex(x => x.athlete === a.athlete && x.team === a.team && x.date === a.date && (x.virtius || '') === (a.virtius || '')) === i)
      .sort((a, b) => (a.date || '').localeCompare(b.date || '') || a.athlete.localeCompare(b.athlete));
    return { score: best, tied };
  }
  const seenTenKeys = new Set();
  let tensInitialized = false;
  function flagNewTens(tens) {
    const keys = tens.map(tenKey);
    const fresh = tensInitialized
      ? tens.filter(p => p.live || !seenTenKeys.has(tenKey(p)))
      : tens.filter(p => p.live);
    tensInitialized = true;
    keys.forEach(k => seenTenKeys.add(k));
    const newKeys = new Set(fresh.map(tenKey));
    return tens.map(p => newKeys.has(tenKey(p)) ? { ...p, isNew: true } : p);
  }
  function renderSeasonPulse() {
    const season = statsSeason();
    const asOf = statsAsOf(season);
    const openIds = [...document.querySelectorAll('#season-pulse details[open], #season-hero details[open]')].map(d => d.id);
    const blockR = seasonBlock('rankings');
    const blockS = seasonBlock('stats');
    const rank = pickRankings(blockR, season);
    const live = liveSeasonExtras(season, asOf);
    let tens = mergePerfect10s((blockS && blockS.perfect10s) || [], live.tens).filter(p => !asOf || (p.date && p.date <= asOf));
    tens = flagNewTens(tens).slice().sort((a, b) => (b.date || '').localeCompare(a.date || '') || a.athlete.localeCompare(b.athlete));
    const aa = aaHighAsOf(blockS, asOf, live.aas);
    const preview = SEASON_OVERRIDE || NOW_OVERRIDE
      ? `<p class="hero-preview muted">${SEASON_OVERRIDE && seasonFor(todayChicago()) !== season ? `Showing the ${season} season.` : ''}${NOW_OVERRIDE ? ` Preview date ${esc(NOW_OVERRIDE)} (noon CT).` : ''} <a class="jump" href="./">Back to today</a></p>`
      : '';
    const viewLast = season === seasonFor(todayChicago()) && season > 2026
      ? `<p class="hero-preview muted"><a class="jump" href="?season=${season - 1}">View ${season - 1} season</a></p>`
      : '';
    if (el.hero && !el.hero.hidden) {
      state.heroTens = tens;
      el.hero.innerHTML = `${preview}${viewLast}${seasonHeroHtml(tens, aa, season)}${weekendWatchHtml(blockS, asOf, season)}${fanPollsHtml()}`;
      if (!state.polls && !state.pollLoading) loadFanPolls();
    }
    const box = el.pulse;
    if (box && !box.hidden) {
      box.innerHTML = `<article class="pulse-card" id="rankings-card">${rankingsCardHtml(rank, season)}</article>`;
    }
    openIds.forEach(id => { const d = document.getElementById(id); if (d) d.open = true; });
  }
  function rankingsCardHtml(rank, season) {
    const bits = [];
    if (rank.kind === 'preseason' && rank.date) bits.push(`Released ${esc(shortDate(rank.date))}`);
    if (rank.kind === 'rtn') {
      const label = rank.label || '';
      if (rank.week && !label.includes(`Week ${rank.week}`)) bits.push(`Week ${rank.week}`);
      if (rank.date) bits.push(esc(shortDate(rank.date)));
      bits.push('ranked by NQS');
    }
    if (rank.kind === 'final' && rank.date) bits.push(esc(shortDate(rank.date)));
    const kicker = `<p class="pulse-kicker"><span>${esc(rank.label || 'National rankings')}</span>${bits.length ? ' · ' + bits.join(' · ') : ''}</p>`;
    if (rank.kind === 'upcoming' || (rank.message && !rank.teams.length)) {
      return `<h2>Top 25</h2>${kicker}<p class="pulse-empty">${esc(rank.message || 'Preseason poll coming soon')}</p>`;
    }
    if (!rank.teams.length) {
      return `<h2>Top 25</h2>${kicker}<p class="pulse-empty">Rankings are not available yet.</p>`;
    }
    const top = rank.teams.filter(t => (t.rank || 99) <= 25).slice(0, 25);
    const rest = rank.teams.slice(top.length);
    const metric = rank.metric === 'points' ? 'Pts' : (rank.metric || 'NQS');
    const linkSeason = rank.kind === 'final' && rank.seasonYear ? rank.seasonYear : season;
    const rows = teams => teams.map(t => {
      const tm = state.d1 && state.d1.byName.get(t.name);
      const href = tm ? teamHref(tm.slug, linkSeason) : null;
      const name = href ? `<a class="team-link" href="${esc(href)}" data-team="${esc(tm.slug)}" data-team-season="${linkSeason}">${esc(t.name)}</a>` : esc(t.name);
      const move = (rank.kind === 'rtn' || rank.kind === 'final') ? fmtMove(t.move) : (t.first_place ? `<span class="muted"> ${t.first_place} first-place</span>` : '');
      const stage = rank.kind === 'final' && t.stage && t.stage !== 'nqs'
        ? `<span class="rank-stage">${t.stage === 'championship' ? 'final' : t.stage}</span>` : '';
      const col = rank.kind === 'final' ? 'score' : (rank.metric === 'points' ? 'points' : 'nqs');
      return `<tr><td class="rk">${t.rank != null ? t.rank : ''}</td><td>${name}${move}${stage}</td><td class="num">${esc(metricCell(t, col))}</td></tr>`;
    }).join('');
    const colLabel = rank.kind === 'final' ? 'Score' : metric;
    const more = rest.length
      ? `<details id="rank-full"><summary>Show all ${rank.teams.length} teams</summary>
          <table class="rank-table"><thead><tr><th>Rk</th><th>Team</th><th class="num">${esc(colLabel)}</th></tr></thead><tbody>${rows(rest)}</tbody></table>
        </details>`
      : '';
    const note = rank.kind === 'final'
      ? `<p class="rank-note">Official NCAA championship order of finish, via Road to Nationals. Scores are the championship final, semifinal, or regional final; teams that did not make postseason follow in final regular-season NQS order. Movement is versus the final regular-season NQS rank.${rank.source_url ? ` <a href="${esc(rank.source_url)}" target="_blank" rel="noopener">Source</a>` : ''}</p>`
      : '';
    return `<h2>Top 25</h2>${kicker}
      <table class="rank-table"><thead><tr><th>Rk</th><th>Team</th><th class="num">${esc(colLabel)}</th></tr></thead><tbody>${rows(top)}</tbody></table>
      ${more}${note}`;
  }
  function personMeet(p) {
    const href = meetJumpHref(p.date, p.virtius);
    const when = p.date ? shortDate(p.date) : '';
    const meet = p.meet ? esc(p.meet) : 'Meet';
    const label = [when, meet].filter(Boolean).join(' · ');
    return href ? `<a class="jump" href="${esc(href)}" data-date="${esc(p.date || '')}" data-meet="${esc(p.virtius || '')}">${label}</a>` : esc(label);
  }
  function seasonHeroHtml(tens, aa, season) {
    const n = tens.length;
    const hasNew = tens.some(p => p.isNew);
    const items = p => `<li class="${p.isNew ? 'is-new' : ''}"><span class="who">${esc(p.athlete)}${p.isNew ? ' <span class="hero-new-badge">NEW</span>' : ''}</span><span class="meta"><span>${teamLink(p.team, season)} · ${esc(EVENT_LABEL[p.event] || p.event)}</span> ${personMeet(p)}</span><button type="button" class="share-mini" data-share-ten="${esc(tenKey(p))}" aria-label="Share ${esc(p.athlete)}'s perfect 10">Share</button></li>`;
    const highlight = tens.slice(0, 3).map(items).join('');
    const rest = tens.slice(3);
    const list = n
      ? `<ol class="hero-list" id="p10-highlights">${highlight}</ol>
         ${rest.length ? `<details id="p10-list"><summary>Show all ${n} perfect 10s</summary><ol class="hero-list">${tens.map(items).join('')}</ol></details>` : (n > 0 && n <= 3 ? '' : '')}`
      : `<p class="hero-empty">No perfect 10s yet this season — the first one will be celebrated right here.</p>`;
    const tenCol = `<div class="hero-10" id="perfect10s-card">
        <p class="hero-kicker">Perfect 10s</p>
        <div class="hero-10-top">
          <p class="ten-mark" aria-hidden="true">10.0</p>
          <div class="ten-count-wrap">
            <p class="ten-count">Perfect 10s: <strong>${n}</strong></p>
            <p class="ten-sub">${n ? `${n} official perfect 10${n === 1 ? '' : 's'} this season` : 'Waiting on the first 10.0 of the season'}</p>
          </div>
        </div>
        ${list}
      </div>`;
    let aaCol;
    if (!aa || aa.score == null || !aa.tied.length) {
      aaCol = `<div class="hero-aa" id="aa-card">
        <p class="hero-kicker"><span class="aa-crown" aria-hidden="true">👑</span>Highest all-around</p>
        <p class="hero-empty">No all-around scores yet this season. The first 4-event total will take this crown.</p>
      </div>`;
    } else {
      const listAa = aa.tied.map(p => `<p class="aa-who"><strong>${esc(p.athlete)}</strong> · ${teamLink(p.team, season)} · ${personMeet(p)}</p>`).join('');
      const tieNote = aa.tied.length > 1 ? `<p class="tie-note">Tied for the season high.</p>` : '';
      aaCol = `<div class="hero-aa" id="aa-card">
        <p class="hero-kicker"><span class="aa-crown" aria-hidden="true">👑</span>Highest all-around</p>
        <p class="aa-score">${fmtScore(aa.score)}</p>
        ${listAa}${tieNote}
      </div>`;
    }
    return `<div class="hero-banner${hasNew ? ' has-new' : ''}">
      <span class="sparkle"></span><span class="sparkle"></span><span class="sparkle"></span>
      <span class="sparkle"></span><span class="sparkle"></span><span class="sparkle"></span>
      <div class="hero-grid">${tenCol}${aaCol}</div>
    </div>`;
  }
  function teamRankHtml(team, season) {
    const block = state.rankings && state.rankings.seasons && state.rankings.seasons[season];
    const rank = pickRankings(block, season);
    const row = (rank.teams || []).find(t => t.name === team.name);
    if (!row) {
      return `<div class="profile-rank"><span class="rk-src">${esc(rank.message || 'Rankings are not available yet.')}</span></div>`;
    }
    if (rank.kind === 'final') {
      const yr = rank.seasonYear || (rank.date ? seasonFor(rank.date) : season);
      return `<div class="profile-rank"><span class="rk-num">No. ${row.rank}</span><span class="rk-src">${yr} final</span></div>`;
    }
    const move = rank.kind === 'rtn' ? fmtMove(row.move) : '';
    const src = rank.kind === 'preseason'
      ? (rank.label || 'Preseason Coaches Poll')
      : (rank.week ? `RTN Week ${rank.week}` : (rank.label || 'RTN National Rankings'));
    return `<div class="profile-rank"><span class="rk-num">No. ${row.rank}</span>${move}<span class="rk-src">${esc(src)}${rank.date ? ' · ' + esc(shortDate(rank.date)) : ''}</span></div>`;
  }

  // ---------- next meet ----------
  async function renderNextMeet() {
    const box = document.getElementById('next-meet');
    if (!box) return;
    const today = todayChicago();
    const season = seasonFor(today);
    const [main, cur] = await Promise.all([loadMain(), scheduleFor(season)]);
    const pool = [...((cur && cur.meets) || []), ...((main && main.meets) || [])];
    const seen = new Set();
    const stillOn = m => {
      if (m.date > today) return true;
      if (m.date < today) return false;
      const st = statusOf(m);
      if (st === 'FINAL' || st === 'PAST') return false;
      if (st === 'LIVE') return true;
      const start = m.start_utc ? Date.parse(m.start_utc) : null;
      return !start || nowMs() - start <= 6 * 3600e3;
    };
    const meets = pool.filter(m => { const k = meetKey(m); if (seen.has(k)) return false; seen.add(k); return stillOn(m); })
      .sort((a, b) => (a.date + (a.start_utc || '')).localeCompare(b.date + (b.start_utc || '')) || a.id - b.id);
    if (!meets.length) {
      const yr = (main && main.requested_season) || (main && main.season_published === false && main.season + 1) || seasonFor(addDays(today, 1));
      box.innerHTML = `<span class="nm-label">Next meet</span><span class="nm-body"><strong>${esc(yr)} schedule coming soon</strong> <span class="muted">· season starts in January</span></span>`;
      box.className = 'next-meet soon';
      return;
    }
    const day = meets[0].date;
    const sameDay = meets.filter(m => m.date === day);
    const first = sameDay[0];
    const isToday = day === today;
    const live = sameDay.some(m => statusOf(m) === 'LIVE');
    const more = sameDay.length - 1;
    const loc = (state.details[meetKey(first)] || {}).location || first.location || first.venue || '';
    const href = `${dateHref(day)}#meet=${encodeURIComponent(meetKey(first))}`;
    const label = live ? '<span class="badge live"><i class="dot"></i>LIVE NOW</span>' : `<span class="nm-label">${isToday ? 'Today' : 'Next meet'}</span>`;
    const when = `${isToday ? 'Today' : shortDate(day)} · ${esc(timeCT(first.start_utc))}`;
    box.className = `next-meet${live ? ' is-live' : ''}`;
    box.innerHTML = `${label}
      <a class="nm-body" href="${esc(href)}" data-nm-date="${day}" data-nm-key="${esc(meetKey(first))}">
        <strong>${esc(meetTitle(first))}</strong>
        <span class="nm-when">${when}${loc ? ` · ${esc(loc)}` : ''}</span>${more > 0 ? `<span class="nm-more">+${more} more that day</span>` : ''}
      </a>
      <a class="nm-go" href="${esc(href)}" data-nm-date="${day}" data-nm-key="${esc(meetKey(first))}">${live ? 'Watch scores' : 'Go to meet'} ›</a>`;
  }
  document.addEventListener('click', e => {
    const favAthEl = e.target.closest('[data-fav-athlete]');
    if (favAthEl) {
      e.preventDefault();
      e.stopPropagation();
      if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
      toggleFavAthlete(favAthEl.dataset.favTeam, favAthEl.dataset.favAthlete, {
        name: favAthEl.dataset.favName,
        athleteId: favAthEl.dataset.favId || null,
      });
      return;
    }
    const favEl = e.target.closest('[data-fav-toggle]');
    if (favEl) {
      e.preventDefault();
      e.stopPropagation();
      if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
      toggleFav(favEl.dataset.favToggle);
      return;
    }
    const filterEl = e.target.closest('[data-filter]');
    if (filterEl) {
      e.preventDefault();
      state.filter = filterEl.dataset.filter || 'all';
      render();
      return;
    }
    const tenShare = e.target.closest('[data-share-ten]');
    if (tenShare) {
      e.preventDefault();
      e.stopPropagation();
      const rec = (state.heroTens || []).find(p => tenKey(p) === tenShare.dataset.shareTen);
      if (rec) shareTen(rec);
      return;
    }
    const shareClose = e.target.closest('[data-share-close], #share-modal');
    if (e.target.id === 'share-modal' || e.target.closest('[data-share-close]')) {
      if (e.target.id === 'share-modal' || e.target.closest('[data-share-close]')) { closeShareModal(); return; }
    }
    const shareDl = e.target.closest('[data-share-dl]');
    if (shareDl) { e.preventDefault(); downloadSharePng(); return; }
    const shareSys = e.target.closest('[data-share-sys]');
    if (shareSys) { e.preventDefault(); systemShare(); return; }
    const shareCopy = e.target.closest('[data-share-copy]');
    if (shareCopy) { e.preventDefault(); copyShareLink(shareCopy); return; }
    if (e.target.id === 'poll-modal' || e.target.closest('[data-poll-close]')) {
      closePollModal();
      return;
    }
    const pollOpenBtn = e.target.closest('[data-poll-open]');
    if (pollOpenBtn) { e.preventDefault(); openPollModal(pollOpenBtn.dataset.pollOpen); return; }
    const pollRetry = e.target.closest('[data-poll-retry]');
    if (pollRetry) { e.preventDefault(); loadFanPolls(); return; }
    const pollOpt = e.target.closest('[data-poll-option]');
    if (pollOpt) {
      state.pollPicked = pollOpt.dataset.pollOption;
      state.pollVoteError = null;
      paintPollModal();
      return;
    }
    const pollLock = e.target.closest('[data-poll-lock]');
    if (pollLock) { e.preventDefault(); submitPollVote(); return; }
    const pollAll = e.target.closest('[data-poll-all]');
    if (pollAll) { e.preventDefault(); state.pollShowAll = !state.pollShowAll; paintPollModal(); return; }
    const coachMore = e.target.closest('[data-coaches-more]');
    if (coachMore) { e.preventDefault(); state.coachesShowAll = !state.coachesShowAll; render(); return; }
    const rosterSort = e.target.closest('[data-roster-sort]');
    if (rosterSort) {
      e.preventDefault();
      const key = rosterSort.dataset.rosterSort;
      const cur = state.rosterSort || { key: 'name', dir: 1 };
      state.rosterSort = { key, dir: cur.key === key ? -cur.dir : (key === 'name' || key === 'year' ? 1 : -1) };
      render();
      return;
    }
    const teamEl = e.target.closest('[data-team]');
    if (teamEl) {
      e.preventDefault();
      e.stopPropagation();
      const yr = teamEl.dataset.teamSeason ? Number(teamEl.dataset.teamSeason) : null;
      const ath = teamEl.dataset.athlete || (teamEl.dataset.team === state.team ? state.athlete : null);
      openTeam(teamEl.dataset.team, yr || undefined, ath || undefined);
      return;
    }
    const pulseJump = e.target.closest('#season-pulse a.jump[data-date], #season-hero a.jump[data-date]');
    if (pulseJump) {
      e.preventDefault();
      const key = pulseJump.dataset.meet;
      if (key) state.open.add(key);
      if (pulseJump.dataset.date) setDate(pulseJump.dataset.date, { keepOpen: true }).then(() => {
        if (key) {
          flashMeet(key);
          document.getElementById(`meet-${key}`)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
        }
      });
      return;
    }
    const a = e.target.closest('[data-nm-date]');
    if (!a) return;
    e.preventDefault();
    const key = a.dataset.nmKey;
    if (key) state.open.add(key);
    setDate(a.dataset.nmDate, { keepOpen: true }).then(() => {
      if (key) {
        flashMeet(key);
        const card = document.getElementById(`meet-${key}`);
        if (card) card.scrollIntoView({ block: 'start', behavior: 'smooth' });
      }
    });
  });

  // ---------- flow ----------
  async function setDate(ymd, { keepOpen = false } = {}) {
    const token = ++state.renderToken;
    if (state.team) closeTeam();
    state.date = ymd;
    if (!keepOpen) state.open.clear();
    await loadMain();
    const season = seasonFor(ymd);
    const sched = await scheduleFor(season);
    if (token !== state.renderToken) return;
    state.currentSchedule = sched;
    const regular = sched ? sched.meets.filter(m => m.date === ymd) : [];
    // Deep-linked sessions for this date (skip any already in the schedule).
    const keys = new Set(regular.map(m => m.virtius).filter(Boolean));
    const extra = (state.adhoc[ymd] || []).filter(m => m.date === ymd && !(m.virtius && keys.has(m.virtius)));
    state.meets = [...regular, ...extra];
    syncUrl();
    render();
    renderNextMeet();
    loadSeasonData().then(() => { if (token === state.renderToken) renderSeasonPulse(); });
    el.status.textContent = state.meets.length ? 'Loading scores…' : '';
    await pool(state.meets, 4, loadDetail);
    if (token !== state.renderToken) return;
    state.lastUpdate = new Date();
    render();
    renderNextMeet();
    schedulePoll();
  }

  function schedulePoll() {
    clearTimeout(state.timer);
    const hasVirtius = state.meets.some(m => m.virtius && shouldPoll(m));
    const hasRtn = state.meets.some(m => !m.virtius && shouldPoll(m));
    state.polling = !!(hasVirtius || hasRtn) && !state.team;
    if (!state.polling) return;
    state.timer = setTimeout(poll, hasVirtius ? POLL_MS : FALLBACK_POLL_MS);
  }
  let lastRtnPoll = 0;
  async function poll() {
    if (document.hidden) { schedulePoll(); return; }
    const token = state.renderToken;
    const now = Date.now();
    const due = state.meets.filter(m => shouldPoll(m) && (m.virtius || now - lastRtnPoll >= FALLBACK_POLL_MS - 1000));
    if (due.some(m => !m.virtius)) lastRtnPoll = now;
    await pool(due, 4, loadDetail);
    if (token !== state.renderToken) return;
    state.lastUpdate = new Date();
    render();
    renderNextMeet();
    renderSeasonPulse();
    schedulePoll();
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden && state.date) poll(); });

  // ---------- share cards ----------
  const SHARE_SITE = 'thefivegym.github.io/live-scoreboard';
  let sharePayload = null;
  function meetShareUrl(meet) {
    const p = new URLSearchParams();
    if (SEASON_OVERRIDE) p.set('season', String(SEASON_OVERRIDE));
    if (meet && meet.date) p.set('date', meet.date);
    const qs = p.toString();
    const key = meet ? meetKey(meet) : '';
    return `${location.origin}${location.pathname}${qs ? `?${qs}` : ''}${key ? `#meet=${encodeURIComponent(key)}` : ''}`;
  }
  function tenShareUrl(p) {
    const params = new URLSearchParams();
    const season = p.date ? seasonFor(p.date) : (SEASON_OVERRIDE || defaultSeason());
    if (season) params.set('season', String(season));
    if (p.date) params.set('date', p.date);
    const qs = params.toString();
    const hash = p.virtius ? `#meet=${encodeURIComponent(p.virtius)}` : '';
    return `${location.origin}${location.pathname}${qs ? `?${qs}` : ''}${hash}`;
  }
  function roundedRect(ctx, x, y, w, h, r) {
    const rad = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rad, y);
    ctx.arcTo(x + w, y, x + w, y + h, rad);
    ctx.arcTo(x + w, y + h, x, y + h, rad);
    ctx.arcTo(x, y + h, x, y, rad);
    ctx.arcTo(x, y, x + w, y, rad);
    ctx.closePath();
  }
  function wrapText(ctx, text, maxWidth) {
    const words = String(text || '').split(/\s+/).filter(Boolean);
    const lines = [];
    let line = '';
    for (const w of words) {
      const test = line ? `${line} ${w}` : w;
      if (ctx.measureText(test).width <= maxWidth) line = test;
      else { if (line) lines.push(line); line = w; }
    }
    if (line) lines.push(line);
    return lines.slice(0, 4);
  }
  function drawShareCard(kind, data) {
    const canvas = document.getElementById('share-canvas');
    if (!canvas) return null;
    const W = 1080, pad = 72;
    const gold = '#ffcf4a', ink = '#f8f4ff', muted = '#cfcaf5', bg = '#14112b';
    const rows = kind === 'ten' ? 1 : Math.max(1, ((data.teams || []).length));
    const H = kind === 'ten' ? 1080 : Math.max(780, 440 + rows * 88 + 200);
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);
    const grad = ctx.createLinearGradient(0, 0, W, H);
    grad.addColorStop(0, '#1c1735');
    grad.addColorStop(0.6, '#14112b');
    grad.addColorStop(1, '#2c2154');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = gold;
    ctx.fillRect(W * 0.18, 0, W * 0.64, 10);
    ctx.fillStyle = gold;
    ctx.font = '700 28px system-ui, -apple-system, Segoe UI, sans-serif';
    ctx.letterSpacing = '4px';
    ctx.fillText('THE FIVE THAT SCORE', pad, 88);
    ctx.letterSpacing = '0px';
    let y = 170;
    if (kind === 'ten') {
      ctx.fillStyle = muted;
      ctx.font = '800 26px system-ui, sans-serif';
      ctx.fillText('PERFECT 10', pad, y);
      y += 140;
      ctx.fillStyle = gold;
      ctx.font = '900 180px system-ui, sans-serif';
      ctx.fillText('10.000', pad, y);
      y += 90;
      ctx.fillStyle = ink;
      ctx.font = '800 56px system-ui, sans-serif';
      for (const line of wrapText(ctx, data.athlete, W - pad * 2)) { ctx.fillText(line, pad, y); y += 66; }
      ctx.fillStyle = muted;
      ctx.font = '600 36px system-ui, sans-serif';
      const ev = (EVENT_LABEL && EVENT_LABEL[data.event]) || data.event || '';
      ctx.fillText([data.team, ev].filter(Boolean).join('  ·  '), pad, y);
      y += 56;
      ctx.font = '500 30px system-ui, sans-serif';
      const when = [data.date ? shortDate(data.date) : '', data.meet].filter(Boolean).join('  ·  ');
      for (const line of wrapText(ctx, when, W - pad * 2)) { ctx.fillText(line, pad, y); y += 40; }
    } else {
      ctx.fillStyle = ink;
      ctx.font = '800 52px system-ui, sans-serif';
      const titleLines = wrapText(ctx, data.title || 'Meet', W - pad * 2);
      for (const line of titleLines) { ctx.fillText(line, pad, y); y += 60; }
      y += 8;
      ctx.fillStyle = gold;
      ctx.font = '800 28px system-ui, sans-serif';
      ctx.fillText((data.status || '').toUpperCase(), pad, y);
      ctx.fillStyle = muted;
      ctx.font = '600 28px system-ui, sans-serif';
      const when = [data.date ? shortDate(data.date) : '', data.time].filter(Boolean).join('  ·  ');
      ctx.fillText(when, pad + (data.status ? 160 : 0), y);
      y += 50;
      for (const t of (data.teams || [])) {
        roundedRect(ctx, pad, y, W - pad * 2, 76, 16);
        ctx.fillStyle = 'rgba(255,207,74,0.08)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,207,74,0.28)';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.fillStyle = muted;
        ctx.font = '700 28px system-ui, sans-serif';
        if (t.place) ctx.fillText(String(t.place), pad + 22, y + 48);
        ctx.fillStyle = ink;
        ctx.font = '700 34px system-ui, sans-serif';
        ctx.fillText(t.name || '', pad + 80, y + 48);
        if (t.score != null) {
          ctx.fillStyle = gold;
          ctx.font = '800 36px system-ui, sans-serif';
          ctx.textAlign = 'right';
          ctx.fillText(fmtScore(t.score), W - pad - 22, y + 48);
          ctx.textAlign = 'left';
        }
        y += 88;
      }
    }
    ctx.fillStyle = gold;
    ctx.font = '700 28px system-ui, sans-serif';
    ctx.fillText('@thefivethatscore', pad, H - 90);
    ctx.fillStyle = muted;
    ctx.font = '500 24px system-ui, sans-serif';
    ctx.fillText(SHARE_SITE, pad, H - 52);
    return canvas;
  }
  function filenameForShare(kind, data) {
    const slug = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    if (kind === 'ten') return `tfts-perfect10-${slug(data.athlete)}-${slug(data.event)}.png`;
    return `tfts-${slug((data.teams || []).map(t => t.name).slice(0, 3).join('-') || data.title)}-${data.date || 'meet'}.png`;
  }
  async function canvasPngBlob(canvas) {
    return await new Promise((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(new Error('png')), 'image/png'));
  }
  async function openShareModal(kind, data, url) {
    sharePayload = { kind, data, url };
    const modal = document.getElementById('share-modal');
    const sys = modal && modal.querySelector('[data-share-sys]');
    const copy = modal && modal.querySelector('[data-share-copy]');
    if (copy) copy.textContent = 'Copy link';
    drawShareCard(kind, data);
    if (sys) {
      const can = typeof navigator.share === 'function';
      sys.hidden = !can;
    }
    if (modal) {
      modal.hidden = false;
      modal.querySelector('.share-close')?.focus();
    }
  }
  function closeShareModal() {
    const modal = document.getElementById('share-modal');
    if (modal) modal.hidden = true;
    sharePayload = null;
  }
  function shareMeet(meet) {
    const d = state.details[meetKey(meet)];
    const status = statusOf(meet);
    const teams = (d && d.teams && d.teams.length)
      ? d.teams.map(t => ({ name: t.name, place: t.place, score: t.score }))
      : meetNames(meet).map(n => ({ name: n, place: null, score: null }));
    openShareModal('meet', {
      title: (d && d.name && meet.desc) ? meet.desc : meetTitle(meet),
      status, date: meet.date, time: formatMeetTime(meet.start_utc), teams,
    }, meetShareUrl(meet));
  }
  function shareTen(p) {
    openShareModal('ten', {
      athlete: p.athlete, team: p.team, event: p.event, date: p.date, meet: p.meet, score: 10,
    }, tenShareUrl(p));
  }
  async function downloadSharePng() {
    if (!sharePayload) return;
    const canvas = document.getElementById('share-canvas');
    const blob = await canvasPngBlob(canvas);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filenameForShare(sharePayload.kind, sharePayload.data);
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
  }
  async function systemShare() {
    if (!sharePayload || typeof navigator.share !== 'function') return;
    const canvas = document.getElementById('share-canvas');
    const blob = await canvasPngBlob(canvas);
    const file = new File([blob], filenameForShare(sharePayload.kind, sharePayload.data), { type: 'image/png' });
    const title = sharePayload.kind === 'ten'
      ? `${sharePayload.data.athlete} scores a Perfect 10 — The Five That Score`
      : `${sharePayload.data.title} — The Five That Score`;
    const payload = { title, text: title, url: sharePayload.url };
    try {
      if (navigator.canShare && navigator.canShare({ files: [file] })) await navigator.share({ ...payload, files: [file] });
      else await navigator.share(payload);
    } catch (e) {
      if (e && e.name === 'AbortError') return;
    }
  }
  async function copyShareLink(btn) {
    if (!sharePayload) return;
    const url = sharePayload.url;
    let ok = false;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(url);
        ok = true;
      }
    } catch { /* fall through */ }
    if (!ok) {
      const ta = document.createElement('textarea');
      ta.value = url;
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;left:-9999px;top:0';
      document.body.appendChild(ta);
      ta.select();
      try { ok = document.execCommand('copy'); } catch { ok = false; }
      ta.remove();
    }
    if (ok && btn) { btn.textContent = 'Copied!'; setTimeout(() => { if (btn.isConnected) btn.textContent = 'Copy link'; }, 1600); }
  }

  // ---------- events ----------
  el.meets.addEventListener('click', async e => {
    if (e.target.closest('[data-team], [data-fav-toggle], [data-fav-athlete], a.tv-badge')) return;
    const jump = e.target.closest('a.jump[data-date]');
    if (jump) { e.preventDefault(); setDate(jump.dataset.date); return; }
    const tab = e.target.closest('[data-tab]');
    if (tab) { state.tab[tab.dataset.meet] = tab.dataset.tab; render(); return; }
    const share = e.target.closest('[data-share]');
    if (share) {
      e.preventDefault();
      e.stopPropagation();
      const key = share.dataset.share;
      const meet = state.meets.find(m => meetKey(m) === key);
      if (meet) shareMeet(meet);
      return;
    }
    const tog = e.target.closest('[data-toggle]');
    if (tog) {
      const key = tog.dataset.toggle;
      if (state.open.has(key)) state.open.delete(key); else state.open.add(key);
      syncUrl(); render();
    }
  });
  el.prev.addEventListener('click', () => setDate(addDays(state.date, -1)));
  el.next.addEventListener('click', () => setDate(addDays(state.date, 1)));
  el.today.addEventListener('click', () => {
    if (demo) { goHome(); return; }
    setDate(todayChicago());
  });
  el.date.addEventListener('change', () => { if (isYmd(el.date.value)) setDate(el.date.value); });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeShareModal();
    const athStar = e.target.closest && e.target.closest('[data-fav-athlete]');
    if (athStar && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      toggleFavAthlete(athStar.dataset.favTeam, athStar.dataset.favAthlete, {
        name: athStar.dataset.favName,
        athleteId: athStar.dataset.favId || null,
      });
      return;
    }
    const star = e.target.closest && e.target.closest('[data-fav-toggle]');
    if (star && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      toggleFav(star.dataset.favToggle);
    }
  });
  window.addEventListener('hashchange', async () => {
    const k = readHashMeet();
    if (!k) return;
    if (state.meets.some(m => meetKey(m) === k)) {
      if (!state.open.has(k)) { state.open.add(k); render(); }
      document.getElementById(`meet-${k}`)?.scrollIntoView({ block: 'start' });
      return;
    }
    await openDeepLink(k);
  });

  // #meet=KEY for a meet that is not on the current date: find its date in the schedule,
  // else load the Virtius session directly and show it on its own date.
  async function openDeepLink(key) {
    await loadMain();
    const known = [...((state.main && state.main.meets) || []), ...Object.values(state.adhoc).flat()]
      .find(m => meetKey(m) === key);
    let date = known ? known.date : null;
    if (!date && isVirtiusKey(key)) {
      try { const m = await adhocMeet(key); if (m) date = m.date; } catch { /* handled below */ }
      if (!date) el.status.textContent = 'Could not load that Virtius session.';
    } else if (!date) {
      el.status.textContent = 'That meet link is not a valid Virtius session key.';
    }
    if (!date) return;
    state.open.add(key);
    flashMeet(key);
    await setDate(date, { keepOpen: true });
    document.getElementById(`meet-${key}`)?.scrollIntoView({ block: 'start' });
  }

  function closeChrome() {
    closeShareModal();
    closePollModal();
    const favBox = document.getElementById('fav-picker');
    const favBtn = document.getElementById('fav-picker-btn');
    if (favBox) favBox.hidden = true;
    if (favBtn) favBtn.setAttribute('aria-expanded', 'false');
    const teamList = document.getElementById('team-list');
    const teamSearch = document.getElementById('team-search');
    if (teamList) teamList.hidden = true;
    if (teamSearch) {
      teamSearch.value = '';
      teamSearch.setAttribute('aria-expanded', 'false');
    }
  }
  function homePath() {
    return new URL('./', document.baseURI).pathname;
  }
  function isCleanHomeUrl() {
    return !location.search && !location.hash;
  }
  async function goHome(ev) {
    if (ev) ev.preventDefault();
    const already = isCleanHomeUrl() && !demo && !NOW_OVERRIDE && !SEASON_OVERRIDE && !state.team && (state.filter || 'all') === 'all' && !state.open.size && state.date === todayChicago();
    if (!already) history.pushState(null, '', homePath());
    await resetToDefaultHome();
  }
  async function resetToDefaultHome() {
    demo = false;
    NOW_OVERRIDE = null;
    SEASON_OVERRIDE = null;
    if (el.banner) { el.banner.hidden = true; el.banner.innerHTML = ''; }
    closeChrome();
    state.filter = 'all';
    state.open.clear();
    state.tab = {};
    state.flashKey = null;
    closeTeam();
    document.title = 'The Five That Score — Live D1 Scoreboard';
    window.scrollTo(0, 0);
    await setDate(todayChicago());
  }
  async function applyFromUrl() {
    const p = new URLSearchParams(location.search);
    demo = p.has('demo');
    const now = p.get('now');
    NOW_OVERRIDE = /^\d{4}-\d{2}-\d{2}$/.test(now || '') ? now : null;
    const s = p.get('season');
    SEASON_OVERRIDE = /^\d{4}$/.test(s || '') ? Number(s) : null;
    if (demo) {
      el.banner.hidden = false;
      el.banner.innerHTML = `<strong>Demo mode</strong> — real 2026 data, so you can preview the scoreboard in the offseason.
      <a href="?demo&date=${DEMO.date}#meet=${DEMO.meet}">2026 NCAA final</a> ·
      <a href="?demo&date=${DEMO.regular}">Regular season (Feb 13)</a> ·
      <a href="?demo&date=${DEMO.conf}">Conference championships (Mar 21)</a> ·
      <a href="./">Exit demo</a>`;
    } else if (el.banner) {
      el.banner.hidden = true;
      el.banner.innerHTML = '';
    }
    closeChrome();
    state.filter = 'all';
    state.open.clear();
    state.flashKey = null;
    const qDate = p.get('date');
    const qTeam = (p.get('team') || '').toLowerCase();
    const qAthlete = (p.get('athlete') || '').toLowerCase();
    const qSeason = p.get('season');
    const seasonArg = qSeason && /^\d{4}$/.test(qSeason) ? Number(qSeason) : null;
    const start = isYmd(qDate) ? qDate : (demo ? DEMO.date : todayChicago());
    const hashMeet = readHashMeet() || (demo && !qDate && !qTeam ? DEMO.meet : null);
    if (hashMeet) state.open.add(hashMeet);
    if (qTeam) {
      await openTeam(qTeam, seasonArg, qAthlete || undefined);
    } else {
      closeTeam();
      await setDate(start, { keepOpen: !!hashMeet });
      if (hashMeet) {
        if (state.meets.some(m => meetKey(m) === hashMeet)) {
          flashMeet(hashMeet);
          document.getElementById(`meet-${hashMeet}`)?.scrollIntoView({ block: 'start' });
        } else {
          state.open.delete(hashMeet);
          await openDeepLink(hashMeet);
        }
      }
    }
  }
  document.getElementById('home-btn')?.addEventListener('click', goHome);
  document.getElementById('title-home')?.addEventListener('click', goHome);
  document.addEventListener('input', e => {
    if (e.target && e.target.id === 'poll-search') {
      state.pollFilter = e.target.value;
      paintPollModal();
    }
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && state.pollOpen) closePollModal();
  });
  window.addEventListener('popstate', () => { applyFromUrl(); });

  // ---------- boot ----------
  loadFavs();
  loadFavAthletes();
  if ('serviceWorker' in navigator) {
    const swUrl = new URL('sw.js', document.baseURI);
    navigator.serviceWorker.register(swUrl.href, { scope: new URL('./', document.baseURI).href }).catch(() => {});
  }
  setInterval(tickAgo, 1000);
  if (demo) {
    el.banner.hidden = false;
    el.banner.innerHTML = `<strong>Demo mode</strong> — real 2026 data, so you can preview the scoreboard in the offseason.
      <a href="?demo&date=${DEMO.date}#meet=${DEMO.meet}">2026 NCAA final</a> ·
      <a href="?demo&date=${DEMO.regular}">Regular season (Feb 13)</a> ·
      <a href="?demo&date=${DEMO.conf}">Conference championships (Mar 21)</a> ·
      <a href="./">Exit demo</a>`;
  }
  const qDate = params.get('date');
  const qTeam = (params.get('team') || '').toLowerCase();
  const qAthlete = (params.get('athlete') || '').toLowerCase();
  const qSeason = params.get('season');
  const seasonArg = qSeason && /^\d{4}$/.test(qSeason) ? Number(qSeason) : null;
  const start = isYmd(qDate) ? qDate : (demo ? DEMO.date : todayChicago());
  const hashMeet = readHashMeet() || (demo && !qDate && !qTeam ? DEMO.meet : null);
  if (hashMeet) state.open.add(hashMeet);
  loadTeams().then(() => { initTeamPicker(); initFavPicker(); if (state.date && !state.team) render(); }).catch(() => { initTeamPicker(); initFavPicker(); });
  loadSeasonData().then(() => { renderSeasonPulse(); if (state.team) render(); });
  if (qTeam) {
    openTeam(qTeam, seasonArg, qAthlete || undefined);
  } else {
    setDate(start, { keepOpen: true }).then(async () => {
      if (!hashMeet) return;
      if (state.meets.some(m => meetKey(m) === hashMeet)) { flashMeet(hashMeet); document.getElementById(`meet-${hashMeet}`)?.scrollIntoView({ block: 'start' }); }
      else { state.open.delete(hashMeet); await openDeepLink(hashMeet); }
    });
  }

  // Visit counter: show a number immediately (never hide it), then refresh from
  // Count API. Count once per browser session so the 30s refresh does not inflate it.
  (function trackVisits() {
    const elCount = document.getElementById('visit-count');
    if (!elCount) return;
    const FLOOR = 233;
    const base = 'https://countapi.mileshilliard.com/api/v1';
    const key = 'thefivegym-live-scoreboard-visits';
    const countedKey = 'tfts-visit-counted';
    const lastKey = 'tfts-visit-last';
    const format = n => `${n.toLocaleString('en-US')} visits`;
    const readLast = () => { try { return Number(localStorage.getItem(lastKey)); } catch { return 0; } };
    const saveLast = n => { try { localStorage.setItem(lastKey, String(n)); } catch { /* ignore */ } };
    const show = n => {
      const last = readLast();
      const v = Math.max(FLOOR, Number.isFinite(n) ? n : 0, Number.isFinite(last) ? last : 0);
      elCount.textContent = format(v);
      saveLast(v);
    };
    show();
    let already = false;
    try { already = sessionStorage.getItem(countedKey) === '1'; } catch { /* private mode */ }
    const url = already ? `${base}/get/${encodeURIComponent(key)}` : `${base}/hit/${encodeURIComponent(key)}`;
    fetch(url, { signal: AbortSignal.timeout(8000) }).then(r => {
      if (!r.ok) throw new Error(String(r.status));
      return r.json();
    }).then(data => {
      const n = Number(data && data.value);
      if (!Number.isFinite(n) || n < 1) return;
      if (!already) {
        try { sessionStorage.setItem(countedKey, '1'); } catch { /* ignore */ }
      }
      show(n);
    }).catch(() => { /* keep the fallback number and never break the scoreboard */ });
  })();
})();
