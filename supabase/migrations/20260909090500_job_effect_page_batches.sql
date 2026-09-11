-- Authored additive905 after903/904. No production execution or applied-file rewrite.
-- Application activation requires the matching page foundation and drained old writers.
-- TODO(handoff): Historical receipt/tombstone retention and missing-owner recovery need
-- explicit policy. See proposals/2026-09-08-platform-qc-remediation.md (JOB-02).
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
CREATE UNIQUE INDEX job_effects_tenant_id_kind ON public.job_effects(tenant_id,id,kind);

CREATE FUNCTION public.job_effect_batch_descriptor_valid(descriptor jsonb, members jsonb, expected integer)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE SET search_path=pg_catalog,public AS $$
DECLARE member jsonb;
BEGIN
  IF descriptor IS NULL OR members IS NULL OR expected IS NULL OR expected NOT BETWEEN 1 AND 64
    OR jsonb_typeof(descriptor)<>'object' OR jsonb_typeof(members)<>'array' THEN RETURN false; END IF;
  IF jsonb_array_length(members)<>expected OR octet_length(descriptor::text)>4096 THEN RETURN false; END IF;
  IF (SELECT count(*) FROM jsonb_object_keys(descriptor))<>7 THEN RETURN false; END IF;
  FOR member IN SELECT jsonb_array_elements(members) LOOP
    IF jsonb_typeof(member)<>'string' OR (member#>>'{}') !~ '^[a-f0-9]{64}$' THEN RETURN false; END IF;
  END LOOP;
  IF (SELECT count(DISTINCT value) FROM jsonb_array_elements_text(members))<>expected THEN RETURN false; END IF;
  RETURN (descriptor ?& ARRAY['payloadHash','endpoint','model','normalization','count','dimensions','pipelineVersion']
    AND jsonb_typeof(descriptor->'payloadHash')='string' AND descriptor->>'payloadHash' ~ '^[a-f0-9]{64}$'
    AND jsonb_typeof(descriptor->'endpoint')='string' AND length(descriptor->>'endpoint') BETWEEN 1 AND 512
    AND jsonb_typeof(descriptor->'model')='string' AND length(descriptor->>'model') BETWEEN 1 AND 128
    AND jsonb_typeof(descriptor->'normalization')='string' AND length(descriptor->>'normalization') BETWEEN 1 AND 128
    AND jsonb_typeof(descriptor->'pipelineVersion')='string' AND length(descriptor->>'pipelineVersion') BETWEEN 1 AND 128
    AND jsonb_typeof(descriptor->'count')='number' AND descriptor->>'count'=expected::text
    AND jsonb_typeof(descriptor->'dimensions')='number' AND descriptor->>'dimensions'='1536') IS TRUE;
END $$;

CREATE TABLE public.job_effect_pages (
  id text PRIMARY KEY, tenant_id text NOT NULL, job_id text NOT NULL, page_key text NOT NULL,
  manifest_hash text NOT NULL, descriptor jsonb NOT NULL, state text NOT NULL DEFAULT 'bound', completion jsonb,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT job_effect_pages_identity CHECK(id ~ '^[a-f0-9]{64}$' AND length(tenant_id) BETWEEN 1 AND 256
    AND length(job_id) BETWEEN 1 AND 256 AND length(page_key) BETWEEN 1 AND 160 AND manifest_hash ~ '^[a-f0-9]{64}$'),
  CONSTRAINT job_effect_pages_shape CHECK((jsonb_typeof(descriptor)='object' AND octet_length(descriptor::text)<=262144
    AND ((state='bound' AND completion IS NULL) OR (state='published' AND jsonb_typeof(completion)='object'))) IS TRUE)
);
CREATE UNIQUE INDEX job_effect_pages_job_key ON public.job_effect_pages(tenant_id,job_id,page_key);
CREATE TABLE public.job_effect_batches (
  id text PRIMARY KEY, tenant_id text NOT NULL, reservation_job_id text NOT NULL, reservation_generation integer NOT NULL,
  dispatch_job_id text, dispatch_generation integer, descriptor jsonb NOT NULL, unit_ids jsonb NOT NULL,
  membership_hash text NOT NULL, count integer NOT NULL, state text NOT NULL DEFAULT 'reserved', result jsonb,
  abandonment_reason text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT job_effect_batches_identity CHECK(id ~ '^[a-f0-9]{64}$' AND length(tenant_id) BETWEEN 1 AND 256
    AND length(reservation_job_id) BETWEEN 1 AND 256 AND reservation_generation>=0 AND membership_hash ~ '^[a-f0-9]{64}$' AND count BETWEEN 1 AND 64),
  CONSTRAINT job_effect_batches_descriptor CHECK(public.job_effect_batch_descriptor_valid(descriptor,unit_ids,count)),
  CONSTRAINT job_effect_batches_shape CHECK((((state IN ('reserved','abandoned_unsent') AND dispatch_job_id IS NULL AND dispatch_generation IS NULL AND result IS NULL)
    OR (state IN ('admitted','received') AND length(dispatch_job_id) BETWEEN 1 AND 256 AND dispatch_generation>=0
      AND ((state='admitted' AND result IS NULL) OR (state='received' AND public.job_effect_vectors_valid(result,count)))))
    AND ((state='abandoned_unsent' AND length(abandonment_reason) BETWEEN 1 AND 160) OR (state<>'abandoned_unsent' AND abandonment_reason IS NULL))) IS TRUE)
);
CREATE UNIQUE INDEX job_effect_batches_tenant_id ON public.job_effect_batches(tenant_id,id);
CREATE INDEX job_effect_batches_owner ON public.job_effect_batches(tenant_id,reservation_job_id);
CREATE TABLE public.job_effect_units (
  id text PRIMARY KEY, tenant_id text NOT NULL, head_id text NOT NULL, head_kind text NOT NULL DEFAULT 'head',
  revision uuid NOT NULL, source_hash text NOT NULL, manifest_hash text NOT NULL, chunk_key text NOT NULL,
  payload_hash text NOT NULL, policy_hash text NOT NULL, batch_id text, vector_index integer,
  first_published_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT job_effect_units_head_fk FOREIGN KEY(tenant_id,head_id,head_kind) REFERENCES public.job_effects(tenant_id,id,kind),
  CONSTRAINT job_effect_units_batch_fk FOREIGN KEY(tenant_id,batch_id) REFERENCES public.job_effect_batches(tenant_id,id),
  CONSTRAINT job_effect_units_identity CHECK(id ~ '^[a-f0-9]{64}$' AND length(tenant_id) BETWEEN 1 AND 256 AND head_kind='head'
    AND source_hash ~ '^[a-f0-9]{64}$' AND manifest_hash ~ '^[a-f0-9]{64}$' AND payload_hash ~ '^[a-f0-9]{64}$'
    AND policy_hash ~ '^[a-f0-9]{64}$' AND length(chunk_key) BETWEEN 1 AND 160),
  CONSTRAINT job_effect_units_placement CHECK(((batch_id IS NULL AND vector_index IS NULL) OR (batch_id IS NOT NULL AND vector_index BETWEEN 0 AND 63)) IS TRUE)
);
CREATE UNIQUE INDEX job_effect_units_semantic ON public.job_effect_units(tenant_id,head_id,revision,source_hash,manifest_hash,chunk_key,payload_hash,policy_hash);
CREATE UNIQUE INDEX job_effect_units_position ON public.job_effect_units(tenant_id,batch_id,vector_index) WHERE batch_id IS NOT NULL;

-- Internal immediate guards use trusted-service labels, not unforgeable credentials.
-- The real helper prelocks jobs before heads. A forged manifest cannot prove that
-- arbitrary SQL previously acquired those locks; this is not a hostile-SQL sandbox.
CREATE FUNCTION public.job_effect_page_actor(tenant text, expected_job text, expected_generation integer,
  previous_job text, previous_generation integer)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE actor text := current_setting('app.job_effect_job_id',true);
  generation_text text := current_setting('app.job_effect_lease_generation',true);
  owners_text text := current_setting('app.job_effect_prelocked_owners',true);
  generation integer; owners jsonb; ref jsonb; current_job public.bg_jobs%ROWTYPE; old_job public.bg_jobs%ROWTYPE;
BEGIN
  IF tenant IS DISTINCT FROM nullif(current_setting('app.current_org_id',true),'')
    OR actor IS NULL OR length(actor) NOT BETWEEN 1 AND 256
    OR generation_text IS NULL OR generation_text !~ '^(0|[1-9][0-9]{0,9})$'
    OR owners_text IS NULL OR octet_length(owners_text)>131072 THEN
    RAISE EXCEPTION 'job effect actor context missing or malformed' USING ERRCODE='23514';
  END IF;
  IF generation_text::bigint>2147483647 THEN RAISE EXCEPTION 'job effect actor generation invalid' USING ERRCODE='23514'; END IF;
  generation := generation_text::integer;
  owners := owners_text::jsonb;
  IF jsonb_typeof(owners)<>'array' THEN RAISE EXCEPTION 'job effect owner manifest invalid' USING ERRCODE='23514'; END IF;
  IF jsonb_array_length(owners)>256 THEN RAISE EXCEPTION 'job effect owner manifest capacity' USING ERRCODE='23514'; END IF;
  FOR ref IN SELECT jsonb_array_elements(owners) LOOP
    IF jsonb_typeof(ref)<>'object' THEN RAISE EXCEPTION 'job effect owner reference invalid' USING ERRCODE='23514'; END IF;
    IF (SELECT count(*) FROM jsonb_object_keys(ref))<>2 OR NOT (ref ?& ARRAY['jobId','reservationGeneration'])
      OR jsonb_typeof(ref->'jobId')<>'string' OR length(ref->>'jobId') NOT BETWEEN 1 AND 256
      OR jsonb_typeof(ref->'reservationGeneration')<>'number'
      OR ref->>'reservationGeneration' !~ '^(0|[1-9][0-9]{0,9})$' THEN
      RAISE EXCEPTION 'job effect owner reference invalid' USING ERRCODE='23514';
    END IF;
    IF (ref->>'reservationGeneration')::bigint>2147483647 THEN
      RAISE EXCEPTION 'job effect owner generation invalid' USING ERRCODE='23514'; END IF;
  END LOOP;
  -- Reject a missing declaration before any possible foreign-row lock.
  IF previous_job IS NOT NULL AND previous_job<>actor AND NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(owners) r WHERE r->>'jobId'=previous_job
      AND (r->>'reservationGeneration')::integer=previous_generation) THEN
    RAISE EXCEPTION 'undeclared reservation owner' USING ERRCODE='23514';
  END IF;
  SELECT * INTO current_job FROM public.bg_jobs WHERE tenant_id=tenant AND id=actor FOR UPDATE NOWAIT;
  IF NOT FOUND OR current_job.status<>'running' OR current_job.lease_generation<>generation
    OR coalesce(current_job.lease_until,0)<=floor(extract(epoch FROM clock_timestamp())*1000) THEN
    RAISE EXCEPTION 'job effect actor ownership lost' USING ERRCODE='23514';
  END IF;
  IF (expected_job IS NOT NULL AND expected_job<>actor)
    OR (expected_generation IS NOT NULL AND expected_generation<>generation) THEN
    RAISE EXCEPTION 'job effect actor does not own transition' USING ERRCODE='23514';
  END IF;
  IF previous_job IS NOT NULL THEN
    IF previous_job=actor THEN
      old_job := current_job;
    ELSE
      SELECT * INTO old_job FROM public.bg_jobs WHERE tenant_id=tenant AND id=previous_job FOR UPDATE NOWAIT;
      IF NOT FOUND THEN RAISE EXCEPTION 'owner_missing: reservation owner requires recovery' USING ERRCODE='23514'; END IF;
    END IF;
    IF previous_job<>actor AND old_job.status='running' AND old_job.lease_generation=previous_generation
      AND coalesce(old_job.lease_until,0)>floor(extract(epoch FROM clock_timestamp())*1000) THEN
      RAISE EXCEPTION 'reservation owner is live' USING ERRCODE='23514';
    END IF;
  END IF;
END $$;

CREATE FUNCTION public.job_effect_pages_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE source jsonb; head public.job_effects%ROWTYPE; total integer := 0; unit_id text;
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'page receipts cannot be deleted' USING ERRCODE='23514'; END IF;
  PERFORM public.job_effect_page_actor(NEW.tenant_id,NEW.job_id,NULL,NULL,NULL);
  IF TG_OP='INSERT' THEN
    IF NEW.state<>'bound' OR NEW.completion IS NOT NULL THEN RAISE EXCEPTION 'page must begin bound' USING ERRCODE='23514'; END IF;
  ELSE
    IF (to_jsonb(NEW)-ARRAY['state','completion','updated_at']) IS DISTINCT FROM
      (to_jsonb(OLD)-ARRAY['state','completion','updated_at']) OR OLD.state<>'bound' OR NEW.state<>'published' THEN
      RAISE EXCEPTION 'page descriptor and publication are immutable' USING ERRCODE='23514';
    END IF;
  END IF;
  IF NEW.descriptor->>'version' IS DISTINCT FROM '1' OR NEW.descriptor->>'pageKey' IS DISTINCT FROM NEW.page_key
    OR jsonb_typeof(NEW.descriptor->'sources') IS DISTINCT FROM 'array'
    OR coalesce(NEW.descriptor->>'mode','') NOT IN ('embedded','disabled','qdrant') THEN
    RAISE EXCEPTION 'invalid page descriptor' USING ERRCODE='23514'; END IF;
  IF jsonb_array_length(NEW.descriptor->'sources')>64 THEN RAISE EXCEPTION 'page source capacity' USING ERRCODE='23514'; END IF;
  FOR source IN SELECT jsonb_array_elements(NEW.descriptor->'sources') LOOP
    IF jsonb_typeof(source->'chunks') IS DISTINCT FROM 'array' OR jsonb_typeof(source->'unitIds') IS DISTINCT FROM 'array'
      OR jsonb_typeof(source->'requiredChunkKeys') IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'invalid page source descriptor' USING ERRCODE='23514'; END IF;
    total := total+jsonb_array_length(source->'chunks');
    IF total>256 OR jsonb_array_length(source->'unitIds')<>jsonb_array_length(source->'requiredChunkKeys')
      OR jsonb_array_length(source->'unitIds')>jsonb_array_length(source->'chunks') THEN
      RAISE EXCEPTION 'invalid page canonical membership' USING ERRCODE='23514'; END IF;
    SELECT * INTO head FROM public.job_effects WHERE tenant_id=NEW.tenant_id AND id=source->>'sourceKey' AND kind='head' FOR UPDATE NOWAIT;
    IF NOT FOUND OR head.state<>'active' OR head.revision::text IS DISTINCT FROM source#>>'{request,revision}'
      OR head.source_hash IS DISTINCT FROM source#>>'{request,sourceHash}' OR head.family IS DISTINCT FROM source#>>'{request,family}'
      OR head.entity_id IS DISTINCT FROM source#>>'{request,entityId}' OR head.manifest_hash IS DISTINCT FROM source->>'manifestHash' THEN
      RAISE EXCEPTION 'page source is not current' USING ERRCODE='23514'; END IF;
    IF NEW.state='published' AND NEW.descriptor->>'mode'='embedded' THEN
      FOR unit_id IN SELECT jsonb_array_elements_text(source->'unitIds') LOOP
        IF NOT EXISTS(SELECT 1 FROM public.job_effect_units u JOIN public.job_effect_batches b
          ON b.tenant_id=u.tenant_id AND b.id=u.batch_id
          WHERE u.tenant_id=NEW.tenant_id AND u.id=unit_id AND u.head_id=head.id AND u.revision=head.revision
            AND u.source_hash=head.source_hash AND u.manifest_hash=head.manifest_hash AND b.state='received') THEN
          RAISE EXCEPTION 'page publication requires complete current units' USING ERRCODE='23514'; END IF;
      END LOOP;
    END IF;
  END LOOP;
  RETURN NEW;
END $$;
CREATE TRIGGER job_effect_pages_guard BEFORE INSERT OR UPDATE OR DELETE ON public.job_effect_pages
  FOR EACH ROW EXECUTE FUNCTION public.job_effect_pages_guard();

CREATE FUNCTION public.job_effect_batches_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE membership_text text;
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'batch receipts cannot be deleted' USING ERRCODE='23514'; END IF;
  -- Members are fixed hexadecimal strings, so compact array framing is unambiguous.
  IF NOT public.job_effect_batch_descriptor_valid(NEW.descriptor,NEW.unit_ids,NEW.count) THEN
    RAISE EXCEPTION 'invalid complete batch descriptor' USING ERRCODE='23514'; END IF;
  SELECT '['||string_agg(to_jsonb(value)::text,',' ORDER BY ordinality)||']' INTO membership_text
    FROM jsonb_array_elements_text(NEW.unit_ids) WITH ORDINALITY;
  IF encode(sha256(convert_to(membership_text,'UTF8')),'hex')<>NEW.membership_hash THEN
    RAISE EXCEPTION 'batch membership digest mismatch' USING ERRCODE='23514'; END IF;
  IF TG_OP='INSERT' THEN
    PERFORM public.job_effect_page_actor(NEW.tenant_id,NEW.reservation_job_id,NEW.reservation_generation,NULL,NULL);
    IF NEW.state<>'reserved' THEN RAISE EXCEPTION 'batch must begin reserved' USING ERRCODE='23514'; END IF;
  ELSE
    IF (to_jsonb(NEW)-ARRAY['reservation_job_id','reservation_generation','dispatch_job_id','dispatch_generation','state','result','abandonment_reason','updated_at'])
      IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['reservation_job_id','reservation_generation','dispatch_job_id','dispatch_generation','state','result','abandonment_reason','updated_at']) THEN
      RAISE EXCEPTION 'batch identity and membership are immutable' USING ERRCODE='23514'; END IF;
    IF OLD.state='reserved' AND NEW.state='reserved' THEN
      PERFORM public.job_effect_page_actor(NEW.tenant_id,NEW.reservation_job_id,NEW.reservation_generation,OLD.reservation_job_id,OLD.reservation_generation);
    ELSIF OLD.state='reserved' AND NEW.state='abandoned_unsent' THEN
      PERFORM public.job_effect_page_actor(NEW.tenant_id,NULL,NULL,OLD.reservation_job_id,OLD.reservation_generation);
      IF NEW.reservation_job_id<>OLD.reservation_job_id OR NEW.reservation_generation<>OLD.reservation_generation THEN
        RAISE EXCEPTION 'abandoned owner is immutable' USING ERRCODE='23514'; END IF;
    ELSIF OLD.state='reserved' AND NEW.state='admitted' THEN
      PERFORM public.job_effect_page_actor(NEW.tenant_id,OLD.reservation_job_id,OLD.reservation_generation,NULL,NULL);
      IF NEW.reservation_job_id<>OLD.reservation_job_id OR NEW.reservation_generation<>OLD.reservation_generation
        OR NEW.dispatch_job_id IS DISTINCT FROM OLD.reservation_job_id OR NEW.dispatch_generation IS DISTINCT FROM OLD.reservation_generation THEN
        RAISE EXCEPTION 'dispatch must preserve current reservation owner' USING ERRCODE='23514'; END IF;
    ELSIF OLD.state='admitted' AND NEW.state='received' THEN
      -- Historical response retention deliberately does not inspect semantic heads.
      PERFORM public.job_effect_page_actor(NEW.tenant_id,OLD.dispatch_job_id,OLD.dispatch_generation,NULL,NULL);
      IF NEW.reservation_job_id<>OLD.reservation_job_id OR NEW.reservation_generation<>OLD.reservation_generation
        OR NEW.dispatch_job_id IS DISTINCT FROM OLD.dispatch_job_id OR NEW.dispatch_generation IS DISTINCT FROM OLD.dispatch_generation THEN
        RAISE EXCEPTION 'response ownership is immutable' USING ERRCODE='23514'; END IF;
    ELSE
      RAISE EXCEPTION 'batch transition or immutable receipt mutation denied' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER job_effect_batches_guard BEFORE INSERT OR UPDATE OR DELETE ON public.job_effect_batches
  FOR EACH ROW EXECUTE FUNCTION public.job_effect_batches_guard();

CREATE FUNCTION public.job_effect_units_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE parent public.job_effect_batches%ROWTYPE; head public.job_effects%ROWTYPE;
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'semantic units cannot be deleted' USING ERRCODE='23514'; END IF;
  PERFORM public.job_effect_page_actor(NEW.tenant_id,NULL,NULL,NULL,NULL);
  IF TG_OP='UPDATE' THEN
    IF (to_jsonb(NEW)-ARRAY['batch_id','vector_index','first_published_at']) IS DISTINCT FROM
      (to_jsonb(OLD)-ARRAY['batch_id','vector_index','first_published_at']) THEN
      RAISE EXCEPTION 'semantic unit identity is immutable' USING ERRCODE='23514'; END IF;
    IF OLD.first_published_at IS NOT NULL AND NEW.first_published_at IS DISTINCT FROM OLD.first_published_at THEN
      RAISE EXCEPTION 'unit consumption is irreversible' USING ERRCODE='23514'; END IF;
    IF OLD.batch_id IS NOT NULL AND (NEW.batch_id IS DISTINCT FROM OLD.batch_id OR NEW.vector_index IS DISTINCT FROM OLD.vector_index) THEN
      SELECT * INTO parent FROM public.job_effect_batches WHERE tenant_id=OLD.tenant_id AND id=OLD.batch_id;
      IF NOT FOUND OR parent.state<>'abandoned_unsent' THEN
        RAISE EXCEPTION 'only an abandoned unsent placement may be released' USING ERRCODE='23514'; END IF;
    END IF;
  END IF;
  IF NEW.batch_id IS NOT NULL AND (TG_OP='INSERT' OR NEW.batch_id IS DISTINCT FROM OLD.batch_id OR NEW.vector_index IS DISTINCT FROM OLD.vector_index) THEN
    SELECT * INTO parent FROM public.job_effect_batches WHERE tenant_id=NEW.tenant_id AND id=NEW.batch_id;
    IF NOT FOUND OR parent.state<>'reserved' OR parent.unit_ids->>NEW.vector_index IS DISTINCT FROM NEW.id THEN
      RAISE EXCEPTION 'unit placement must match complete reserved membership' USING ERRCODE='23514'; END IF;
    PERFORM public.job_effect_page_actor(NEW.tenant_id,parent.reservation_job_id,parent.reservation_generation,NULL,NULL);
  END IF;
  IF TG_OP='INSERT' OR (OLD.first_published_at IS NULL AND NEW.first_published_at IS NOT NULL) THEN
    SELECT * INTO head FROM public.job_effects WHERE tenant_id=NEW.tenant_id AND id=NEW.head_id AND kind='head' FOR UPDATE NOWAIT;
    IF NOT FOUND OR head.state<>'active' OR head.revision<>NEW.revision OR head.source_hash<>NEW.source_hash
      OR head.manifest_hash IS DISTINCT FROM NEW.manifest_hash THEN
      RAISE EXCEPTION 'semantic unit source is not current' USING ERRCODE='23514'; END IF;
    IF NEW.first_published_at IS NOT NULL THEN
      SELECT * INTO parent FROM public.job_effect_batches WHERE tenant_id=NEW.tenant_id AND id=NEW.batch_id;
      IF NOT FOUND OR parent.state<>'received' THEN RAISE EXCEPTION 'unit publication needs complete receipt' USING ERRCODE='23514'; END IF;
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER job_effect_units_guard BEFORE INSERT OR UPDATE OR DELETE ON public.job_effect_units
  FOR EACH ROW EXECUTE FUNCTION public.job_effect_units_guard();

-- Structural commit checks do not read actor context, which is restored before COMMIT.
CREATE FUNCTION public.job_effect_batch_complete(tenant text, batch text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE parent public.job_effect_batches%ROWTYPE; actual jsonb; positions integer[];
BEGIN
  IF batch IS NULL THEN RETURN; END IF;
  SELECT * INTO parent FROM public.job_effect_batches WHERE tenant_id=tenant AND id=batch;
  IF NOT FOUND THEN RAISE EXCEPTION 'batch membership parent missing' USING ERRCODE='23514'; END IF;
  SELECT coalesce(jsonb_agg(id ORDER BY vector_index),'[]'::jsonb),array_agg(vector_index ORDER BY vector_index)
    INTO actual,positions FROM public.job_effect_units WHERE tenant_id=tenant AND batch_id=batch;
  IF parent.state='abandoned_unsent' THEN
    IF actual<>'[]'::jsonb THEN RAISE EXCEPTION 'abandoned batch retains active placements' USING ERRCODE='23514'; END IF;
  ELSIF actual IS DISTINCT FROM parent.unit_ids OR positions IS DISTINCT FROM ARRAY(SELECT generate_series(0,parent.count-1)) THEN
    RAISE EXCEPTION 'batch membership must be complete and dense' USING ERRCODE='23514';
  END IF;
END $$;
CREATE FUNCTION public.job_effect_membership_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
  IF TG_TABLE_NAME='job_effect_batches' THEN
    PERFORM public.job_effect_batch_complete(NEW.tenant_id,NEW.id);
  ELSE
    IF TG_OP<>'INSERT' THEN PERFORM public.job_effect_batch_complete(OLD.tenant_id,OLD.batch_id); END IF;
    IF TG_OP<>'DELETE' THEN PERFORM public.job_effect_batch_complete(NEW.tenant_id,NEW.batch_id); END IF;
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER job_effect_batches_complete AFTER INSERT OR UPDATE ON public.job_effect_batches
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.job_effect_membership_guard();
CREATE CONSTRAINT TRIGGER job_effect_units_complete AFTER INSERT OR UPDATE OR DELETE ON public.job_effect_units
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.job_effect_membership_guard();

ALTER TABLE public.job_effect_pages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_effect_pages FORCE ROW LEVEL SECURITY;
ALTER TABLE public.job_effect_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_effect_batches FORCE ROW LEVEL SECURITY;
ALTER TABLE public.job_effect_units ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_effect_units FORCE ROW LEVEL SECURITY;
CREATE POLICY job_effect_pages_org ON public.job_effect_pages TO app_ledger
  USING(tenant_id=current_setting('app.current_org_id',true)) WITH CHECK(tenant_id=current_setting('app.current_org_id',true));
CREATE POLICY job_effect_batches_org ON public.job_effect_batches TO app_ledger
  USING(tenant_id=current_setting('app.current_org_id',true)) WITH CHECK(tenant_id=current_setting('app.current_org_id',true));
CREATE POLICY job_effect_units_org ON public.job_effect_units TO app_ledger
  USING(tenant_id=current_setting('app.current_org_id',true)) WITH CHECK(tenant_id=current_setting('app.current_org_id',true));
REVOKE ALL ON public.job_effect_pages,public.job_effect_batches,public.job_effect_units FROM PUBLIC;
REVOKE ALL ON FUNCTION public.job_effect_batch_descriptor_valid(jsonb,jsonb,integer),
  public.job_effect_page_actor(text,text,integer,text,integer),public.job_effect_pages_guard(),
  public.job_effect_batches_guard(),public.job_effect_units_guard(),public.job_effect_batch_complete(text,text),
  public.job_effect_membership_guard() FROM PUBLIC;
DO $$ DECLARE api_role text; BEGIN
  FOREACH api_role IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=api_role) THEN
      EXECUTE format('REVOKE ALL ON public.job_effect_pages,public.job_effect_batches,public.job_effect_units FROM %I',api_role);
      EXECUTE format('REVOKE ALL ON FUNCTION public.job_effect_batch_descriptor_valid(jsonb,jsonb,integer),public.job_effect_page_actor(text,text,integer,text,integer),public.job_effect_pages_guard(),public.job_effect_batches_guard(),public.job_effect_units_guard(),public.job_effect_batch_complete(text,text),public.job_effect_membership_guard() FROM %I',api_role);
    END IF;
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.job_effect_page_actor(text,text,integer,text,integer),public.job_effect_pages_guard(),
  public.job_effect_batches_guard(),public.job_effect_units_guard(),public.job_effect_batch_complete(text,text),
  public.job_effect_membership_guard() FROM app_ledger;
GRANT SELECT,INSERT,UPDATE ON public.job_effect_pages,public.job_effect_batches,public.job_effect_units TO app_ledger;
GRANT EXECUTE ON FUNCTION public.job_effect_batch_descriptor_valid(jsonb,jsonb,integer) TO app_ledger;
-- No DELETE, direct actor-function execution, or additional bg_jobs privileges.
COMMIT;
