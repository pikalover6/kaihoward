CREATE TABLE IF NOT EXISTS life_goals (
  id TEXT PRIMARY KEY,
  parent_id TEXT,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  horizon TEXT NOT NULL DEFAULT 'year',
  status TEXT NOT NULL DEFAULT 'planned',
  priority INTEGER NOT NULL DEFAULT 3,
  start_date TEXT,
  due_date TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (parent_id) REFERENCES life_goals(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_life_goals_parent_id ON life_goals(parent_id);
CREATE INDEX IF NOT EXISTS idx_life_goals_horizon ON life_goals(horizon);
CREATE INDEX IF NOT EXISTS idx_life_goals_status ON life_goals(status);
