-- Derived TEST-ONLY runtime prerequisite, not frozen historical migration bytes.
-- Catalog provenance: runtime-auth-sessions.catalog.json (loopback GoTrue v2.188.1).
-- Preserve nullability, defaults, PK and cascading user FK for the required subset.
-- OAuth/MFA/refresh-token state and GoTrue behavior are outside this fixture.
CREATE TABLE auth.sessions (
  id uuid NOT NULL,
  user_id uuid NOT NULL,
  created_at timestamptz,
  updated_at timestamptz,
  not_after timestamptz,
  CONSTRAINT sessions_pkey PRIMARY KEY (id),
  CONSTRAINT sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE
);
-- PG17 uses the platform postgres migration actor; catalog evidence confirms REFERENCES.
GRANT REFERENCES ON auth.sessions TO postgres;
