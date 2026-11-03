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
  // Intrasquad squads share one school's tricode/colour, so colour them by squad name.
  const SQUAD_COLORS = {
    maroon: '#7a0019', gold: '#f2b705', crimson: '#9e1b32', white: '#b9b6c8', red: '#d1213b', blue: '#1f5bd6',
    navy: '#1b2a57', orange: '#f26b1d', black: '#2b2b2b', purple: '#6b2fa3', green: '#1d8a4b', gray: '#7d8088',
    grey: '#7d8088', silver: '#a7a9ac', pink: '#e0569b', cardinal: '#9d2235', scarlet: '#c4001f', garnet: '#73000a',
    teal: '#008c95', yellow: '#f5c400', cream: '#cbb994', brown: '#6b4226', ghosts: '#8f8aa8', goblins: '#2f9e44',
  };
  const SQUAD_PALETTE = ['#3a6df0', '#e5243b', '#1d8a4b', '#f2a20d', '#6b2fa3', '#008c95'];

  const $ = sel => document.querySelector(sel);
  const el = {
    meets: $('#meets'), date: $('#date'), dateText: $('#date-text'), prev: $('#prev'), next: $('#next'),
    today: $('#today'), banner: $('#banner'), status: $('#status-line'),
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
    iq: null,             // preseason intrasquads (hand list + discovered keys)
    adhoc: {},            // date -> meets built from a #meet=KEY deep link
  };

  // ---------- utilities ----------
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = v => { if (v === null || v === undefined || v === '') return null; const n = Number(v); return Number.isFinite(n) && n > 0 ? n : null; };
  // Scores show 3 decimals, or 4 when the meet uses quarter-thousandths (e.g. 6-judge panels).
  let prec = 3;
  const needs4 = n => n !== null && n !== undefined && Math.round(n * 10000) % 10 !== 0;
  const fmtScore = n => n === null || n === undefined ? '—' : n.toFixed(Math.max(prec, needs4(n) ? 4 : 3));
  const precisionOf = d => (d && d.teams && d.teams.some(t => needs4(t.score) || t.rotations.some(r => needs4(r.score) || r.gymnasts.some(g => needs4(g.score))))) ? 4 : 3;
  const todayChicago = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const addDays = (ymd, n) => { const d = new Date(ymd + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const seasonFor = ymd => { const [y, m] = ymd.split('-').map(Number); return m >= 7 ? y + 1 : y; };
  const isYmd = s => /^\d{4}-\d{2}-\d{2}$/.test(s || '') && !Number.isNaN(Date.parse(s));
  const longDate = ymd => new Date(ymd + 'T12:00:00Z').toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  const shortDate = ymd => new Date(ymd + 'T12:00:00Z').toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' });
  const timeCT = iso => iso ? new Date(iso).toLocaleTimeString('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' }) + ' CT' : 'Time TBA';
  const meetKey = m => m.virtius || (m.intrasquad ? `iq-${m.id}` : `rtn-${m.id}`);
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
    p.set('date', state.date);
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
    try { state.schedules[season] = await getJson(`data/seasons/${season}.json`); }
    catch { state.schedules[season] = null; }
    return state.schedules[season];
  }

  // ---------- intrasquads (preseason) ----------
  // data/intrasquads.json is hand-maintained; data/intrasquads-discovered.json is written by
  // scripts/discover-intrasquads.mjs. A key in the hand-maintained file always wins.
  function intrasquadMeet(e) {
    const school = e.school || 'Intrasquad';
    const ev = (e.event || '').trim();
    // Discovered sessions with no hand-listed event keep the Virtius meet name as-is.
    const title = !ev ? `${school} Intrasquad` : ((e.virtius_name && !e.matched_id) || ev.toLowerCase().includes(school.toLowerCase()) ? ev : `${school} ${ev}`);
    const key = e.virtius && isVirtiusKey(e.virtius) ? e.virtius : null;
    return {
      id: e.id, date: e.date, intrasquad: true,
      start_utc: e.start_utc || (e.time_local ? zonedToUtcIso(e.date, e.time_local, e.tz || TZ) : null),
      desc: title, school, home: [school], away: [], d1_teams: [school],
      virtius: key, stats_link: key ? VIRTIUS_PAGE(key) : null,
      video_link: e.video_link || null, video_desc: e.video_desc || null,
      rtn_url: null, source_url: e.source_url || null,
    };
  }
  async function loadIntrasquads() {
    if (state.iq) return state.iq;
    const [seed, found] = await Promise.all([
      getJson('data/intrasquads.json').catch(() => null),
      getJson('data/intrasquads-discovered.json').catch(() => null),
    ]);
    const list = ((seed && seed.events) || []).filter(e => e && isYmd(e.date)).map(e => ({ ...e }));
    ((found && found.events) || []).forEach(f => {
      if (!f || !isVirtiusKey(f.virtius) || !isYmd(f.date)) return;
      if (list.some(e => e.virtius === f.virtius)) return;
      const m = list.find(e => (f.matched_id && e.id === f.matched_id) || (e.school === f.school && e.date === f.date));
      if (m) { if (!m.virtius) { m.virtius = f.virtius; m.skip = false; } }
      else list.push({ ...f, skip: false });
    });
    // Exhibitions / un-scored events stay hidden unless a Virtius key turns up for them.
    state.iq = list.filter(e => !e.skip || e.virtius).map(intrasquadMeet);
    return state.iq;
  }
  // A Virtius session is an intrasquad when all its teams share one school (team_id / tricode).
  function isIntrasquadSession(m) {
    const teams = (m && m.teams) || [];
    if (!teams.length) return false;
    return new Set(teams.map(t => String(t.team_id || t.tricode || ''))).size === 1;
  }
  function squadColors(teams) {
    const used = new Set();
    teams.forEach((t, i) => {
      const words = String(t.name || '').toLowerCase().split(/[^a-z]+/);
      let c = words.map(w => SQUAD_COLORS[w]).find(Boolean);
      if (!c || used.has(c)) c = SQUAD_PALETTE.find(p => !used.has(p)) || SQUAD_PALETTE[i % SQUAD_PALETTE.length];
      used.add(c); t.color = c;
    });
  }
  // Deep link to a Virtius session that is not in any schedule: build a meet from the session itself.
  async function adhocMeet(key) {
    if (!isVirtiusKey(key)) return null;
    const j = await getJson(VIRTIUS_API(key));
    const m = j && j.meet;
    if (!m || !m.teams) return null;
    const iq = isIntrasquadSession(m);
    const date = isYmd(m.meet_date) ? m.meet_date : todayChicago();
    const names = m.teams.map(t => t.name).filter(Boolean);
    const meet = {
      id: `adhoc-${key}`, date, adhoc: true, intrasquad: iq, start_utc: null,
      desc: m.name || (iq ? 'Intrasquad' : names.join(' vs ')), school: iq ? (m.teams[0].tricode || '') : '',
      home: iq ? [] : m.teams.filter(t => t.home_team).map(t => t.name), away: iq ? [] : m.teams.filter(t => !t.home_team).map(t => t.name),
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
    const intrasquad = isIntrasquadSession(m) || !!(meet && meet.intrasquad);
    if (intrasquad) { out.forEach(t => { t.home = false; }); squadColors(out); }
    return { source: 'virtius', name: m.name, location: m.location, status, teams: rankTeams(out, status), leaderboards, rotation: curRot || null, intrasquad, single: out.length === 1 };
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
    if (!any) return 'UPCOMING';
    if (allDone) return 'FINAL';
    const start = meet && meet.start_utc ? Date.parse(meet.start_utc) : null;
    if (meet && meet.date < todayChicago()) return 'FINAL';
    if (start && Date.now() - start > 6 * 3600e3) return 'FINAL';
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
    if (meet.date < todayChicago() || (start && Date.now() - start > 6 * 3600e3)) return 'PAST';
    return 'UPCOMING';
  }
  function shouldPoll(meet) {
    const s = statusOf(meet);
    if (s === 'LIVE') return true;
    if (s !== 'UPCOMING') return false;
    const start = meet.start_utc ? Date.parse(meet.start_utc) : null;
    // Intrasquads / deep-linked sessions often have no start time: watch them all day.
    if (!start && meet.virtius && (meet.intrasquad || meet.adhoc)) return meet.date === todayChicago();
    // A meet becomes LIVE once its first score posts, so keep checking from 15 min before start.
    return !!start && Date.now() >= start - 15 * 60e3 && Date.now() <= start + 6 * 3600e3;
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
    } else if (meet.intrasquad) {
      rows = [{ name: meet.school || meetTitle(meet), home: false }];
    } else {
      rows = [...meet.away.map(n => ({ name: n, home: false })), ...meet.home.map(n => ({ name: n, home: true }))];
    }
    return rows.map(r => `
      <li class="team-row">
        <span class="place">${r.place ? r.place : ''}</span>
        <span class="swatch" style="${r.color ? `background:${esc(r.color)}` : ''}"></span>
        <span class="tname">${esc(r.name)}${r.home ? ' <em class="home">home</em>' : ''}</span>
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
      ${d.teams.map(t => `<tr><th scope="row"><span class="swatch" style="${t.color ? `background:${esc(t.color)}` : ''}"></span>${esc(d.intrasquad ? t.name : (t.tricode || t.name))}</th>${cols.map(c => {
        // Usually one event per rotation; intrasquads sometimes run two events in one rotation.
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
        meet.intrasquad ? (statusOf(meet) === 'PAST' ? 'No Virtius live scoring was found for this intrasquad.' : 'Preseason intrasquad. Live scores appear here if the school posts a Virtius link (checked automatically).') : (statusOf(meet) === 'PAST' ? 'This meet was not scored on Virtius; see the links for results.' : 'This meet is not on Virtius; results refresh from Road to Nationals about every 10 minutes once it starts.'));
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
    return `<article class="card ${status.toLowerCase()} ${open ? 'open' : ''}" id="meet-${esc(key)}" data-key="${esc(key)}">
      <button class="card-head" aria-expanded="${open}" data-toggle="${esc(key)}">
        <div class="meta">
          <span class="time">${esc(timeCT(meet.start_utc))}</span>
          ${badge(status, d && d.rotation)}
          ${meet.intrasquad || (d && d.intrasquad) ? '<span class="badge iq">Intrasquad</span>' : ''}
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
    el.dateText.textContent = matchMedia('(max-width: 430px)').matches ? shortDate(state.date) + ', ' + state.date.slice(0, 4) : longDate(state.date);
    el.date.value = state.date;
    const t = todayChicago();
    el.today.hidden = state.date === t && !demo;
    if (!state.meets.length) { el.meets.innerHTML = emptyHtml(); return; }
    const order = { LIVE: 0, UPCOMING: 1, FINAL: 2, PAST: 3 };
    const sorted = state.meets.slice().sort((a, b) => (order[statusOf(a)] - order[statusOf(b)]) || (a.start_utc || '').localeCompare(b.start_utc || ''));
    el.meets.innerHTML = sorted.map(cardHtml).join('');
    const live = state.meets.filter(m => statusOf(m) === 'LIVE').length;
    const stamp = state.lastUpdate ? `Updated ${state.lastUpdate.toLocaleTimeString('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit', second: '2-digit' })} CT` : '';
    el.status.innerHTML = `${state.meets.length} ${state.meets.every(m => m.intrasquad || (state.details[meetKey(m)] || {}).intrasquad) ? 'intrasquad' : 'D1'} meet${state.meets.length === 1 ? '' : 's'}${live ? ` · <strong class="livecount">${live} live</strong> · refreshing every 30s` : ''}${stamp ? ` · ${stamp}` : ''}`;
  }

  function emptyHtml() {
    el.status.textContent = '';
    const sched = state.currentSchedule;
    const main = state.main;
    const dateLink = (ymd, label) => `<a class="jump" href="${dateHref(ymd)}" data-date="${ymd}">${esc(label || shortDate(ymd))}</a>`;
    let html = `<div class="empty"><h2>No D1 meets on ${esc(shortDate(state.date))}</h2>`;
    const src = sched || main;
    const dates = [...new Set([...(src ? src.meets : []), ...(state.iq || []), ...Object.values(state.adhoc).flat()].map(m => m.date))].sort();
    const next = dates.find(d => d > state.date);
    const prev = [...dates].reverse().find(d => d < state.date);
    if (next) html += `<p>Next meet day: ${dateLink(next, longDate(next))}</p>`;
    if (!next) {
      const season = seasonFor(state.date);
      if (main && main.season_published === false && main.requested_season >= season && !(state.iq || []).some(m => m.date > state.date)) {
        html += `<p>Road to Nationals hasn't published the ${main.requested_season} schedule yet. The season usually starts in early January — check back soon.</p>`;
      } else if (!sched) {
        html += `<p>No schedule data for the ${season} season.</p>`;
      }
      html += `<p>Preview the scoreboard with real data: <a class="jump" href="?demo">2026 NCAA Championship final</a> · <a class="jump" href="?demo&date=${DEMO.regular}">a 2026 regular-season Friday</a></p>`;
    }
    if (prev) html += `<p class="muted">Previous meet day: ${dateLink(prev, longDate(prev))}</p>`;
    return html + '</div>';
  }

  function dateHref(ymd) { return `?${demo ? 'demo&' : ''}date=${ymd}`; }

  // ---------- flow ----------
  async function setDate(ymd, { keepOpen = false } = {}) {
    const token = ++state.renderToken;
    state.date = ymd;
    if (!keepOpen) state.open.clear();
    await loadMain();
    const season = seasonFor(ymd);
    const [sched, iq] = await Promise.all([scheduleFor(season), loadIntrasquads()]);
    if (token !== state.renderToken) return;
    state.currentSchedule = sched;
    const regular = sched ? sched.meets.filter(m => m.date === ymd) : [];
    // Preseason intrasquads + deep-linked sessions for this date (skip any already in the schedule).
    const keys = new Set(regular.map(m => m.virtius).filter(Boolean));
    const extra = [];
    [...iq, ...(state.adhoc[ymd] || [])].forEach(m => {
      if (m.date !== ymd || (m.virtius && keys.has(m.virtius))) return;
      if (m.virtius) keys.add(m.virtius);
      extra.push(m);
    });
    state.meets = [...regular, ...extra];
    syncUrl();
    render();
    el.status.textContent = state.meets.length ? 'Loading scores…' : '';
    await pool(state.meets, 4, loadDetail);
    if (token !== state.renderToken) return;
    state.lastUpdate = new Date();
    render();
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
    schedulePoll();
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden && state.date) poll(); });

  // ---------- events ----------
  el.meets.addEventListener('click', async e => {
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

  // #meet=KEY for a meet that is not on the current date: find its date in the schedule or the
  // intrasquad list, else load the Virtius session directly and show it on its own date.
  async function openDeepLink(key) {
    await Promise.all([loadMain(), loadIntrasquads()]);
    const known = [...((state.main && state.main.meets) || []), ...(state.iq || []), ...Object.values(state.adhoc).flat()]
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
  const start = isYmd(qDate) ? qDate : (demo ? DEMO.date : todayChicago());
  const hashMeet = readHashMeet() || (demo && !qDate ? DEMO.meet : null);
  if (hashMeet) state.open.add(hashMeet);
  setDate(start, { keepOpen: true }).then(async () => {
    if (!hashMeet) return;
    if (state.meets.some(m => meetKey(m) === hashMeet)) document.getElementById(`meet-${hashMeet}`)?.scrollIntoView({ block: 'start' });
    else { state.open.delete(hashMeet); await openDeepLink(hashMeet); }
  });
})();
