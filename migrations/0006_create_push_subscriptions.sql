-- Web Push subscriptions for reminder notifications. Also created lazily by
-- functions/personal/api/push.ts (CREATE TABLE IF NOT EXISTS), so this migration
-- is for repo record / fresh databases. Reminder de-duplication lives in the
-- reminder Worker's KV, not in D1.
CREATE TABLE IF NOT EXISTS push_subscriptions (
  endpoint TEXT PRIMARY KEY,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  timezone TEXT,
  created_at TEXT NOT NULL
);
