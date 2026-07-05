-- Ad↔post linkage: label organic posts that also ran as ads. Applied to prod
-- manually ahead of this migration file (record-only — safe to re-run).
-- See specs/2026-07-04-meta-business-integration.md + meta-sync.service.ts
-- collectPromotedStoryIds / markPromotedPosts.

alter table public.meta_post_insights
  add column if not exists is_promoted boolean not null default false;
