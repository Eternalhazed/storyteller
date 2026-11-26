-- Private conversation text is not stored; only model spend is retained.
CREATE TABLE IF NOT EXISTS helper_turn (
  uuid TEXT PRIMARY KEY NOT NULL DEFAULT (uuid ()),
  user_id TEXT NOT NULL REFERENCES user (id) ON DELETE CASCADE,
  cost_microusd INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_helper_turn_created_at ON helper_turn (created_at);

INSERT
OR IGNORE INTO settings (name, value)
VALUES
  ('openRouterApiKey', 'null'),
  ('speechModel', '"microsoft/mai-transcribe-2"');
