-- HS-005: generation-owned Meta sync leases and durable media mirror effects.
-- Drain old Meta executors before applying: old binaries do not honor these fences.

ALTER TABLE public.meta_sync_jobs
  ADD COLUMN lease_owner uuid,
  ADD COLUMN lease_generation integer NOT NULL DEFAULT 0,
  ADD COLUMN lease_expires_at timestamptz;
--> statement-breakpoint

-- Invalidate every pre-migration runner. The new runner's next claim advances again.
UPDATE public.meta_sync_jobs
SET status = 'queued',
    lease_generation = lease_generation + 1,
    error = NULL
WHERE status = 'running';
--> statement-breakpoint

ALTER TABLE public.meta_sync_jobs
  ADD CONSTRAINT meta_sync_jobs_lease_generation_nonnegative
    CHECK (lease_generation >= 0),
  ADD CONSTRAINT meta_sync_jobs_lease_state_check
    CHECK (
      (status = 'running' AND lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL)
      OR
      (status <> 'running' AND lease_owner IS NULL AND lease_expires_at IS NULL)
    );
--> statement-breakpoint

CREATE INDEX meta_sync_jobs_due_idx
  ON public.meta_sync_jobs (status, lease_expires_at, created_at);
--> statement-breakpoint

-- A narrow renewal primitive gives the heartbeat server-side lock/statement bounds.
-- The application also cancels this one query while queued or connecting.
CREATE FUNCTION public.meta_sync_renew_lease(
  p_job_id uuid,
  p_org_id text,
  p_owner uuid,
  p_generation integer,
  p_lease_seconds integer
) RETURNS boolean
LANGUAGE plpgsql
SET lock_timeout = '4s'
SET statement_timeout = '5s'
AS $$
DECLARE
  changed integer;
BEGIN
  IF p_lease_seconds < 1 OR p_lease_seconds > 300 THEN
    RAISE EXCEPTION 'invalid Meta sync lease duration' USING ERRCODE = '22023';
  END IF;

  UPDATE public.meta_sync_jobs
  SET lease_expires_at = clock_timestamp() + make_interval(secs => p_lease_seconds)
  WHERE id = p_job_id
    AND org_id = p_org_id
    AND status = 'running'
    AND lease_owner = p_owner
    AND lease_generation = p_generation
    AND lease_expires_at > clock_timestamp();
  GET DIAGNOSTICS changed = ROW_COUNT;
  RETURN changed = 1;
END;
$$;
--> statement-breakpoint

REVOKE ALL ON FUNCTION public.meta_sync_renew_lease(uuid, text, uuid, integer, integer) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.meta_sync_renew_lease(uuid, text, uuid, integer, integer) TO app_ledger;
--> statement-breakpoint

CREATE TABLE public.meta_media_mirror_effects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id text NOT NULL,
  platform text NOT NULL,
  post_id text NOT NULL,
  digest text NOT NULL CONSTRAINT meta_media_mirror_effects_digest_check
    CHECK (digest ~ '^[a-f0-9]{64}$'),
  source_url text NOT NULL,
  object_key text NOT NULL,
  file_id text,
  size_bytes integer NOT NULL CHECK (size_bytes >= 0),
  content_type text NOT NULL,
  state text NOT NULL DEFAULT 'active' CONSTRAINT meta_media_mirror_effects_state_check
    CHECK (state IN ('active', 'published', 'cleanup_pending')),
  error text,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  cleanup_attempts integer NOT NULL DEFAULT 0 CHECK (cleanup_attempts >= 0),
  writer_deadline_at timestamptz NOT NULL,
  next_cleanup_at timestamptz,
  object_absent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT meta_media_mirror_effects_media_identity_uq
    UNIQUE (org_id, platform, post_id, id)
);
--> statement-breakpoint

CREATE UNIQUE INDEX meta_media_mirror_effects_object_key_uq
  ON public.meta_media_mirror_effects (object_key);
--> statement-breakpoint
CREATE UNIQUE INDEX meta_media_mirror_effects_active_uq
  ON public.meta_media_mirror_effects (org_id, platform, post_id)
  WHERE state = 'active';
--> statement-breakpoint
CREATE INDEX meta_media_mirror_effects_cleanup_idx
  ON public.meta_media_mirror_effects (state, next_cleanup_at, id);
--> statement-breakpoint

ALTER TABLE public.meta_post_media
  ADD COLUMN active_effect_id uuid,
  ADD CONSTRAINT meta_post_media_active_effect_fk
    FOREIGN KEY (org_id, platform, post_id, active_effect_id)
    REFERENCES public.meta_media_mirror_effects (org_id, platform, post_id, id);
--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON public.meta_media_mirror_effects TO app_ledger;
--> statement-breakpoint
ALTER TABLE public.meta_media_mirror_effects ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.meta_media_mirror_effects FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY meta_media_mirror_effects_org_guc ON public.meta_media_mirror_effects
  FOR ALL
  USING (org_id = current_setting('app.current_org_id', true))
  WITH CHECK (org_id = current_setting('app.current_org_id', true));
