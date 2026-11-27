import { POLLS, CATALOG_META } from './catalog.js';

const POLL_IDS = new Set(POLLS.map(p => p.id));

function corsHeaders(request) {
  const origin = request.headers.get('Origin') || '';
  const allow = originAllowed(origin) ? origin : '';
  const headers = {
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Voter-Id',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
    'Cache-Control': 'no-store',
  };
  if (allow) headers['Access-Control-Allow-Origin'] = allow;
  return headers;
}

function originAllowed(origin) {
  if (!origin) return false;
  if (origin === 'https://thefivegym.github.io') return true;
  return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin);
}

function json(body, cors, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...cors },
  });
}

async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

function clientIp(request) {
  return request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() || '';
}

async function getSalt(env) {
  if (env.VOTE_SALT) return env.VOTE_SALT;
  const row = await env.DB.prepare("SELECT value FROM meta WHERE key = 'vote_salt'").first();
  if (row && row.value) return row.value;
  const generated = [...crypto.getRandomValues(new Uint8Array(32))].map(b => b.toString(16).padStart(2, '0')).join('');
  await env.DB.prepare("INSERT OR IGNORE INTO meta (key, value) VALUES ('vote_salt', ?)").bind(generated).run();
  const saved = await env.DB.prepare("SELECT value FROM meta WHERE key = 'vote_salt'").first();
  return saved.value;
}

async function voterIdHash(env, pollId, voterId) {
  return sha256Hex(`${await getSalt(env)}|vid|${pollId}|${voterId}`);
}

async function fingerprintHash(env, pollId, request) {
  const ip = clientIp(request) || 'unknown';
  return sha256Hex(`${await getSalt(env)}|fp|${pollId}|${ip}`);
}

function readVoterId(request, url, body) {
  const raw = (body && body.voterId) || url.searchParams.get('voterId') || request.headers.get('X-Voter-Id') || '';
  return String(raw).trim();
}

function validVoterId(id) {
  return typeof id === 'string' && id.length >= 8 && id.length <= 128 && /^[A-Za-z0-9._:-]+$/.test(id);
}

async function ensureSchema(db) {
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS polls (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      subtitle TEXT,
      season INTEGER,
      kind TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      sort_order INTEGER NOT NULL DEFAULT 0,
      note TEXT,
      searchable INTEGER NOT NULL DEFAULT 1,
      results_preview INTEGER NOT NULL DEFAULT 15
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS options (
      poll_id TEXT NOT NULL,
      id TEXT NOT NULL,
      label TEXT NOT NULL,
      sublabel TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      meta_json TEXT,
      PRIMARY KEY (poll_id, id),
      FOREIGN KEY (poll_id) REFERENCES polls(id)
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS option_baselines (
      poll_id TEXT NOT NULL,
      option_id TEXT NOT NULL,
      votes INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (poll_id, option_id),
      FOREIGN KEY (poll_id, option_id) REFERENCES options(poll_id, id)
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS votes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      poll_id TEXT NOT NULL,
      option_id TEXT NOT NULL,
      voter_id_hash TEXT NOT NULL,
      fp_hash TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE (poll_id, voter_id_hash),
      UNIQUE (poll_id, fp_hash)
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS votes_poll_option ON votes (poll_id, option_id)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )`),
  ]);
}

async function ensureCatalog(db) {
  const stmts = [];
  for (const poll of POLLS) {
    stmts.push(db.prepare(`
      INSERT INTO polls (id, title, subtitle, season, kind, status, sort_order, note, searchable, results_preview)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        title=excluded.title, subtitle=excluded.subtitle, season=excluded.season,
        kind=excluded.kind, status=excluded.status, sort_order=excluded.sort_order,
        note=excluded.note, searchable=excluded.searchable, results_preview=excluded.results_preview
    `).bind(
      poll.id, poll.title, poll.subtitle || '', poll.season || null, poll.kind,
      poll.status || 'active', poll.sortOrder || 0, poll.note || '',
      poll.searchable === false ? 0 : 1, poll.resultsPreview || 15
    ));
    for (const opt of poll.options) {
      stmts.push(db.prepare(`
        INSERT INTO options (poll_id, id, label, sublabel, sort_order, meta_json)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(poll_id, id) DO UPDATE SET
          label=excluded.label, sublabel=excluded.sublabel,
          sort_order=excluded.sort_order, meta_json=excluded.meta_json
      `).bind(
        poll.id, opt.id, opt.label, opt.sublabel || '', opt.sortOrder || 0,
        JSON.stringify(opt.meta || {})
      ));
      stmts.push(db.prepare(`
        INSERT OR IGNORE INTO option_baselines (poll_id, option_id, votes)
        VALUES (?, ?, ?)
      `).bind(poll.id, opt.id, Number(opt.baselineVotes) || 0));
    }
  }
  for (let i = 0; i < stmts.length; i += 40) {
    await db.batch(stmts.slice(i, i + 40));
  }
}

function findPoll(id) {
  return POLLS.find(p => p.id === id) || null;
}

async function myVoteFor(db, pollId, vidHash, fpHash) {
  if (!vidHash && !fpHash) return null;
  const row = await db.prepare(`
    SELECT option_id FROM votes
    WHERE poll_id = ? AND (voter_id_hash = ? OR fp_hash = ?)
    LIMIT 1
  `).bind(pollId, vidHash || '', fpHash || '').first();
  return row ? row.option_id : null;
}

async function pollSnapshot(db, poll, myVote) {
  const liveRows = await db.prepare(`
    SELECT option_id, COUNT(*) AS live
    FROM votes WHERE poll_id = ?
    GROUP BY option_id
  `).bind(poll.id).all();
  const liveMap = new Map((liveRows.results || []).map(r => [r.option_id, Number(r.live) || 0]));
  const baseRows = await db.prepare(`
    SELECT option_id, votes FROM option_baselines WHERE poll_id = ?
  `).bind(poll.id).all();
  const baseMap = new Map((baseRows.results || []).map(r => [r.option_id, Number(r.votes) || 0]));

  const options = poll.options.map(opt => {
    const baselineVotes = baseMap.has(opt.id) ? baseMap.get(opt.id) : (Number(opt.baselineVotes) || 0);
    const liveVotes = liveMap.get(opt.id) || 0;
    return {
      id: opt.id,
      label: opt.label,
      sublabel: opt.sublabel || '',
      sortOrder: opt.sortOrder || 0,
      baselineVotes,
      liveVotes,
      votes: baselineVotes + liveVotes,
      meta: opt.meta || {},
    };
  });
  const totalVotes = options.reduce((s, o) => s + o.votes, 0);
  for (const o of options) {
    o.pct = totalVotes ? Math.round((o.votes / totalVotes) * 1000) / 10 : 0;
  }
  options.sort((a, b) => b.votes - a.votes || a.label.localeCompare(b.label) || a.id.localeCompare(b.id));
  const leader = options[0] && options[0].votes > 0 ? {
    optionId: options[0].id,
    label: options[0].label,
    votes: options[0].votes,
    pct: options[0].pct,
  } : null;
  return {
    id: poll.id,
    title: poll.title,
    subtitle: poll.subtitle || '',
    season: poll.season,
    kind: poll.kind,
    status: poll.status || 'active',
    note: poll.note || 'One vote per poll — your pick is final.',
    searchable: poll.searchable !== false,
    resultsPreview: poll.resultsPreview || 15,
    totalVotes,
    leader,
    myVote: myVote || null,
    options,
  };
}

async function getPolls(env, request, url) {
  const voterId = readVoterId(request, url, null);
  const out = [];
  for (const poll of [...POLLS].sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0))) {
    if (poll.status && poll.status !== 'active') continue;
    let vidHash = null;
    let fpHash = await fingerprintHash(env, poll.id, request);
    if (validVoterId(voterId)) vidHash = await voterIdHash(env, poll.id, voterId);
    const mine = await myVoteFor(env.DB, poll.id, vidHash, fpHash);
    out.push(await pollSnapshot(env.DB, poll, mine));
  }
  return { polls: out, capturedAt: CATALOG_META.capturedAt };
}

async function castVote(env, request, pollId) {
  const poll = findPoll(pollId);
  if (!poll || (poll.status && poll.status !== 'active')) {
    return { error: 'Unknown or inactive poll.', alreadyVoted: false };
  }
  let body;
  try {
    body = await request.json();
  } catch {
    return { error: 'Vote could not be read. Please try again.', alreadyVoted: false };
  }
  const optionId = String(body?.optionId || '').trim();
  const voterId = String(body?.voterId || '').trim();
  if (!validVoterId(voterId)) {
    return { error: 'A valid voter id is required.', alreadyVoted: false };
  }
  if (!poll.options.some(o => o.id === optionId)) {
    return { error: 'That is not a valid option for this poll.', alreadyVoted: false };
  }
  const vidHash = await voterIdHash(env, pollId, voterId);
  const fpHash = await fingerprintHash(env, pollId, request);
  const existing = await myVoteFor(env.DB, pollId, vidHash, fpHash);
  if (existing) {
    const snapshot = await pollSnapshot(env.DB, poll, existing);
    return { alreadyVoted: true, lockedOptionId: existing, poll: snapshot };
  }

  const createdAt = new Date().toISOString();
  try {
    await env.DB.prepare(`
      INSERT INTO votes (poll_id, option_id, voter_id_hash, fp_hash, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).bind(pollId, optionId, vidHash, fpHash, createdAt).run();
  } catch (err) {
    const again = await myVoteFor(env.DB, pollId, vidHash, fpHash);
    if (again) {
      const snapshot = await pollSnapshot(env.DB, poll, again);
      return { alreadyVoted: true, lockedOptionId: again, poll: snapshot };
    }
    throw err;
  }
  const snapshot = await pollSnapshot(env.DB, poll, optionId);
  return { alreadyVoted: false, lockedOptionId: optionId, poll: snapshot };
}

export default {
  async fetch(request, env) {
    const cors = corsHeaders(request);
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }
    try {
      if (!env.DB) return json({ error: 'Database is not bound.' }, cors, 500);
      await ensureSchema(env.DB);
      await ensureCatalog(env.DB);
      const url = new URL(request.url);
      if (request.method === 'GET' && (url.pathname === '/api/polls' || url.pathname === '/api/polls/')) {
        return json(await getPolls(env, request, url), cors);
      }
      const voteMatch = url.pathname.match(/^\/api\/polls\/([^/]+)\/vote\/?$/);
      if (request.method === 'POST' && voteMatch) {
        if (!POLL_IDS.has(voteMatch[1]) && !findPoll(voteMatch[1])) {
          return json({ error: 'Unknown or inactive poll.', alreadyVoted: false }, cors, 404);
        }
        const result = await castVote(env, request, voteMatch[1]);
        const status = result.error && !result.alreadyVoted
          ? (result.error.startsWith('Unknown') || result.error.includes('not a valid option') ? 400 : 400)
          : 200;
        return json(result, cors, status);
      }
      if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/health')) {
        return json({ ok: true, service: 'live-scoreboard-polls' }, cors);
      }
      return json({ error: 'Not found' }, cors, 404);
    } catch (err) {
      console.error(err);
      return json({ error: 'Something went wrong. Please try again.' }, cors, 500);
    }
  },
};
