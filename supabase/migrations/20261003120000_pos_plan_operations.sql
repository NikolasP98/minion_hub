-- HC-035: migrate before serving operation-aware plan creation.
-- Existing agreements retain null operation identity; never backfill guessed identity.
ALTER TABLE public.pos_payment_plans
  ADD COLUMN operation_id uuid,
  ADD COLUMN operation_hash text,
  ADD CONSTRAINT pos_payment_plans_operation_check CHECK (
    (operation_id IS NULL AND operation_hash IS NULL) OR
    (operation_id IS NOT NULL AND operation_hash IS NOT NULL
      AND operation_hash ~ '^[0-9a-f]{64}$' AND created_by IS NOT NULL)
  );
CREATE UNIQUE INDEX pos_payment_plans_operation_uniq
  ON public.pos_payment_plans (org_id, operation_id) WHERE operation_id IS NOT NULL;

-- No expiry: a delayed original request must remain fenced after cancellation.
CREATE TABLE public.pos_plan_operation_cancellations (
  org_id text NOT NULL,
  operation_id uuid NOT NULL,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, operation_id)
);
ALTER TABLE public.pos_plan_operation_cancellations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pos_plan_operation_cancellations FORCE ROW LEVEL SECURITY;
CREATE POLICY org_fence ON public.pos_plan_operation_cancellations TO app_ledger
  USING (org_id = current_setting('app.current_org_id', true))
  WITH CHECK (org_id = current_setting('app.current_org_id', true));
REVOKE ALL ON public.pos_plan_operation_cancellations FROM PUBLIC, anon, authenticated, app_ledger;
GRANT SELECT, INSERT ON public.pos_plan_operation_cancellations TO app_ledger;
