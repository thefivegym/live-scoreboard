-- D1 schema for live scoreboard Fan Polls.
-- The Worker also applies this (or an equivalent) on first request via ensureSchema().
-- Adding a new poll is done in src/catalog.js, not by hand-editing rows.

CREATE TABLE IF NOT EXISTS polls (
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
);

CREATE TABLE IF NOT EXISTS options (
  poll_id TEXT NOT NULL,
  id TEXT NOT NULL,
  label TEXT NOT NULL,
  sublabel TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  meta_json TEXT,
  PRIMARY KEY (poll_id, id),
  FOREIGN KEY (poll_id) REFERENCES polls(id)
);

CREATE TABLE IF NOT EXISTS option_baselines (
  poll_id TEXT NOT NULL,
  option_id TEXT NOT NULL,
  votes INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (poll_id, option_id),
  FOREIGN KEY (poll_id, option_id) REFERENCES options(poll_id, id)
);

-- One locked vote per poll: unique on voter_id_hash AND on the IP fingerprint.
-- A single row is one ballot, so COUNT(*) is the live (non-baseline) total.
CREATE TABLE IF NOT EXISTS votes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  poll_id TEXT NOT NULL,
  option_id TEXT NOT NULL,
  voter_id_hash TEXT NOT NULL,
  fp_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (poll_id, voter_id_hash),
  UNIQUE (poll_id, fp_hash)
);

CREATE INDEX IF NOT EXISTS votes_poll_option ON votes (poll_id, option_id);

CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
