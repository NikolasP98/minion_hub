-- Disabled-by-default dependency digest. Stable accounting namespace and immutable replay evidence.
CREATE TABLE IF NOT EXISTS pulse_digest_admission (
 org_id text NOT NULL, owner_profile_id text NOT NULL, budget_namespace text NOT NULL,
 policy_revision text NOT NULL, policy_hash text NOT NULL, enabled boolean NOT NULL DEFAULT false,
 approval_revision text NOT NULL, approval_expires_at timestamptz NOT NULL,
 max_calls integer NOT NULL CHECK(max_calls BETWEEN 0 AND 5), upper_micro_usd bigint NOT NULL CHECK(upper_micro_usd BETWEEN 0 AND 9007199254740991),
 daily_micro_usd bigint NOT NULL CHECK(daily_micro_usd BETWEEN 0 AND 9007199254740991),
 budget_day date NOT NULL DEFAULT (now() AT TIME ZONE 'UTC')::date,
 attempted_calls integer NOT NULL DEFAULT 0 CHECK(attempted_calls BETWEEN 0 AND 5),
 reserved_micro_usd bigint NOT NULL DEFAULT 0 CHECK(reserved_micro_usd BETWEEN 0 AND 9007199254740991),
 settled_micro_usd bigint NOT NULL DEFAULT 0 CHECK(settled_micro_usd BETWEEN 0 AND 9007199254740991),
 unknown_exposure_fence boolean NOT NULL DEFAULT false, active_run_id uuid, active_attempt_id uuid,
 admission_generation integer NOT NULL DEFAULT 0 CHECK(admission_generation>=0),
 next_poll_at timestamptz NOT NULL DEFAULT now(), collection_owner uuid, collection_generation integer NOT NULL DEFAULT 0 CHECK(collection_generation>=0), collection_lease_until timestamptz,
 last_collection_outcome text, last_collection_at timestamptz, retired_at timestamptz, updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(org_id,owner_profile_id,budget_namespace), UNIQUE(org_id,owner_profile_id),
 CHECK((collection_owner IS NULL)=(collection_lease_until IS NULL)), CHECK(active_attempt_id IS NULL OR active_run_id IS NOT NULL),
 CHECK(upper_micro_usd<=daily_micro_usd)
);
CREATE TABLE IF NOT EXISTS pulse_digest_runs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id text NOT NULL, owner_profile_id text NOT NULL, budget_namespace text NOT NULL,
 policy_revision text NOT NULL, policy_hash text NOT NULL, source_snapshot_hash text NOT NULL, request_hash text NOT NULL,
 source_revisions jsonb NOT NULL DEFAULT '[]'::jsonb CHECK(octet_length(source_revisions::text)<=4096),
 snapshot jsonb CHECK(snapshot IS NULL OR octet_length(snapshot::text)<=131072), evidence text CHECK(evidence IS NULL OR octet_length(evidence)<=49152),
 requested_model text NOT NULL, resolved_model text, bg_job_id text NOT NULL UNIQUE REFERENCES bg_jobs(id) ON DELETE RESTRICT,
 state text NOT NULL DEFAULT 'queued' CHECK(state IN('queued','reasoning_admitted','reasoning_received','published','no_signal','superseded','failed','canceled','indeterminate')),
 attempt_id uuid, admitted_generation integer CHECK(admitted_generation>0), admitted_day date, admitted_at timestamptz,
 upper_micro_usd bigint CHECK(upper_micro_usd BETWEEN 0 AND 9007199254740991),
 raw_response text CHECK(raw_response IS NULL OR octet_length(raw_response)<=65536), receipt_hash text,
 usage_status text CHECK(usage_status IN('known','unknown')), cost_micro_usd bigint CHECK(cost_micro_usd BETWEEN 0 AND 9007199254740991),
 receipt_metadata jsonb, result jsonb, result_hash text, card_id uuid, safe_reason text,
 attempt_count integer NOT NULL DEFAULT 0 CHECK(attempt_count BETWEEN 0 AND 3), next_attempt_at bigint,
 redacted_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(org_id,owner_profile_id,policy_revision,source_snapshot_hash), UNIQUE(org_id,owner_profile_id,id),
 FOREIGN KEY(org_id,owner_profile_id,budget_namespace) REFERENCES pulse_digest_admission(org_id,owner_profile_id,budget_namespace) ON DELETE RESTRICT,
 FOREIGN KEY(org_id,card_id) REFERENCES pulse_proposals(org_id,id) ON DELETE RESTRICT,
 CHECK(state NOT IN('reasoning_admitted','reasoning_received','indeterminate') OR (attempt_id IS NOT NULL AND admitted_generation IS NOT NULL AND admitted_day IS NOT NULL AND admitted_at IS NOT NULL AND upper_micro_usd IS NOT NULL)),
 CHECK(state<>'indeterminate' OR (safe_reason IS NOT NULL AND length(btrim(safe_reason))>0)),
 CHECK(state<>'reasoning_received' OR (receipt_hash IS NOT NULL AND raw_response IS NOT NULL AND usage_status IS NOT NULL AND receipt_metadata IS NOT NULL)), CHECK(state<>'published' OR (card_id IS NOT NULL AND result_hash IS NOT NULL AND result IS NOT NULL)),
 CHECK(state<>'queued' OR (attempt_id IS NULL AND admitted_generation IS NULL AND admitted_at IS NULL AND admitted_day IS NULL AND receipt_hash IS NULL AND usage_status IS NULL AND cost_micro_usd IS NULL AND raw_response IS NULL)),
 CHECK((usage_status='known' AND cost_micro_usd IS NOT NULL) OR (usage_status IS DISTINCT FROM 'known' AND cost_micro_usd IS NULL)),
 CHECK((redacted_at IS NULL AND evidence IS NOT NULL AND snapshot IS NOT NULL) OR (redacted_at IS NOT NULL AND evidence IS NULL AND snapshot IS NULL))
);
CREATE TABLE IF NOT EXISTS pulse_digest_sources (
 org_id text NOT NULL, owner_profile_id text NOT NULL, policy_revision text NOT NULL, source_id text NOT NULL,
 revision integer NOT NULL DEFAULT 0 CHECK(revision>=0), content_hash text, etag text, last_modified text,
 evidence jsonb CHECK(evidence IS NULL OR octet_length(evidence::text)<=65536), last_run_id uuid, updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(org_id,owner_profile_id,policy_revision,source_id),
 FOREIGN KEY(org_id,owner_profile_id,last_run_id) REFERENCES pulse_digest_runs(org_id,owner_profile_id,id) ON DELETE RESTRICT
);
CREATE TABLE IF NOT EXISTS pulse_feedback (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id text NOT NULL, owner_profile_id text NOT NULL, actor_profile_id text NOT NULL,
 proposal_id uuid NOT NULL, content_revision integer NOT NULL CHECK(content_revision>0), digest_run_id uuid NOT NULL,
 policy_revision text NOT NULL, source_snapshot_hash text NOT NULL, content_hash text NOT NULL,
 source_revisions jsonb NOT NULL CHECK(octet_length(source_revisions::text)<=4096),
 reason text NOT NULL CHECK(reason IN('useful','irrelevant','duplicate','fact_error','already_handled','too_late')),
 comment text CHECK(char_length(comment)<=500), client_action_id uuid NOT NULL,
 supersedes_feedback_id uuid UNIQUE REFERENCES pulse_feedback(id) ON DELETE RESTRICT,
 payload_hash text NOT NULL, redacted_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(org_id,actor_profile_id,client_action_id), CHECK(actor_profile_id=owner_profile_id), CHECK(supersedes_feedback_id IS DISTINCT FROM id),
 FOREIGN KEY(org_id,proposal_id) REFERENCES pulse_proposals(org_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(org_id,owner_profile_id,digest_run_id) REFERENCES pulse_digest_runs(org_id,owner_profile_id,id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS pulse_digest_runs_retention ON pulse_digest_runs(org_id,owner_profile_id,created_at) WHERE redacted_at IS NULL;
CREATE INDEX IF NOT EXISTS pulse_feedback_owner_page ON pulse_feedback(org_id,owner_profile_id,created_at,id);
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['pulse_digest_admission','pulse_digest_runs','pulse_digest_sources','pulse_feedback'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('DROP POLICY IF EXISTS digest_owner_org ON %I',t);
  EXECUTE format('CREATE POLICY digest_owner_org ON %I TO app_ledger USING(org_id=current_setting(''app.current_org_id'',true) AND owner_profile_id=current_setting(''app.current_profile_id'',true)) WITH CHECK(org_id=current_setting(''app.current_org_id'',true) AND owner_profile_id=current_setting(''app.current_profile_id'',true))',t);
  EXECUTE format('GRANT SELECT,INSERT,UPDATE ON %I TO app_ledger',t);
  EXECUTE format('REVOKE DELETE ON %I FROM app_ledger',t);
 END LOOP;
END $$;
CREATE OR REPLACE FUNCTION pulse_digest_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE job bg_jobs%ROWTYPE; ns pulse_digest_admission%ROWTYPE;
BEGIN
 IF TG_OP='DELETE' THEN
  SELECT * INTO ns FROM pulse_digest_admission WHERE org_id=OLD.org_id AND owner_profile_id=OLD.owner_profile_id AND budget_namespace=OLD.budget_namespace;
  IF NOT FOUND OR ns.retired_at IS NULL OR ns.active_run_id IS NOT NULL OR ns.unknown_exposure_fence OR ns.reserved_micro_usd<>0 THEN RAISE EXCEPTION 'Retire and settle namespace before tombstone deletion'; END IF;
  RETURN OLD;
 END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.state NOT IN('queued','canceled','indeterminate') THEN RAISE EXCEPTION 'Digest initial state requires admission transition' USING ERRCODE='23514'; END IF;
  SELECT * INTO job FROM bg_jobs WHERE id=NEW.bg_job_id;
  IF NOT FOUND OR job.tenant_id<>NEW.org_id OR job.user_id IS DISTINCT FROM NEW.owner_profile_id OR job.ref_id IS DISTINCT FROM NEW.id::text OR job.type<>'pulse_digest' THEN RAISE EXCEPTION 'Digest job binding mismatch' USING ERRCODE='23514'; END IF;
 ELSE
  IF NEW.source_revisions IS DISTINCT FROM OLD.source_revisions THEN RAISE EXCEPTION 'Digest source revisions are immutable' USING ERRCODE='23514'; END IF;
  IF ROW(NEW.id,NEW.org_id,NEW.owner_profile_id,NEW.budget_namespace,NEW.policy_revision,NEW.policy_hash,NEW.source_snapshot_hash,NEW.request_hash,NEW.requested_model,NEW.bg_job_id,NEW.created_at) IS DISTINCT FROM ROW(OLD.id,OLD.org_id,OLD.owner_profile_id,OLD.budget_namespace,OLD.policy_revision,OLD.policy_hash,OLD.source_snapshot_hash,OLD.request_hash,OLD.requested_model,OLD.bg_job_id,OLD.created_at) THEN RAISE EXCEPTION 'Digest identity is immutable' USING ERRCODE='23514'; END IF;
  IF OLD.admitted_at IS NOT NULL AND ROW(NEW.attempt_id,NEW.admitted_generation,NEW.admitted_day,NEW.admitted_at,NEW.upper_micro_usd) IS DISTINCT FROM ROW(OLD.attempt_id,OLD.admitted_generation,OLD.admitted_day,OLD.admitted_at,OLD.upper_micro_usd) THEN RAISE EXCEPTION 'Digest admission is immutable' USING ERRCODE='23514'; END IF;
  IF OLD.receipt_hash IS NOT NULL AND ROW(NEW.receipt_hash,NEW.usage_status,NEW.cost_micro_usd,NEW.resolved_model,NEW.receipt_metadata) IS DISTINCT FROM ROW(OLD.receipt_hash,OLD.usage_status,OLD.cost_micro_usd,OLD.resolved_model,OLD.receipt_metadata) THEN RAISE EXCEPTION 'Digest receipt is immutable' USING ERRCODE='23514'; END IF;
  IF OLD.result_hash IS NOT NULL AND ROW(NEW.result,NEW.result_hash,NEW.card_id) IS DISTINCT FROM ROW(OLD.result,OLD.result_hash,OLD.card_id) THEN RAISE EXCEPTION 'Digest result is immutable' USING ERRCODE='23514'; END IF;
  IF ROW(NEW.evidence,NEW.snapshot,NEW.raw_response) IS DISTINCT FROM ROW(OLD.evidence,OLD.snapshot,OLD.raw_response) AND NOT (current_setting('role')<>'app_ledger' AND OLD.created_at<now()-interval '30 days' AND NEW.redacted_at IS NOT NULL AND NEW.evidence IS NULL AND NEW.snapshot IS NULL AND NEW.raw_response IS NULL AND NEW.state<>'queued') AND NOT (OLD.receipt_hash IS NULL AND NEW.receipt_hash IS NOT NULL AND NEW.evidence IS NOT DISTINCT FROM OLD.evidence AND NEW.snapshot IS NOT DISTINCT FROM OLD.snapshot) THEN RAISE EXCEPTION 'Invalid digest evidence mutation' USING ERRCODE='23514'; END IF;
  IF NOT (NEW.state=OLD.state OR (OLD.state='queued' AND NEW.state IN('reasoning_admitted','no_signal','superseded','failed','canceled')) OR (OLD.state='reasoning_admitted' AND NEW.state IN('reasoning_received','indeterminate')) OR (OLD.state='reasoning_received' AND NEW.state IN('published','no_signal','superseded','failed','indeterminate')) OR (OLD.state='indeterminate' AND NEW.state='indeterminate')) THEN RAISE EXCEPTION 'Invalid digest transition' USING ERRCODE='23514'; END IF;
 END IF;
 IF NEW.card_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM pulse_proposals p WHERE p.id=NEW.card_id AND p.org_id=NEW.org_id AND p.owner_profile_id=NEW.owner_profile_id AND p.internal_run_id=NEW.id AND p.internal_policy_revision=NEW.policy_revision AND p.internal_input_hash=NEW.source_snapshot_hash AND p.internal_result_hash=NEW.result_hash AND p.kind='digest' AND p.source='dependency-digest' AND p.dedup_key='internal:dependency-digest:v1:'||NEW.id::text) THEN RAISE EXCEPTION 'Digest card binding mismatch' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
DO $$ BEGIN EXECUTE format('ALTER FUNCTION pulse_digest_guard() SET search_path TO %I, pg_catalog',current_schema()); END $$;
REVOKE ALL ON FUNCTION pulse_digest_guard() FROM PUBLIC;
DROP TRIGGER IF EXISTS pulse_digest_guard ON pulse_digest_runs;
CREATE TRIGGER pulse_digest_guard BEFORE INSERT OR UPDATE OR DELETE ON pulse_digest_runs FOR EACH ROW EXECUTE FUNCTION pulse_digest_guard();
CREATE OR REPLACE FUNCTION pulse_digest_namespace_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Accounting namespaces are permanent'; END IF;
 IF ROW(NEW.org_id,NEW.owner_profile_id,NEW.budget_namespace) IS DISTINCT FROM ROW(OLD.org_id,OLD.owner_profile_id,OLD.budget_namespace) OR (OLD.retired_at IS NOT NULL AND NEW.retired_at IS DISTINCT FROM OLD.retired_at) OR (OLD.unknown_exposure_fence AND NOT NEW.unknown_exposure_fence) THEN RAISE EXCEPTION 'Digest namespace cannot be reset' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS pulse_digest_namespace_guard ON pulse_digest_admission;
CREATE TRIGGER pulse_digest_namespace_guard BEFORE UPDATE OR DELETE ON pulse_digest_admission FOR EACH ROW EXECUTE FUNCTION pulse_digest_namespace_guard();
CREATE OR REPLACE FUNCTION pulse_feedback_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE predecessor pulse_feedback%ROWTYPE;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Feedback history is retained'; END IF;
 IF TG_OP='UPDATE' THEN
  IF (to_jsonb(NEW)-'comment'-'redacted_at') IS DISTINCT FROM (to_jsonb(OLD)-'comment'-'redacted_at') OR NOT (current_setting('role')<>'app_ledger' AND OLD.created_at<now()-interval '30 days' AND OLD.redacted_at IS NULL AND NEW.comment IS NULL AND NEW.redacted_at IS NOT NULL) THEN RAISE EXCEPTION 'Feedback is append only' USING ERRCODE='23514'; END IF;
 ELSE
  IF NOT EXISTS(SELECT 1 FROM pulse_proposals p JOIN pulse_digest_runs r ON r.id=p.internal_run_id AND r.org_id=p.org_id WHERE p.id=NEW.proposal_id AND p.org_id=NEW.org_id AND p.owner_profile_id=NEW.owner_profile_id AND p.revision=NEW.content_revision AND p.internal_result_hash=NEW.content_hash AND r.result_hash=NEW.content_hash AND r.card_id=p.id AND r.id=NEW.digest_run_id AND r.policy_revision=NEW.policy_revision AND r.source_snapshot_hash=NEW.source_snapshot_hash AND r.source_revisions=NEW.source_revisions AND r.state='published') THEN RAISE EXCEPTION 'Feedback card binding mismatch' USING ERRCODE='23514'; END IF;
  IF NEW.supersedes_feedback_id IS NOT NULL THEN
   SELECT * INTO predecessor FROM pulse_feedback WHERE id=NEW.supersedes_feedback_id FOR UPDATE;
   IF NOT FOUND OR ROW(predecessor.org_id,predecessor.owner_profile_id,predecessor.proposal_id,predecessor.content_revision,predecessor.digest_run_id,predecessor.content_hash) IS DISTINCT FROM ROW(NEW.org_id,NEW.owner_profile_id,NEW.proposal_id,NEW.content_revision,NEW.digest_run_id,NEW.content_hash) THEN RAISE EXCEPTION 'Feedback predecessor mismatch' USING ERRCODE='23514'; END IF;
  END IF;
 END IF;
 RETURN NEW;
END $$;
DO $$ BEGIN EXECUTE format('ALTER FUNCTION pulse_feedback_guard() SET search_path TO %I, pg_catalog',current_schema()); END $$;
REVOKE ALL ON FUNCTION pulse_feedback_guard() FROM PUBLIC;
DROP TRIGGER IF EXISTS pulse_feedback_guard ON pulse_feedback;
CREATE TRIGGER pulse_feedback_guard BEFORE INSERT OR UPDATE OR DELETE ON pulse_feedback FOR EACH ROW EXECUTE FUNCTION pulse_feedback_guard();
