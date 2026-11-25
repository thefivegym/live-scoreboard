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
    today: $('#today'), banner: $('#banner'), status: $('#status-line'), pulse: $('#season-pulse'), hero: $('#season-hero'),
  };

  const params = new URLSearchParams(location.search);
  const demo = params.has('demo');
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
  };

  // ---------- utilities ----------
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = v => { if (v === null || v === undefined || v === '') return null; const n = Number(v); return Number.isFinite(n) && n > 0 ? n : null; };
  // Scores show 3 decimals, or 4 when the meet uses quarter-thousandths (e.g. 6-judge panels).
  let prec = 3;
  const needs4 = n => n !== null && n !== undefined && Math.round(n * 10000) % 10 !== 0;
  const fmtScore = n => n === null || n === undefined ? '—' : n.toFixed(Math.max(prec, needs4(n) ? 4 : 3));
  const precisionOf = d => (d && d.teams && d.teams.some(t => needs4(t.score) || t.rotations.some(r => needs4(r.score) || r.gymnasts.some(g => needs4(g.score))))) ? 4 : 3;
  const NOW_OVERRIDE = (() => { const v = new URLSearchParams(location.search).get('now'); return /^\d{4}-\d{2}-\d{2}$/.test(v || '') ? v : null; })();
  const SEASON_OVERRIDE = (() => { const v = new URLSearchParams(location.search).get('season'); return /^\d{4}$/.test(v || '') ? Number(v) : null; })();
  const todayChicago = () => NOW_OVERRIDE || new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const addDays = (ymd, n) => { const d = new Date(ymd + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const seasonFor = ymd => { const [y, m] = ymd.split('-').map(Number); return m >= 7 ? y + 1 : y; };
  const isYmd = s => /^\d{4}-\d{2}-\d{2}$/.test(s || '') && !Number.isNaN(Date.parse(s));
  const longDate = ymd => new Date(ymd + 'T12:00:00Z').toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  const shortDate = ymd => new Date(ymd + 'T12:00:00Z').toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' });
  const timeCT = iso => iso ? new Date(iso).toLocaleTimeString('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' }) + ' CT' : 'Time TBA';
  const meetKey = m => m.virtius || `rtn-${m.id}`;
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
      const qs = p.toString().replace(/^demo=&?/, 'demo&').replace(/demo=$/, 'demo');
      history.replaceState(null, '', `${location.pathname}?${qs}`);
      return;
    }
    if (state.date) p.set('date', state.date);
    const last = [...state.open].pop();
    const qs = p.toString().replace(/^demo=&?/, 'demo&').replace(/demo=$/, 'demo');
    const url = `${location.pathname}?${qs}${last ? `#meet=${last}` : ''}`;
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
    return { source: 'virtius', name: m.name, location: m.location, status, teams: rankTeams(out, status), leaderboards, rotation: curRot || null, single: out.length === 1 };
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
    return { source: 'rtn', name: null, location: null, status, teams: rankTeams(teams, status), leaderboards: lb, rotation: null, updated: r.generated_at };
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
    const rot = status === 'LIVE' && rotation ? `<span class="rot">R${rotation}</span>` : '';
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
      <li class="team-row">
        <span class="place">${r.place ? r.place : ''}</span>
        <span class="swatch" style="${r.color ? `background:${esc(r.color)}` : ''}"></span>
        <span class="tname">${teamLink(r.name)}${r.home ? ' <em class="home">home</em>' : ''}</span>
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
    return `<article class="card ${status.toLowerCase()} ${open ? 'open' : ''}${state.flashKey === key ? ' flash' : ''}" id="meet-${esc(key)}" data-key="${esc(key)}">
      <button class="card-head" aria-expanded="${open}" data-toggle="${esc(key)}">
        <div class="meta">
          <span class="time">${esc(timeCT(meet.start_utc))}</span>
          ${badge(status, d && d.rotation)}
        </div>
        <h2 class="mtitle">${esc(d && d.name && meet.desc ? meet.desc : meetTitle(meet))}</h2>
        <ul class="teams">${teamRows(meet, d)}</ul>
        <span class="chev" aria-hidden="true">${open ? '▴' : '▾'} ${open ? 'Hide' : 'Rotations & athletes'}</span>
      </button>
      ${open ? detailHtml(meet) : ''}
      <button class="share" data-share="${esc(key)}" title="Copy link to this meet" aria-label="Share link to this meet">🔗</button>
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
      renderTeamProfile(); return;
    }
    if (el.pulse) el.pulse.hidden = false;
    if (el.hero) el.hero.hidden = false;
    renderSeasonPulse();
    if (!state.meets.length) { el.meets.innerHTML = emptyHtml(); return; }
    const order = { LIVE: 0, UPCOMING: 1, FINAL: 2, PAST: 3 };
    const sorted = state.meets.slice().sort((a, b) => (order[statusOf(a)] - order[statusOf(b)]) || (a.start_utc || '').localeCompare(b.start_utc || ''));
    el.meets.innerHTML = sorted.map(cardHtml).join('');
    const live = state.meets.filter(m => statusOf(m) === 'LIVE').length;
    const stamp = state.lastUpdate ? `Updated ${state.lastUpdate.toLocaleTimeString('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit', second: '2-digit' })} CT` : '';
    el.status.innerHTML = `${state.meets.length} D1 meet${state.meets.length === 1 ? '' : 's'}${live ? ` · <strong class="livecount">${live} live</strong> · refreshing every 30s` : ''}${stamp ? ` · ${stamp}` : ''}`;
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
  function teamHref(slug, season) {
    const p = [];
    if (demo) p.push('demo');
    if (NOW_OVERRIDE) p.push(`now=${NOW_OVERRIDE}`);
    p.push(`team=${encodeURIComponent(slug)}`);
    if (season && season !== defaultSeason()) p.push(`season=${season}`);
    else if (SEASON_OVERRIDE && SEASON_OVERRIDE !== defaultSeason()) p.push(`season=${SEASON_OVERRIDE}`);
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

  async function openTeam(slug, season) {
    await Promise.all([loadMain(), loadTeams()]);
    const team = state.d1.bySlug.get(slug);
    if (!team) {
      el.status.textContent = 'That team was not found.';
      return;
    }
    const yr = season || defaultSeason();
    state.team = team.slug;
    state.teamSeason = yr;
    if (!state.date) state.date = todayChicago();
    clearTimeout(state.timer);
    document.title = `${team.name} — The Five That Score`;
    ++state.renderToken;
    const token = state.renderToken;
    state.teamLists = await teamMeetLists(team.name, yr);
    if (token !== state.renderToken) return;
    syncUrl();
    render();
    renderNextMeet();
    const { upcoming, past } = state.teamLists;
    await pool([...past, ...upcoming.slice(0, 6)], 4, loadDetail);
    if (token !== state.renderToken || state.team !== team.slug) return;
    render();
  }
  function closeTeam() {
    state.team = null;
    state.teamSeason = null;
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

  function renderTeamProfile() {
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
          <h2>${esc(team.name)}</h2>
          <p class="muted">${esc(team.conference)}${team.conference ? ' · ' : ''}<span class="season-tag">${esc(String(pastYear || state.teamSeason))} season</span>${upcomingYear && upcomingYear !== pastYear && upcoming.length ? ` · ${esc(String(upcomingYear))} upcoming` : ''}</p>
          ${seasonNote ? `<p class="season-switch">${seasonNote}</p>` : ''}
        </div>
      </header>
      ${teamRankHtml(team, state.teamSeason)}
      ${stats}
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
    const close = () => { list.hidden = true; input.setAttribute('aria-expanded', 'false'); active = -1; };
    const open = () => { list.hidden = false; input.setAttribute('aria-expanded', 'true'); };
    const items = () => [...list.querySelectorAll('[role="option"]')];
    const paint = () => {
      const q = input.value.trim().toLowerCase();
      const teams = (state.d1 && state.d1.teams) || [];
      const filtered = teams.filter(t => !q || t.name.toLowerCase().includes(q) || t.abbr.toLowerCase().includes(q) || t.slug.includes(q) || (t.conference || '').toLowerCase().includes(q));
      list.innerHTML = filtered.length ? filtered.map(t => `<li role="option" data-team="${esc(t.slug)}" id="opt-${esc(t.slug)}">
        <span class="crest tiny" style="background:${esc(t.color)};color:${esc(crestInk(t))}">${esc(t.abbr)}</span>
        <span class="opt-name">${esc(t.name)}</span>
        <span class="opt-con muted">${esc(t.conference)}</span>
      </li>`).join('') : `<li class="muted" aria-disabled="true">No teams match “${esc(input.value)}”</li>`;
      open();
      active = filtered.length ? 0 : -1;
      highlight();
    };
    const highlight = () => {
      items().forEach((it, i) => it.setAttribute('aria-selected', i === active ? 'true' : 'false'));
      const cur = items()[active];
      if (cur) { input.setAttribute('aria-activedescendant', cur.id); cur.scrollIntoView({ block: 'nearest' }); }
    };
    const choose = slug => { close(); input.value = ''; input.blur(); if (slug) openTeam(slug); };
    input.addEventListener('focus', () => { if (state.d1) paint(); });
    input.addEventListener('input', paint);
    input.addEventListener('keydown', e => {
      const opts = items().filter(it => it.dataset.team);
      if (e.key === 'ArrowDown') { e.preventDefault(); if (list.hidden) paint(); active = Math.min(opts.length - 1, active + 1); highlight(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); active = Math.max(0, active - 1); highlight(); }
      else if (e.key === 'Enter') { e.preventDefault(); if (opts[active]) choose(opts[active].dataset.team); }
      else if (e.key === 'Escape') { close(); }
    });
    list.addEventListener('mousedown', e => {
      const it = e.target.closest('[data-team]');
      if (it) { e.preventDefault(); choose(it.dataset.team); }
    });
    document.addEventListener('click', e => {
      if (!e.target.closest('.team-picker')) close();
    });
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
      el.hero.innerHTML = `${preview}${viewLast}${seasonHeroHtml(tens, aa, season)}`;
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
    const items = p => `<li class="${p.isNew ? 'is-new' : ''}"><span class="who">${esc(p.athlete)}${p.isNew ? ' <span class="hero-new-badge">NEW</span>' : ''}</span><span class="meta"><span>${teamLink(p.team, season)} · ${esc(EVENT_LABEL[p.event] || p.event)}</span> ${personMeet(p)}</span></li>`;
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
    const teamEl = e.target.closest('[data-team]');
    if (teamEl) {
      e.preventDefault();
      e.stopPropagation();
      const yr = teamEl.dataset.teamSeason ? Number(teamEl.dataset.teamSeason) : null;
      openTeam(teamEl.dataset.team, yr || undefined);
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
    if (!hasVirtius && !hasRtn) return;
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

  // ---------- events ----------
  el.meets.addEventListener('click', async e => {
    if (e.target.closest('[data-team]')) return; // handled on document
    const jump = e.target.closest('a.jump[data-date]');
    if (jump) { e.preventDefault(); setDate(jump.dataset.date); return; }
    const tab = e.target.closest('[data-tab]');
    if (tab) { state.tab[tab.dataset.meet] = tab.dataset.tab; render(); return; }
    const share = e.target.closest('[data-share]');
    if (share) {
      const key = share.dataset.share;
      const url = `${location.origin}${location.pathname}?${demo ? 'demo&' : ''}date=${state.date}#meet=${key}`;
      try {
        if (navigator.share && matchMedia('(pointer:coarse)').matches) await navigator.share({ title: 'Live D1 gymnastics — The Five That Score', url });
        else { await navigator.clipboard.writeText(url); share.textContent = '✓'; setTimeout(() => { share.textContent = '🔗'; }, 1500); }
      } catch { /* user cancelled */ }
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
    if (demo) { location.href = location.pathname; return; }
    setDate(todayChicago());
  });
  el.date.addEventListener('change', () => { if (isYmd(el.date.value)) setDate(el.date.value); });
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

  // ---------- boot ----------
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
  const qSeason = params.get('season');
  const seasonArg = qSeason && /^\d{4}$/.test(qSeason) ? Number(qSeason) : null;
  const start = isYmd(qDate) ? qDate : (demo ? DEMO.date : todayChicago());
  const hashMeet = readHashMeet() || (demo && !qDate && !qTeam ? DEMO.meet : null);
  if (hashMeet) state.open.add(hashMeet);
  loadTeams().then(() => { initTeamPicker(); if (state.date && !state.team) render(); }).catch(() => initTeamPicker());
  loadSeasonData().then(() => { renderSeasonPulse(); if (state.team) render(); });
  if (qTeam) {
    openTeam(qTeam, seasonArg);
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
