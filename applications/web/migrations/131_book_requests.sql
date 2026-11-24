-- A reader's request for a book they do not have yet. The ebook and the
-- audiobook are tracked separately, and narration sync on its own, so a
-- readable ebook never waits on, or disappears because of, the audiobook.
CREATE TABLE IF NOT EXISTS book_request (
  uuid TEXT PRIMARY KEY NOT NULL DEFAULT (uuid ()),
  user_id TEXT NOT NULL REFERENCES user (id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  input TEXT NOT NULL,
  chosen_work TEXT NOT NULL,
  -- Reserved when the request is created, before the book exists, so every
  -- retry of an import creates or finds this one book.
  book_uuid TEXT NOT NULL,
  collection_uuid TEXT NOT NULL REFERENCES collection (uuid),
  ebook_status TEXT NOT NULL DEFAULT 'none',
  ebook_release TEXT,
  ebook_infohash TEXT,
  ebook_progress REAL NOT NULL DEFAULT 0,
  ebook_bytes_done INTEGER NOT NULL DEFAULT 0,
  ebook_progress_at INTEGER,
  ebook_added_at INTEGER,
  ebook_reused INTEGER NOT NULL DEFAULT 0,
  ebook_error TEXT,
  audio_status TEXT NOT NULL DEFAULT 'none',
  audio_release TEXT,
  audio_infohash TEXT,
  audio_progress REAL NOT NULL DEFAULT 0,
  audio_bytes_done INTEGER NOT NULL DEFAULT 0,
  audio_progress_at INTEGER,
  audio_added_at INTEGER,
  audio_reused INTEGER NOT NULL DEFAULT 0,
  audio_error TEXT,
  align_job_uuid TEXT,
  align_status TEXT NOT NULL DEFAULT 'none',
  notified TEXT NOT NULL DEFAULT '[]',
  closed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_book_request_user ON book_request (user_id, created_at);

CREATE INDEX IF NOT EXISTS idx_book_request_open ON book_request (closed_at);

CREATE INDEX IF NOT EXISTS idx_book_request_book ON book_request (book_uuid);

CREATE TRIGGER IF NOT EXISTS book_request_update_trigger AFTER
UPDATE ON book_request FOR EACH ROW BEGIN
UPDATE book_request
SET
  updated_at = CURRENT_TIMESTAMP
WHERE
  uuid = OLD.uuid;

END;

-- One row per change to a request, with a plain reason, for its history.
CREATE TABLE IF NOT EXISTS book_request_event (
  uuid TEXT PRIMARY KEY NOT NULL DEFAULT (uuid ()),
  request_uuid TEXT NOT NULL REFERENCES book_request (uuid) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_book_request_event_request ON book_request_event (request_uuid, created_at);

-- An app install and the account it is signed in to. An install belongs to
-- one account at a time; registering it for another account moves it.
CREATE TABLE IF NOT EXISTS user_device (
  install_id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES user (id) ON DELETE CASCADE,
  platform TEXT NOT NULL,
  push_token TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_user_device_user ON user_device (user_id);

CREATE TRIGGER IF NOT EXISTS user_device_update_trigger AFTER
UPDATE ON user_device FOR EACH ROW BEGIN
UPDATE user_device
SET
  updated_at = CURRENT_TIMESTAMP
WHERE
  install_id = OLD.install_id;

END;
