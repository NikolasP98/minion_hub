-- Additive only. Run stock-invoice-dedupe-preflight.ts first for collision IDs.
-- Hold writers while checking and installing the invariant. No history is fixed,
-- deleted or reposted here; any collision/invalid identity aborts the transaction.
BEGIN;
LOCK TABLE public.stk_entries IN SHARE ROW EXCLUSIVE MODE;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.stk_entries
    WHERE type='issue' AND status IN ('draft', 'submitted') AND metadata ? 'invoiceId'
      AND (jsonb_typeof(metadata->'invoiceId') IS DISTINCT FROM 'string'
        OR btrim(metadata->>'invoiceId') = '')
  ) THEN
    RAISE EXCEPTION 'Invalid active invoice issue identity; run stock-invoice-dedupe-preflight.ts; history unchanged';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.stk_entries
    WHERE type='issue' AND status IN ('draft', 'submitted')
      AND jsonb_typeof(metadata->'invoiceId') = 'string'
      AND btrim(metadata->>'invoiceId') <> ''
    GROUP BY org_id, lower(btrim(metadata->>'invoiceId')) HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate active invoice issues; run stock-invoice-dedupe-preflight.ts; history unchanged';
  END IF;
END $$;
CREATE UNIQUE INDEX stk_entries_org_active_invoice_issue_uniq
  ON public.stk_entries (org_id, (lower(btrim(metadata->>'invoiceId'))))
  WHERE type='issue' AND status IN ('draft', 'submitted')
    AND jsonb_typeof(metadata->'invoiceId') = 'string'
    AND btrim(metadata->>'invoiceId') <> '';
COMMIT;
