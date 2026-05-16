ALTER TABLE life_goals ADD COLUMN duration_label TEXT;

UPDATE life_goals
SET duration_label = CASE horizon
  WHEN 'life' THEN 'Lifetime'
  WHEN 'five-year' THEN '5 years'
  WHEN 'year' THEN '1 year'
  WHEN 'semester' THEN 'Semester'
  WHEN 'month' THEN '1 month'
  WHEN 'week' THEN '1 week'
  WHEN 'day' THEN '1 day'
  WHEN 'minute' THEN 'Immediate'
  ELSE horizon
END
WHERE duration_label IS NULL OR duration_label = '';
