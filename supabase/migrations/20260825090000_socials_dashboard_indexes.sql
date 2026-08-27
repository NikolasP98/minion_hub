-- Direct dashboard predicates. Existing Meta indexes lead with ad_account_id
-- or post uniqueness columns, so org-wide dashboard reads cannot use them
-- efficiently at larger tenant sizes.
create index if not exists meta_ad_insights_org_date_idx
  on public.meta_ad_insights (org_id, date);
--> statement-breakpoint
create index if not exists meta_post_insights_org_period_post_idx
  on public.meta_post_insights (org_id, period, post_id);
