-- Reviewed Pulse content and one-way dispatch admission. Additive and rerunnable.
ALTER TABLE pulse_proposals ADD COLUMN IF NOT EXISTS revision integer NOT NULL DEFAULT 1;
ALTER TABLE pulse_proposals ADD COLUMN IF NOT EXISTS owner_profile_id text;
ALTER TABLE pulse_proposals ADD COLUMN IF NOT EXISTS decided_at timestamptz;
ALTER TABLE pulse_proposals ADD COLUMN IF NOT EXISTS internal_run_id uuid;
ALTER TABLE pulse_proposals ADD COLUMN IF NOT EXISTS internal_policy_revision text;
ALTER TABLE pulse_proposals ADD COLUMN IF NOT EXISTS internal_input_hash text;
ALTER TABLE pulse_proposals ADD COLUMN IF NOT EXISTS internal_result_hash text;
ALTER TABLE bg_jobs ADD COLUMN IF NOT EXISTS next_attempt_at bigint;
CREATE INDEX IF NOT EXISTS bg_jobs_selected_due_idx ON bg_jobs(tenant_id,type,user_id,next_attempt_at,updated_at);
CREATE UNIQUE INDEX IF NOT EXISTS pulse_proposals_org_id_uq ON pulse_proposals(org_id,id);
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='pulse_proposals'::regclass AND conname='pulse_revision_positive') THEN
  ALTER TABLE pulse_proposals ADD CONSTRAINT pulse_revision_positive CHECK(revision>=1);
  ALTER TABLE pulse_proposals ADD CONSTRAINT pulse_internal_binding CHECK (
    (internal_run_id IS NULL AND internal_policy_revision IS NULL AND internal_input_hash IS NULL AND internal_result_hash IS NULL)
    OR (internal_run_id IS NOT NULL AND internal_policy_revision IS NOT NULL AND internal_input_hash IS NOT NULL AND internal_result_hash IS NOT NULL AND owner_profile_id IS NOT NULL AND dedup_key LIKE 'internal:dependency-digest:v1:%'));
 END IF;
END $$;
CREATE TABLE IF NOT EXISTS pulse_dispatches (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id text NOT NULL,
 proposal_id uuid NOT NULL, proposal_revision integer NOT NULL CHECK(proposal_revision>=1), actor_profile_id text NOT NULL,
 gateway_id uuid NOT NULL, channel text NOT NULL CHECK(channel IN ('prd','dev')), agent_id text NOT NULL CHECK(length(agent_id)>0), origin_session_key text NOT NULL,
 action_kind text NOT NULL CHECK(action_kind IN ('create_event','reminder')),
 payload text CHECK(payload IS NULL OR octet_length(payload)<=16384), payload_hash text NOT NULL,
 tool_schema_revision text NOT NULL, authority_snapshot_hash text NOT NULL, gateway_qualification_revision text NOT NULL,
 state text NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','admitted','scheduled','indeterminate','rejected','canceled')),
 bg_job_id text NOT NULL REFERENCES bg_jobs(id) ON DELETE RESTRICT,
 attempt_count integer NOT NULL DEFAULT 0 CHECK(attempt_count BETWEEN 0 AND 3), next_attempt_at bigint,
 admitted_at timestamptz, admitted_generation integer CHECK(admitted_generation>0), remote_job_id text, safe_reason text,
 payload_redacted_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT pulse_dispatches_proposal_revision_uq UNIQUE(org_id,proposal_id,proposal_revision),
 CONSTRAINT pulse_dispatches_org_id_uq UNIQUE(org_id,id),
 FOREIGN KEY(org_id,proposal_id) REFERENCES pulse_proposals(org_id,id) ON DELETE RESTRICT,
 CHECK(state NOT IN ('admitted','scheduled','indeterminate') OR (admitted_at IS NOT NULL AND admitted_generation IS NOT NULL)),
 CHECK(state<>'scheduled' OR (remote_job_id IS NOT NULL AND length(btrim(remote_job_id))>0)),
 CHECK(state<>'indeterminate' OR (safe_reason IS NOT NULL AND length(btrim(safe_reason))>0)),
 CHECK(state<>'queued' OR (admitted_at IS NULL AND admitted_generation IS NULL AND remote_job_id IS NULL)),
 CHECK((payload IS NULL)=(payload_redacted_at IS NOT NULL))
);
ALTER TABLE pulse_dispatches ENABLE ROW LEVEL SECURITY;
ALTER TABLE pulse_dispatches FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pulse_dispatches_owner_org ON pulse_dispatches;
CREATE POLICY pulse_dispatches_owner_org ON pulse_dispatches TO app_ledger
 USING(org_id=current_setting('app.current_org_id',true) AND actor_profile_id=current_setting('app.current_profile_id',true))
 WITH CHECK(org_id=current_setting('app.current_org_id',true) AND actor_profile_id=current_setting('app.current_profile_id',true));
GRANT SELECT,INSERT,UPDATE ON pulse_dispatches TO app_ledger;
REVOKE DELETE ON pulse_dispatches FROM app_ledger;
CREATE OR REPLACE FUNCTION pulse_proposal_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF ROW(NEW.id,NEW.created_at) IS DISTINCT FROM ROW(OLD.id,OLD.created_at) THEN RAISE EXCEPTION 'Pulse proposal identity is immutable' USING ERRCODE='23514'; END IF;
 IF (OLD.status<>'pending' OR OLD.internal_run_id IS NOT NULL) AND
 ROW(NEW.source,NEW.kind,NEW.title,NEW.summary,NEW.payload,NEW.revision,NEW.owner_profile_id,NEW.dedup_key,NEW.org_id,NEW.internal_run_id,NEW.internal_policy_revision,NEW.internal_input_hash,NEW.internal_result_hash)
 IS DISTINCT FROM ROW(OLD.source,OLD.kind,OLD.title,OLD.summary,OLD.payload,OLD.revision,OLD.owner_profile_id,OLD.dedup_key,OLD.org_id,OLD.internal_run_id,OLD.internal_policy_revision,OLD.internal_input_hash,OLD.internal_result_hash) THEN
  RAISE EXCEPTION 'Pulse reviewed content is immutable' USING ERRCODE='23514';
 END IF;
 IF OLD.status<>'pending' AND ROW(NEW.status,NEW.decided_by,NEW.decided_at) IS DISTINCT FROM ROW(OLD.status,OLD.decided_by,OLD.decided_at) THEN
  RAISE EXCEPTION 'Pulse decision is immutable' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS pulse_proposal_immutable ON pulse_proposals;
CREATE TRIGGER pulse_proposal_immutable BEFORE UPDATE ON pulse_proposals FOR EACH ROW EXECUTE FUNCTION pulse_proposal_immutable();
CREATE OR REPLACE FUNCTION pulse_dispatch_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE job bg_jobs%ROWTYPE;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Pulse tombstones require namespace retirement'; END IF;
 IF TG_OP='INSERT' THEN
  SELECT * INTO job FROM bg_jobs WHERE id=NEW.bg_job_id;
  IF NOT FOUND OR job.tenant_id<>NEW.org_id OR job.user_id IS DISTINCT FROM NEW.actor_profile_id OR job.ref_id IS DISTINCT FROM NEW.id::text OR job.type<>'pulse_dispatch' THEN
   RAISE EXCEPTION 'Pulse job binding mismatch' USING ERRCODE='23514';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM pulse_proposals WHERE org_id=NEW.org_id AND id=NEW.proposal_id AND revision=NEW.proposal_revision AND owner_profile_id=NEW.actor_profile_id AND status='approved' AND kind=NEW.action_kind) THEN
   RAISE EXCEPTION 'Pulse proposal binding mismatch' USING ERRCODE='23514';
  END IF;
 ELSE
  IF ROW(NEW.id,NEW.created_at,NEW.org_id,NEW.proposal_id,NEW.proposal_revision,NEW.actor_profile_id,NEW.gateway_id,NEW.channel,NEW.agent_id,NEW.origin_session_key,NEW.action_kind,NEW.payload_hash,NEW.tool_schema_revision,NEW.authority_snapshot_hash,NEW.gateway_qualification_revision,NEW.bg_job_id)
    IS DISTINCT FROM ROW(OLD.id,OLD.created_at,OLD.org_id,OLD.proposal_id,OLD.proposal_revision,OLD.actor_profile_id,OLD.gateway_id,OLD.channel,OLD.agent_id,OLD.origin_session_key,OLD.action_kind,OLD.payload_hash,OLD.tool_schema_revision,OLD.authority_snapshot_hash,OLD.gateway_qualification_revision,OLD.bg_job_id) THEN
   RAISE EXCEPTION 'Pulse dispatch binding is immutable' USING ERRCODE='23514';
  END IF;
  IF NEW.payload IS DISTINCT FROM OLD.payload OR NEW.payload_redacted_at IS DISTINCT FROM OLD.payload_redacted_at THEN
   IF NOT (OLD.payload IS NOT NULL AND NEW.payload IS NULL AND OLD.created_at<now()-interval '30 days' AND NEW.payload_redacted_at IS NOT NULL AND NEW.state<>'queued' AND current_setting('role')<>'app_ledger') THEN RAISE EXCEPTION 'Invalid payload redaction' USING ERRCODE='23514'; END IF;
  END IF;
  IF NEW.attempt_count<OLD.attempt_count THEN RAISE EXCEPTION 'Pulse attempt count cannot decrease' USING ERRCODE='23514'; END IF;
  IF NOT (NEW.state=OLD.state OR (OLD.state='queued' AND NEW.state IN ('admitted','rejected','canceled')) OR (OLD.state='admitted' AND NEW.state IN ('scheduled','indeterminate'))) THEN RAISE EXCEPTION 'Invalid Pulse state transition' USING ERRCODE='23514'; END IF;
  IF OLD.admitted_at IS NOT NULL AND ROW(NEW.admitted_at,NEW.admitted_generation) IS DISTINCT FROM ROW(OLD.admitted_at,OLD.admitted_generation) THEN RAISE EXCEPTION 'Admission is immutable' USING ERRCODE='23514'; END IF;
  IF OLD.remote_job_id IS NOT NULL AND NEW.remote_job_id IS DISTINCT FROM OLD.remote_job_id THEN RAISE EXCEPTION 'Remote receipt is immutable' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
-- Pin the definer search path to this migration's owned schema, including isolated SQL fixtures.
DO $$ BEGIN EXECUTE format('ALTER FUNCTION pulse_dispatch_guard() SET search_path TO %I, pg_catalog', current_schema()); END $$;
REVOKE ALL ON FUNCTION pulse_dispatch_guard() FROM PUBLIC;
DROP TRIGGER IF EXISTS pulse_dispatch_guard ON pulse_dispatches;
CREATE TRIGGER pulse_dispatch_guard BEFORE INSERT OR UPDATE OR DELETE ON pulse_dispatches FOR EACH ROW EXECUTE FUNCTION pulse_dispatch_guard();
