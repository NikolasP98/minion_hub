-- Add trigger arming columns to flows table: active flag + config JSON
ALTER TABLE flows ADD COLUMN active INTEGER NOT NULL DEFAULT 0;
ALTER TABLE flows ADD COLUMN config TEXT NOT NULL DEFAULT '{}';
