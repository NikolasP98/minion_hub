-- Org-scoped, non-secret execution target for the small model used by Brain
-- corpus enrichment. API keys remain in server-side credential stores.

create table if not exists public.brain_enrichment_settings (
  id uuid primary key default gen_random_uuid(),
  org_id text not null unique,
  harness text not null,
  adapter_id text,
  profile text,
  distillation_model_provider text not null,
  distillation_model_id text not null,
  distillation_input_usd_per_million numeric(12,6),
  distillation_output_usd_per_million numeric(12,6),
  reranking_model_provider text,
  reranking_model_id text,
  reranking_input_usd_per_million numeric(12,6),
  reranking_output_usd_per_million numeric(12,6),
  daily_token_budget integer not null default 250000,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint brain_enrichment_harness_check
    check (harness in ('drone', 'claude-code', 'codex', 'pi', 'custom')),
  constraint brain_enrichment_model_provider_check
    check (distillation_model_provider in ('harness', 'openrouter', 'anthropic', 'openai')),
  constraint brain_enrichment_reranking_provider_check
    check (reranking_model_provider is null or reranking_model_provider in ('harness', 'openrouter', 'anthropic', 'openai')),
  constraint brain_enrichment_model_id_nonempty_check
    check (length(btrim(distillation_model_id)) > 0),
  constraint brain_enrichment_reranking_pair_check
    check ((reranking_model_provider is null) = (reranking_model_id is null)),
  constraint brain_enrichment_distillation_price_pair_check
    check ((distillation_input_usd_per_million is null) = (distillation_output_usd_per_million is null)),
  constraint brain_enrichment_distillation_price_source_check
    check ((distillation_model_provider = 'harness') = (distillation_input_usd_per_million is null)),
  constraint brain_enrichment_reranking_price_pair_check
    check (
      (reranking_model_provider is null and reranking_input_usd_per_million is null and reranking_output_usd_per_million is null) or
      (reranking_model_provider is not null and
        ((reranking_input_usd_per_million is null) = (reranking_output_usd_per_million is null)))
    ),
  constraint brain_enrichment_reranking_price_source_check
    check (
      reranking_model_provider is null or
      ((reranking_model_provider = 'harness') = (reranking_input_usd_per_million is null))
    ),
  constraint brain_enrichment_distillation_price_ceiling_check
    check (
      (distillation_input_usd_per_million is null and distillation_output_usd_per_million is null) or
      (distillation_input_usd_per_million between 0 and 5 and distillation_output_usd_per_million between 0 and 20)
    ),
  constraint brain_enrichment_reranking_price_ceiling_check
    check (
      (reranking_input_usd_per_million is null and reranking_output_usd_per_million is null) or
      (reranking_input_usd_per_million between 0 and 5 and reranking_output_usd_per_million between 0 and 20)
    ),
  constraint brain_enrichment_custom_adapter_check
    check ((harness = 'custom') = (adapter_id is not null)),
  constraint brain_enrichment_distillation_compatibility_check
    check (
      (harness in ('drone', 'pi') and distillation_model_provider in ('harness', 'openrouter')) or
      (harness = 'claude-code' and distillation_model_provider in ('harness', 'anthropic')) or
      (harness = 'codex' and distillation_model_provider in ('harness', 'openai', 'openrouter')) or
      (harness = 'custom' and distillation_model_provider = 'openrouter')
    ),
  constraint brain_enrichment_reranking_compatibility_check
    check (
      reranking_model_provider is null or
      (harness in ('drone', 'pi') and reranking_model_provider in ('harness', 'openrouter')) or
      (harness = 'claude-code' and reranking_model_provider in ('harness', 'anthropic')) or
      (harness = 'codex' and reranking_model_provider in ('harness', 'openai', 'openrouter')) or
      (harness = 'custom' and reranking_model_provider = 'openrouter')
    ),
  constraint brain_enrichment_daily_token_budget_check
    check (daily_token_budget between 10000 and 5000000)
);

alter table public.brain_enrichment_settings enable row level security;
alter table public.brain_enrichment_settings force row level security;
drop policy if exists brain_enrichment_settings_org_guc on public.brain_enrichment_settings;
create policy brain_enrichment_settings_org_guc on public.brain_enrichment_settings
  for all
  using (org_id = current_setting('app.current_org_id', true))
  with check (org_id = current_setting('app.current_org_id', true));

grant select, insert, update, delete on public.brain_enrichment_settings to app_ledger;

comment on table public.brain_enrichment_settings is
  'Org-scoped, non-secret small-model and harness configuration consumed by Brain enrichment jobs.';
