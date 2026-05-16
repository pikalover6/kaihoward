ALTER TABLE life_goals ADD COLUMN x REAL;
ALTER TABLE life_goals ADD COLUMN y REAL;
ALTER TABLE life_goals ADD COLUMN collapsed INTEGER NOT NULL DEFAULT 0;

DELETE FROM life_goals
WHERE id IN ('starter-week', 'starter-semester', 'starter-undergrad', 'starter-law');
