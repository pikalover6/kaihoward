CREATE TABLE IF NOT EXISTS personal_notes (
  id TEXT PRIMARY KEY,
  content TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT OR IGNORE INTO personal_notes (id, content, updated_at)
VALUES ('main', '', datetime('now'));
