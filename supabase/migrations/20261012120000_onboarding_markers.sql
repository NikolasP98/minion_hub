-- First-run onboarding markers (proposal 2026-10-12-hub-onboarding-org-user).
-- The multi-step agent-onboarding wizard is gone; `/onboarding` now hosts two
-- short, non-exclusive setup flows gated on these nullable timestamps:
--   organizations.onboarded_at — org kind + business timezone/currency
--   profiles.onboarded_at      — display name + UI language
-- NULL means "the flow has not run for this row yet". Skipping a flow still
-- stamps the marker, so a user is never asked twice.
--
-- Backfill: every row that exists when this migration runs is stamped, so no
-- existing organization or user is pushed through a first-run screen.
alter table public.organizations add column if not exists onboarded_at timestamptz;
--> statement-breakpoint
alter table public.profiles add column if not exists onboarded_at timestamptz;
--> statement-breakpoint
update public.organizations set onboarded_at = now() where onboarded_at is null;
--> statement-breakpoint
update public.profiles set onboarded_at = now() where onboarded_at is null;
