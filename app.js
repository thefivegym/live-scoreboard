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
  const meetKey = m => m.virtius || `rtn-${m.id}`;

  async function getJson(url, opts = {}) {
    const res = await fetch(url, { cache: 'no-store', ...opts });
    if (!res.ok) throw new Error(`${res.status} ${url}`);
    return res.json();
  }

  // ---------- URL state ----------
  function readHashMeet() {
    const m = location.hash.match(/meet=([A-Za-z0-9_-]+)/);
    return m ? m[1] : null;
  }
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
    return { source: 'virtius', name: m.name, location: m.location, status, teams: rankTeams(out, status), leaderboards, rotation: curRot || null };
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
      rows = d.teams.map(t => ({ name: t.name, home: t.home, score: t.score, place: d.status === 'UPCOMING' ? null : t.place, color: t.color }));
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
      ${d.teams.map(t => `<tr><th scope="row"><span class="swatch" style="${t.color ? `background:${esc(t.color)}` : ''}"></span>${esc(t.tricode || t.name)}</th>${cols.map(c => {
        const r = t.rotations.find(x => x.rotation === c);
        if (!r) return '<td class="bye">bye</td>';
        const ev = EVENTS.find(e => e.key === r.event);
        return `<td class="${r.started && !r.complete ? 'inprog' : ''}"><span class="ev">${esc(ev ? ev.abbr : r.event)}</span><span class="sc">${r.score ? fmtScore(r.score) : (r.partial ? `<i title="running">${fmtScore(r.partial)}</i>` : '—')}</span></td>`;
      }).join('')}<td class="tot">${fmtScore(t.score)}</td></tr>`).join('')}
    </tbody></table></div>`;
  }

  function eventPanel(d, evKey) {
    if (evKey === 'aa') return leaderboard(d.leaderboards.aa, 'All-around', 2) || '<p class="muted">No all-around scores yet.</p>';
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
    return `<div class="lineups">${blocks || '<p class="muted">No lineups yet.</p>'}</div>${leaderboard(d.leaderboards[evKey], `${ev.label} leaders`, 1) || ''}`;
  }

  function leaderboard(list, title, minScoreForAA) {
    if (!list || !list.length) return '';
    const top = list.slice(0, 10);
    return `<div class="leaders"><h4>${esc(title)}</h4><ol class="lb">${top.map(g => `
      <li><span class="ord">${g.place ?? ''}</span><span class="gname">${esc(g.name)} <span class="muted">${esc(g.team || '')}</span></span><span class="gscore">${fmtScore(g.score)}</span></li>`).join('')}</ol></div>`;
  }

  function detailHtml(meet) {
    const key = meetKey(meet);
    const d = state.details[key];
    const links = [
      meet.virtius ? `<a href="${esc(VIRTIUS_PAGE(meet.virtius))}" target="_blank" rel="noopener">Virtius live stats</a>` : (meet.stats_link ? `<a href="${esc(meet.stats_link)}" target="_blank" rel="noopener">Live stats</a>` : ''),
      meet.video_link ? `<a href="${esc(meet.video_link)}" target="_blank" rel="noopener">Watch${meet.video_desc ? ` (${esc(meet.video_desc)})` : ''}</a>` : '',
      `<a href="${esc(meet.rtn_url)}" target="_blank" rel="noopener">Road to Nationals</a>`,
    ].filter(Boolean).join(' · ');
    if (!d || d.error || !d.teams || !d.teams.length || d.status === 'UPCOMING' && !d.teams.some(t => t.rotations.some(r => r.gymnasts.length))) {
      const msg = d && d.error ? 'Scores unavailable right now.' : (meet.virtius ? 'Scores will appear here once the meet starts.' : (statusOf(meet) === 'PAST' ? 'This meet was not scored on Virtius; see the links for results.' : 'This meet is not on Virtius; results refresh from Road to Nationals about every 10 minutes once it starts.'));
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
    el.status.innerHTML = `${state.meets.length} D1 meet${state.meets.length === 1 ? '' : 's'}${live ? ` · <strong class="livecount">${live} live</strong> · refreshing every 30s` : ''}${stamp ? ` · ${stamp}` : ''}`;
  }

  function emptyHtml() {
    el.status.textContent = '';
    const sched = state.currentSchedule;
    const main = state.main;
    const dateLink = (ymd, label) => `<a class="jump" href="${dateHref(ymd)}" data-date="${ymd}">${esc(label || shortDate(ymd))}</a>`;
    let html = `<div class="empty"><h2>No D1 meets on ${esc(shortDate(state.date))}</h2>`;
    const src = sched || main;
    const dates = src ? [...new Set(src.meets.map(m => m.date))].sort() : [];
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

  function dateHref(ymd) { return `?${demo ? 'demo&' : ''}date=${ymd}`; }

  // ---------- flow ----------
  async function setDate(ymd, { keepOpen = false } = {}) {
    const token = ++state.renderToken;
    state.date = ymd;
    if (!keepOpen) state.open.clear();
    await loadMain();
    const season = seasonFor(ymd);
    const sched = await scheduleFor(season);
    if (token !== state.renderToken) return;
    state.currentSchedule = sched;
    state.meets = sched ? sched.meets.filter(m => m.date === ymd) : [];
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
  window.addEventListener('hashchange', () => {
    const k = readHashMeet();
    if (k && !state.open.has(k)) { state.open.add(k); render(); document.getElementById(`meet-${k}`)?.scrollIntoView({ block: 'start' }); }
  });

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
  setDate(start, { keepOpen: true }).then(() => {
    if (hashMeet) document.getElementById(`meet-${hashMeet}`)?.scrollIntoView({ block: 'start' });
  });
})();
