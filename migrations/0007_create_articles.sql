-- The Kai Courier: one generated newspaper edition per day, stored in D1.
-- Mirrors the conventions of the other migrations (TEXT ids, ISO timestamps).
CREATE TABLE IF NOT EXISTS articles (
  id TEXT PRIMARY KEY,                 -- edition date, YYYY-MM-DD
  generated_at TEXT NOT NULL,          -- ISO 8601 when the edition was produced
  html TEXT NOT NULL,                  -- semantic article HTML injected into the page
  summary TEXT NOT NULL DEFAULT '',    -- one-line editorial summary for the archive list
  summary_json TEXT,                   -- optional structured JSON (sections, etc.)
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_articles_generated_at ON articles(generated_at);
