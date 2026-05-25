-- Add alias and role_id columns to user table.
-- SQLite/libsql cannot ALTER TABLE ADD COLUMN with an inline UNIQUE constraint,
-- so the uniqueness on `alias` is enforced via a separate unique index.
ALTER TABLE user ADD COLUMN alias TEXT;
ALTER TABLE user ADD COLUMN role_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_alias_unique ON user(alias);
