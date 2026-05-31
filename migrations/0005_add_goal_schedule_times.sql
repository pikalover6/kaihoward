-- Add optional time-precise scheduling to goals so the planner can hold real
-- calendar blocks (e.g. "2026-05-30T09:00") in addition to date-only due dates.
-- Stored as ISO 8601 local datetime strings ("YYYY-MM-DDTHH:MM"); nullable.
ALTER TABLE life_goals ADD COLUMN start_at TEXT;
ALTER TABLE life_goals ADD COLUMN end_at TEXT;

CREATE INDEX IF NOT EXISTS idx_life_goals_start_at ON life_goals(start_at);
