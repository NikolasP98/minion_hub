-- Additive: existing rows begin at generation zero; the next claim increments it.
-- Deploy this before generation-aware runners. Drain old runners before rollout:
-- an old binary does not enforce the new ownership predicate.
ALTER TABLE public.bg_jobs
  ADD COLUMN lease_generation integer NOT NULL DEFAULT 0
  CONSTRAINT bg_jobs_lease_generation_nonnegative CHECK (lease_generation >= 0);
