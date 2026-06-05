-- notes table (Supabase Postgres / relational-core DB) — personal notes/todos/easel.
-- Apply to: local Supabase (dev) and prod project fsdaqawhzvlphcbxzzji (release).
-- Mirrors src/server/db/pg-schema/notes.ts. Idempotent.

CREATE TABLE IF NOT EXISTS notes (
  id         text PRIMARY KEY,
  tenant_id  text,
  user_id    text,
  kind       text    NOT NULL DEFAULT 'note',  -- 'note' | 'todo' | 'easel'
  title      text    NOT NULL DEFAULT '',
  color      text    NOT NULL DEFAULT 'default',
  pinned     boolean NOT NULL DEFAULT false,
  data       text    NOT NULL DEFAULT '{}',     -- JSON; shape depends on kind
  created_at bigint  NOT NULL,
  updated_at bigint  NOT NULL
);

CREATE INDEX IF NOT EXISTS notes_owner_idx   ON notes (tenant_id, user_id);
CREATE INDEX IF NOT EXISTS notes_updated_idx ON notes (updated_at);
