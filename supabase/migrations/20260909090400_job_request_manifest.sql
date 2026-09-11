-- Unreleased additive amendment after20260909090300. Install before manifest-aware
-- handlers and drain older workers before activation; no production execution here.
-- One ALTER is atomic and intentionally rejects a preexisting partial column or
-- constraint instead of accepting IF NOT EXISTS as a compatibility certificate.
ALTER TABLE public.job_effects
  ADD COLUMN manifest_hash text,
  ADD CONSTRAINT job_effects_manifest_shape CHECK (
    manifest_hash IS NULL OR (kind = 'head' AND manifest_hash ~ '^[a-f0-9]{64}$')
  );
-- Existing rows start unbound. Do not infer manifests from partial receipts.
-- TODO(handoff): Current-head reset does not archive whole-manifest history.
-- Preserve historical receipts; choose explicit manifest retention/backfill policy
-- separately. See meta proposals/2026-09-08-platform-qc-remediation.md (JOB-02).
