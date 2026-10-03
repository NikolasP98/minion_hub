-- Global catalog administration and public read-through document cache ownership.
-- No tenant/browser role can claim, clear, or forge a worker lease.
BEGIN;
CREATE TABLE public.marketplace_sync_state (
  id text PRIMARY KEY DEFAULT 'catalog',
  lease_token uuid,
  last_published_token uuid,
  lease_until timestamptz,
  directories jsonb NOT NULL DEFAULT '[]',
  next_index integer NOT NULL DEFAULT 0,
  synced integer NOT NULL DEFAULT 0,
  failed integer NOT NULL DEFAULT 0,
  errors jsonb NOT NULL DEFAULT '[]',
  status text NOT NULL DEFAULT 'idle',
  cycle_started_at timestamptz,
  completed_at timestamptz,
  last_synced integer NOT NULL DEFAULT 0,
  last_failed integer NOT NULL DEFAULT 0,
  next_eligible_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  manual_eligible_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT marketplace_sync_singleton CHECK (id = 'catalog'),
  CONSTRAINT marketplace_sync_lease_pair CHECK ((lease_token IS NULL) = (lease_until IS NULL)),
  CONSTRAINT marketplace_sync_cursor CHECK (jsonb_typeof(directories) = 'array' AND next_index >= 0 AND next_index <= jsonb_array_length(directories) AND jsonb_array_length(directories) < 1000),
  CONSTRAINT marketplace_sync_counts CHECK (synced >= 0 AND failed >= 0 AND last_synced >= 0 AND last_failed >= 0),
  CONSTRAINT marketplace_sync_errors CHECK (jsonb_typeof(errors) = 'array' AND jsonb_array_length(errors) <= 20 AND octet_length(errors::text) <= 5000),
  CONSTRAINT marketplace_sync_status CHECK (status IN ('idle','running','complete','partial','failed'))
);
CREATE TABLE public.marketplace_file_load_state (
  agent_id text PRIMARY KEY REFERENCES public.marketplace_agents(id) ON DELETE CASCADE,
  lease_token uuid,
  lease_until timestamptz,
  next_eligible_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  error_code text,
  verified_at timestamptz,
  verified_digest text,
  CONSTRAINT marketplace_file_verification CHECK ((verified_at IS NULL AND verified_digest IS NULL) OR (verified_at IS NOT NULL AND verified_digest IS NOT NULL AND verified_digest ~ '^[a-f0-9]{64}$')),
  CONSTRAINT marketplace_file_lease_pair CHECK ((lease_token IS NULL) = (lease_until IS NULL)),
  CONSTRAINT marketplace_file_error_bound CHECK (error_code IS NULL OR length(error_code) <= 64)
);
ALTER TABLE public.marketplace_sync_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketplace_file_load_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.marketplace_sync_state, public.marketplace_file_load_state FROM PUBLIC, anon, authenticated, app_ledger;
GRANT ALL ON public.marketplace_sync_state, public.marketplace_file_load_state TO service_role;
-- Old hydration treated transient errors as absent and still marked the bundle loaded.
-- Preserve its contents as stale, but revalidate every legacy marker before install.
UPDATE public.marketplace_agents SET files_loaded_at = NULL WHERE files_loaded_at IS NOT NULL;
INSERT INTO public.marketplace_sync_state (id) VALUES ('catalog');
COMMIT;
