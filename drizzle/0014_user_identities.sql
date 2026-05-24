-- Unified user identities: OAuth providers + channel identities with encrypted secrets.
CREATE TABLE user_identities (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  kind TEXT NOT NULL,
  external_id TEXT NOT NULL,
  display_name TEXT,
  scope TEXT,
  secret_ciphertext TEXT,
  secret_iv TEXT,
  expires_at INTEGER,
  verified_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX idx_user_identity_unique ON user_identities (provider, external_id);
CREATE INDEX idx_user_identity_user ON user_identities (user_id);

-- Backfill existing channel identities (no secrets to encrypt -> pure SQL).
INSERT INTO user_identities
  (id, user_id, provider, kind, external_id, display_name, verified_at, created_at, updated_at)
SELECT
  id, user_id, channel, 'channel', channel_user_id, display_name, verified_at, created_at, created_at
FROM channel_identities;
