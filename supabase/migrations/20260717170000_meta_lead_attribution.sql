-- Lead attribution: which ad/campaign (or organic origin) drove each inbound
-- DM lead. ONE canonical shape across two collection surfaces —
--   * webhook  (provenance='webhook',            confidence='exact')  — Meta IG
--     Click-to-Direct `message.referral` {ref, ad_id, source, type, ads_context_data}
--   * backfill (provenance='heuristic-icebreaker', confidence high|medium|low) — the
--     auto-injected icebreaker text names the product → matched to a campaign.
-- Webhook rows are authoritative; a heuristic upsert must never overwrite one.
-- Spec: specs/2026-07-17-ig-ad-attribution-spec.md
-- Drizzle schema: src/server/db/pg-meta-schema.ts (metaLeadAttribution)

create table if not exists public.meta_lead_attribution (
  id                uuid primary key default gen_random_uuid(),
  org_id            text not null,
  channel           text not null,                 -- 'instagram' (future: 'messenger')
  sender_id         text not null,                 -- lead's IGSID / PSID
  chat_id           text,
  first_message_id  text,
  first_contact_at  timestamptz,
  origin            text not null default 'unknown', -- 'ad' | 'organic' | 'unknown'
  source            text,                           -- referral.source, e.g. 'ADS'
  ref               text,                           -- referral.ref (advertiser custom data)
  ad_id             text,                           -- exact ad (webhook only)
  adset_id          text,
  campaign_id       text,
  campaign_name     text,
  ad_title          text,                           -- ads_context_data.ad_title
  photo_url         text,                           -- ads_context_data.photo_url
  video_url         text,                           -- ads_context_data.video_url
  provenance        text not null,                  -- 'webhook' | 'heuristic-icebreaker'
  confidence        text not null,                  -- 'exact' | 'high' | 'medium' | 'low'
  match_meta        jsonb not null default '{}',    -- heuristic evidence (opener/product/window)
  captured_at       timestamptz not null default now(),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (org_id, channel, sender_id)
);

create index if not exists meta_lead_attribution_org_campaign_idx
  on public.meta_lead_attribution (org_id, campaign_id);
create index if not exists meta_lead_attribution_org_origin_idx
  on public.meta_lead_attribution (org_id, origin);

alter table public.meta_lead_attribution enable row level security;
alter table public.meta_lead_attribution force  row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='meta_lead_attribution' and policyname='meta_lead_attribution_org_guc') then
    create policy meta_lead_attribution_org_guc on public.meta_lead_attribution
      using (org_id = current_setting('app.current_org_id', true))
      with check (org_id = current_setting('app.current_org_id', true));
  end if;
end $$;
grant select, insert, update, delete on public.meta_lead_attribution to app_ledger;
