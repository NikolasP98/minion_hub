-- Install before revision-aware handlers; drain old unfenced workers before activation.
-- Additive only. Rollback retains receipts and must not reactivate old workers.
-- TODO(handoff): Choose receipt retention and indeterminate-provider recovery policy before
-- any purge/retry automation. See meta proposals/2026-09-08-platform-qc-remediation.md (JOB-02).
CREATE FUNCTION public.job_effect_vectors_valid(value jsonb, expected integer)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE AS $$
DECLARE vector jsonb; component jsonb;
BEGIN
  IF value IS NULL OR expected IS NULL OR expected NOT BETWEEN 1 AND 64
     OR jsonb_typeof(value) <> 'array' OR pg_column_size(value) > 4000000 THEN RETURN false; END IF;
  IF jsonb_array_length(value) <> expected THEN RETURN false; END IF;
  FOR vector IN SELECT jsonb_array_elements(value) LOOP
    IF jsonb_typeof(vector) <> 'array' THEN RETURN false; END IF;
    IF jsonb_array_length(vector) <> 1536 THEN RETURN false; END IF;
    FOR component IN SELECT jsonb_array_elements(vector) LOOP
      IF jsonb_typeof(component) <> 'number' THEN RETURN false; END IF;
      IF abs((component #>> '{}')::numeric) > 1.7976931348623157e308 THEN RETURN false; END IF;
    END LOOP;
  END LOOP;
  RETURN true;
END $$;

CREATE TABLE public.job_effects (
  id text PRIMARY KEY,
  tenant_id text NOT NULL,
  family text NOT NULL,
  entity_id text NOT NULL,
  kind text NOT NULL,
  revision uuid NOT NULL,
  unit text NOT NULL,
  source_hash text NOT NULL,
  state text NOT NULL,
  descriptor jsonb,
  result jsonb,
  legacy_job_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT job_effects_identity CHECK (
    length(tenant_id) BETWEEN 1 AND 256 AND length(family) BETWEEN 1 AND 96
    AND length(entity_id) BETWEEN 1 AND 512 AND source_hash ~ '^[a-f0-9]{64}$'
    AND id ~ '^[a-f0-9]{64}$'),
  CONSTRAINT job_effects_shape CHECK ((
    (kind = 'head' AND unit = '' AND state IN ('active', 'revoked')
      AND descriptor IS NULL AND result IS NULL)
    OR
    (kind = 'effect' AND length(unit) BETWEEN 1 AND 160 AND legacy_job_id IS NULL
      AND state IN ('admitted', 'received', 'committed')
      AND descriptor IS NOT NULL AND jsonb_typeof(descriptor) = 'object'
      AND descriptor ?& ARRAY['payloadHash','endpoint','model','normalization','count','dimensions','pipelineVersion']
      AND jsonb_typeof(descriptor->'payloadHash') = 'string'
      AND jsonb_typeof(descriptor->'endpoint') = 'string'
      AND jsonb_typeof(descriptor->'model') = 'string'
      AND jsonb_typeof(descriptor->'normalization') = 'string'
      AND jsonb_typeof(descriptor->'pipelineVersion') = 'string'
      AND jsonb_typeof(descriptor->'count') = 'number'
      AND jsonb_typeof(descriptor->'dimensions') = 'number'
      AND descriptor->>'payloadHash' ~ '^[a-f0-9]{64}$'
      AND length(descriptor->>'endpoint') BETWEEN 1 AND 512
      AND length(descriptor->>'model') BETWEEN 1 AND 128
      AND length(descriptor->>'normalization') BETWEEN 1 AND 128
      AND length(descriptor->>'pipelineVersion') BETWEEN 1 AND 128
      AND descriptor->>'count' ~ '^([1-9]|[1-5][0-9]|6[0-4])$'
      AND descriptor->>'dimensions' = '1536'
      AND CASE WHEN state = 'admitted' THEN result IS NULL
        ELSE public.job_effect_vectors_valid(result, (descriptor->>'count')::integer) END)) IS TRUE)
);
CREATE UNIQUE INDEX job_effects_head_identity ON public.job_effects (tenant_id, family, entity_id) WHERE kind = 'head';
CREATE UNIQUE INDEX job_effects_unit_identity ON public.job_effects (tenant_id, family, entity_id, revision, unit) WHERE kind = 'effect';
CREATE INDEX job_effects_revision ON public.job_effects (tenant_id, family, entity_id, revision);
ALTER TABLE public.job_effects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_effects FORCE ROW LEVEL SECURITY;
CREATE POLICY job_effects_org ON public.job_effects TO app_ledger
  USING (tenant_id = current_setting('app.current_org_id', true))
  WITH CHECK (tenant_id = current_setting('app.current_org_id', true));
REVOKE ALL ON public.job_effects FROM PUBLIC;
REVOKE ALL ON FUNCTION public.job_effect_vectors_valid(jsonb, integer) FROM PUBLIC;
-- Supabase installations may have default privileges for browser API roles.
-- Remove those explicitly when the roles exist; do not create or alter roles.
DO $$ DECLARE api_role text; BEGIN
  FOREACH api_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = api_role) THEN
      EXECUTE format('REVOKE ALL ON public.job_effects FROM %I', api_role);
      EXECUTE format('REVOKE ALL ON FUNCTION public.job_effect_vectors_valid(jsonb, integer) FROM %I', api_role);
    END IF;
  END LOOP;
END $$;
GRANT SELECT, INSERT, UPDATE ON public.job_effects TO app_ledger;
GRANT EXECUTE ON FUNCTION public.job_effect_vectors_valid(jsonb, integer) TO app_ledger;
-- No DELETE grant: deleting an admission can enable a duplicate remote effect.
