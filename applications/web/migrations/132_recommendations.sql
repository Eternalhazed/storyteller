-- A reader's reading history imported from other services (and books they
-- marked read in the app that are not in the library). Private to the
-- reader; re-importing a source replaces only that source's rows.
CREATE TABLE IF NOT EXISTS history_import_job (
  uuid TEXT PRIMARY KEY NOT NULL DEFAULT (uuid ()),
  user_id TEXT NOT NULL REFERENCES user (id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running',
  total INTEGER NOT NULL DEFAULT 0,
  processed INTEGER NOT NULL DEFAULT 0,
  matched INTEGER NOT NULL DEFAULT 0,
  unmatched INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_history_import_job_user ON history_import_job (user_id, created_at);

CREATE TABLE IF NOT EXISTS reading_history_item (
  uuid TEXT PRIMARY KEY NOT NULL DEFAULT (uuid ()),
  user_id TEXT NOT NULL REFERENCES user (id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  source_id TEXT NOT NULL,
  job_uuid TEXT REFERENCES history_import_job (uuid) ON DELETE SET NULL,
  title TEXT NOT NULL,
  authors TEXT NOT NULL DEFAULT '[]',
  narrators TEXT NOT NULL DEFAULT '[]',
  series TEXT,
  isbn13 TEXT,
  isbn10 TEXT,
  asin TEXT,
  status TEXT NOT NULL,
  -- 1 when the reader said so (a shelf, a rating, a finished flag); 0 when
  -- estimated (Audible percent, Kindle reading time).
  explicit INTEGER NOT NULL DEFAULT 1,
  rating REAL,
  started_at TEXT,
  finished_at TEXT,
  added_at TEXT,
  progress REAL,
  read_count INTEGER,
  shelves TEXT NOT NULL DEFAULT '[]',
  pages INTEGER,
  runtime_minutes INTEGER,
  published_year INTEGER,
  -- Kindle only: time spent reading and pages turned, to estimate "read".
  reading_minutes INTEGER,
  page_flips INTEGER,
  match_status TEXT NOT NULL DEFAULT 'pending',
  work TEXT,
  matched_by TEXT,
  book_uuid TEXT REFERENCES book (uuid) ON DELETE SET NULL,
  imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (user_id, source, source_id)
);

CREATE INDEX IF NOT EXISTS idx_reading_history_item_user ON reading_history_item (user_id, match_status);

CREATE INDEX IF NOT EXISTS idx_reading_history_item_job ON reading_history_item (job_uuid, match_status);

-- Built by code from the reader's history; the input to every round.
CREATE TABLE IF NOT EXISTS reader_profile (
  user_id TEXT PRIMARY KEY NOT NULL REFERENCES user (id) ON DELETE CASCADE,
  profile TEXT NOT NULL,
  input_hash TEXT NOT NULL,
  built_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Standing preferences and the scheduler's per-reader bookkeeping.
CREATE TABLE IF NOT EXISTS recommendation_reader (
  user_id TEXT PRIMARY KEY NOT NULL REFERENCES user (id) ON DELETE CASCADE,
  prefs TEXT NOT NULL DEFAULT '{}',
  -- A book changed to Read waits here; the anchored round starts when the
  -- window closes with exactly one such book in it.
  finish_book_uuid TEXT,
  finish_count INTEGER NOT NULL DEFAULT 0,
  finish_due_at TEXT,
  last_weekly_at TEXT,
  series_checked_at TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS recommendation_round (
  uuid TEXT PRIMARY KEY NOT NULL DEFAULT (uuid ()),
  user_id TEXT NOT NULL REFERENCES user (id) ON DELETE CASCADE,
  trigger TEXT NOT NULL,
  kind TEXT NOT NULL,
  input TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'running',
  stage TEXT,
  model TEXT,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cache_write_tokens INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens INTEGER NOT NULL DEFAULT 0,
  cost_microusd INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_recommendation_round_user ON recommendation_round (user_id, created_at);

CREATE TABLE IF NOT EXISTS recommendation (
  uuid TEXT PRIMARY KEY NOT NULL DEFAULT (uuid ()),
  round_uuid TEXT NOT NULL REFERENCES recommendation_round (uuid) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES user (id) ON DELETE CASCADE,
  work_key TEXT NOT NULL,
  -- Normalized main title and first author, to recognize the same book
  -- under another catalog id.
  work_identity TEXT NOT NULL,
  work TEXT NOT NULL,
  section TEXT NOT NULL,
  rank INTEGER NOT NULL,
  fit_score REAL,
  adjusted_score REAL,
  pill TEXT,
  label TEXT,
  note TEXT,
  reason TEXT NOT NULL,
  why TEXT NOT NULL,
  evidence TEXT NOT NULL DEFAULT '[]',
  series TEXT,
  anchor_title TEXT,
  state TEXT NOT NULL DEFAULT 'new',
  state_reason TEXT,
  state_at TEXT,
  rested_until TEXT,
  request_uuid TEXT REFERENCES book_request (uuid) ON DELETE SET NULL,
  notified_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_recommendation_round ON recommendation (round_uuid, rank);

CREATE INDEX IF NOT EXISTS idx_recommendation_user_work ON recommendation (user_id, work_identity);

CREATE TABLE IF NOT EXISTS catalog_cache (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL,
  fetched_at INTEGER NOT NULL
);

INSERT
OR IGNORE INTO settings (name, value)
VALUES
  ('recommendationModel', '"claude-sonnet-5-5"'),
  ('recommendationFastModel', '"claude-haiku-5-5"'),
  ('recommendationMonthlyBudgetUsd', '5');
