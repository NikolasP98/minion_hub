-- Per-user POS shifts: the org-wide "one open shift" invariant becomes
-- one open shift per USER (owner ask 2026-10-10: "each user should have
-- their own SHIFT"). Legacy rows keep `opened_by` nullable; NULLs are
-- distinct in a unique index, so pre-existing openerless rows survive.
drop index if exists public.pos_shifts_one_open_per_org;
--> statement-breakpoint
create unique index if not exists pos_shifts_one_open_per_user
  on public.pos_shifts (org_id, opened_by)
  where status = 'open';
