-- Add alias and role_id columns to user table
ALTER TABLE user ADD COLUMN alias TEXT UNIQUE;
ALTER TABLE user ADD COLUMN role_id TEXT;
