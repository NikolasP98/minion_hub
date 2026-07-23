<script lang="ts">
  import type { PageData } from './$types';
  import { invalidate } from '$app/navigation';
  import { Settings } from 'lucide-svelte';
  import {
    Button,
    Card,
    Input,
    PageHeader,
    Select,
    Toggle,
    iconSizes,
    type SelectOption,
    type SelectValue,
  } from '$lib/components/ui';
  import PageBody from '$lib/components/ui/foundations/PageBody.svelte';
  import PageShell from '$lib/components/ui/foundations/PageShell.svelte';
  import {
    BRAIN_ENRICHMENT_DAILY_TOKEN_BUDGET,
    enrichmentModelKey,
    providersForHarness,
    type BrainEnrichmentHarness,
    type BrainEnrichmentModelProvider,
  } from '$lib/brains/enrichment-config';
  import * as m from '$lib/paraglide/messages';

  let { data }: { data: PageData } = $props();
  // svelte-ignore state_referenced_locally -- form drafts intentionally seed from the loaded config
  const configured = data.enrichment.configured;

  // svelte-ignore state_referenced_locally -- editable drafts are seeded once
  let harness = $state<BrainEnrichmentHarness>(configured.harness);
  // svelte-ignore state_referenced_locally
  let adapterId = $state(configured.adapterId ?? '');
  // svelte-ignore state_referenced_locally
  let profile = $state(configured.profile ?? '');
  // svelte-ignore state_referenced_locally
  let distillationProvider = $state<BrainEnrichmentModelProvider>(configured.distillation.provider);
  // svelte-ignore state_referenced_locally
  let distillationModelId = $state(configured.distillation.modelId);
  // svelte-ignore state_referenced_locally
  let rerankingEnabled = $state(Boolean(configured.reranking));
  // svelte-ignore state_referenced_locally
  let rerankingProvider = $state<BrainEnrichmentModelProvider>(
    configured.reranking?.provider ?? configured.distillation.provider,
  );
  // svelte-ignore state_referenced_locally
  let rerankingModelId = $state(configured.reranking?.modelId ?? configured.distillation.modelId);
  // svelte-ignore state_referenced_locally
  let dailyTokenBudget = $state(String(configured.dailyTokenBudget));
  let saving = $state(false);
  let error = $state('');
  let saved = $state(false);

  const customAvailable = $derived(
    data.adapterIds.length > 0 &&
      data.modelCatalog.some((model) => model.provider === 'openrouter'),
  );
  const harnessOptions = $derived<SelectOption[]>([
    { value: 'drone', label: m.brains_settings_harness_drone() },
    { value: 'claude-code', label: m.brains_settings_harness_claude() },
    { value: 'codex', label: m.brains_settings_harness_codex() },
    { value: 'pi', label: m.brains_settings_harness_pi() },
    { value: 'custom', label: m.brains_settings_harness_other(), disabled: !customAvailable },
  ]);

  function providerLabel(provider: BrainEnrichmentModelProvider): string {
    if (provider === 'harness') return m.brains_settings_provider_harness();
    if (provider === 'openrouter') return m.brains_settings_provider_openrouter();
    if (provider === 'anthropic') return m.brains_settings_provider_anthropic();
    return m.brains_settings_provider_openai();
  }

  function availableProviders(
    selectedHarness: BrainEnrichmentHarness,
  ): BrainEnrichmentModelProvider[] {
    const compatible = providersForHarness(selectedHarness);
    return compatible.filter((provider) =>
      data.modelCatalog.some((model) => model.provider === provider),
    );
  }

  function modelOptions(provider: BrainEnrichmentModelProvider): SelectOption[] {
    return data.modelCatalog
      .filter((model) => model.provider === provider)
      .map((model) => ({
        value: model.modelId,
        label:
          model.inputUsdPerMillion === null || model.outputUsdPerMillion === null
            ? model.label
            : m.brains_settings_model_price({
                label: model.label,
                input: model.inputUsdPerMillion,
                output: model.outputUsdPerMillion,
              }),
      }));
  }

  const providerOptions = $derived<SelectOption[]>(
    availableProviders(harness).map((value) => ({ value, label: providerLabel(value) })),
  );
  const distillationModelOptions = $derived(modelOptions(distillationProvider));
  const rerankingModelOptions = $derived(modelOptions(rerankingProvider));
  const adapterOptions = $derived<SelectOption[]>(
    data.adapterIds.map((value) => ({ value, label: value })),
  );
  const parsedBudget = $derived(Number(dailyTokenBudget));
  const budgetValid = $derived(
    Number.isInteger(parsedBudget) &&
      parsedBudget >= BRAIN_ENRICHMENT_DAILY_TOKEN_BUDGET.min &&
      parsedBudget <= BRAIN_ENRICHMENT_DAILY_TOKEN_BUDGET.max,
  );
  const canSubmit = $derived(
    Boolean(distillationModelId) &&
      (!rerankingEnabled || Boolean(rerankingModelId)) &&
      (harness !== 'custom' || Boolean(adapterId)) &&
      budgetValid,
  );

  function firstProvider(nextHarness: BrainEnrichmentHarness): BrainEnrichmentModelProvider {
    return availableProviders(nextHarness)[0] ?? 'harness';
  }

  function firstModel(provider: BrainEnrichmentModelProvider): string {
    return String(modelOptions(provider)[0]?.value ?? '');
  }

  function changeHarness(value: SelectValue) {
    harness = value as BrainEnrichmentHarness;
    const available = availableProviders(harness);
    if (!available.includes(distillationProvider)) {
      distillationProvider = firstProvider(harness);
      distillationModelId = firstModel(distillationProvider);
    }
    if (!available.includes(rerankingProvider)) {
      rerankingProvider = firstProvider(harness);
      rerankingModelId = firstModel(rerankingProvider);
    }
    if (harness !== 'custom') adapterId = '';
  }

  function changeDistillationProvider(value: SelectValue) {
    distillationProvider = value as BrainEnrichmentModelProvider;
    distillationModelId = firstModel(distillationProvider);
  }

  function changeRerankingProvider(value: SelectValue) {
    rerankingProvider = value as BrainEnrichmentModelProvider;
    rerankingModelId = firstModel(rerankingProvider);
  }

  async function save() {
    if (!canSubmit || saving) return;
    saving = true;
    error = '';
    saved = false;
    try {
      const response = await fetch('/api/brains/settings', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          harness,
          adapterId: harness === 'custom' ? adapterId : null,
          profile: profile.trim() || null,
          distillation: { provider: distillationProvider, modelId: distillationModelId },
          reranking: rerankingEnabled
            ? { provider: rerankingProvider, modelId: rerankingModelId }
            : null,
          dailyTokenBudget: parsedBudget,
        }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        error = (body as { message?: string }).message ?? m.brains_settings_save_error();
        return;
      }
      saved = true;
      await invalidate('brains:settings');
    } catch (cause) {
      error = cause instanceof Error ? cause.message : m.brains_settings_save_error();
    } finally {
      saving = false;
    }
  }
</script>

<svelte:head><title>{m.brains_nav_settings()} · {m.nav_brains()}</title></svelte:head>

<PageShell archetype="form" scroll="none">
  <PageHeader title={m.brains_settings_page_title()} subtitle={m.brains_settings_page_subtitle()}>
    {#snippet leading()}
      <Settings size={iconSizes.md} class="text-accent shrink-0" />
    {/snippet}
  </PageHeader>

  <PageBody width="reading" scroll="region">
    <Card padding="lg">
      <div class="settings-form">
        <div class="settings-intro">
          <p>{m.brains_settings_intro()}</p>
          <p>{m.brains_settings_small_guidance()}</p>
        </div>

        <div class:platform-disabled={!data.platform.enabled} class="platform-status" role="status">
          <p class="t-label">
            {data.platform.enabled
              ? m.brains_settings_platform_enabled()
              : m.brains_settings_platform_disabled()}
          </p>
          <p>{m.brains_settings_capability_unverified()}</p>
        </div>

        {#if data.enrichment.status === 'degraded'}
          <div class="degraded-status" role="alert">
            <p class="t-label">{m.brains_settings_degraded()}</p>
            <ul>
              {#each data.enrichment.reasons as reason}
                <li>{reason}</li>
              {/each}
            </ul>
            <p>{m.brains_settings_degraded_fallback()}</p>
          </div>
        {/if}

        <div class="settings-grid">
          <Select
            label={m.brains_settings_harness()}
            value={harness}
            options={harnessOptions}
            onchange={changeHarness}
          />
          {#if harness === 'custom'}
            <Select
              label={m.brains_settings_adapter()}
              bind:value={adapterId}
              options={adapterOptions}
              helper={m.brains_settings_adapter_help()}
            />
          {:else}
            <Input
              label={m.brains_settings_profile()}
              bind:value={profile}
              placeholder="default"
              helper={m.brains_settings_profile_help()}
            />
          {/if}
        </div>

        <div class="model-role">
          <div>
            <h2 class="t-title">{m.brains_settings_distillation()}</h2>
            <p>{m.brains_settings_distillation_help()}</p>
          </div>
          <div class="settings-grid">
            <Select
              label={m.brains_settings_model_provider()}
              value={distillationProvider}
              options={providerOptions}
              onchange={changeDistillationProvider}
            />
            <Select
              label={m.brains_settings_model_id()}
              bind:value={distillationModelId}
              options={distillationModelOptions}
              helper={m.brains_settings_model_help()}
            />
          </div>
        </div>

        <div class="model-role">
          <Toggle
            bind:checked={rerankingEnabled}
            label={m.brains_settings_reranking()}
            description={m.brains_settings_reranking_help()}
          />
          {#if rerankingEnabled}
            <div class="settings-grid">
              <Select
                label={m.brains_settings_model_provider()}
                value={rerankingProvider}
                options={providerOptions}
                onchange={changeRerankingProvider}
              />
              <Select
                label={m.brains_settings_model_id()}
                bind:value={rerankingModelId}
                options={rerankingModelOptions}
              />
            </div>
          {/if}
        </div>

        <Input
          label={m.brains_settings_daily_budget()}
          bind:value={dailyTokenBudget}
          type="number"
          min={BRAIN_ENRICHMENT_DAILY_TOKEN_BUDGET.min}
          max={BRAIN_ENRICHMENT_DAILY_TOKEN_BUDGET.max}
          step="10000"
          helper={m.brains_settings_daily_budget_help()}
          error={!budgetValid ? m.brains_settings_daily_budget_error() : undefined}
        />

        {#if harness === 'custom'}
          <Input
            label={m.brains_settings_profile()}
            bind:value={profile}
            placeholder="default"
            helper={m.brains_settings_profile_help()}
          />
        {/if}

        <p class="credentials-note">{m.brains_settings_credentials_note()}</p>

        {#if error}
          <p class="form-error" role="alert">{error}</p>
        {:else if saved}
          <p class="form-success" role="status">{m.brains_settings_saved()}</p>
        {/if}

        <div class="form-actions">
          <Button variant="primary" disabled={!canSubmit} loading={saving} onclick={save}>
            {m.brains_settings_save()}
          </Button>
        </div>
      </div>
    </Card>
  </PageBody>
</PageShell>

<style>
  .settings-form,
  .model-role {
    display: flex;
    flex-direction: column;
    gap: var(--space-section);
  }

  .settings-intro {
    display: grid;
    gap: var(--space-2);
    padding: var(--space-3);
    border: 1px solid var(--color-info-border);
    border-radius: var(--radius-lg);
    color: var(--color-text-primary);
    background: var(--color-info-surface);
    font-size: var(--font-size-body);
    line-height: var(--line-height-body);
  }

  .platform-status,
  .degraded-status {
    display: grid;
    gap: var(--space-1);
    padding: var(--space-3);
    border: 1px solid var(--color-info-border);
    border-radius: var(--radius-lg);
    color: var(--color-info-fg);
    background: var(--color-info-surface);
    font-size: var(--font-size-caption);
    line-height: var(--line-height-compact);
  }

  .platform-status.platform-disabled {
    border-color: var(--color-warning-border);
    color: var(--color-warning-fg);
    background: var(--color-warning-surface);
  }

  .degraded-status {
    border-color: var(--color-danger-border);
    color: var(--color-danger-fg);
    background: var(--color-danger-surface);
  }

  .degraded-status ul {
    padding-left: var(--space-6);
    list-style: disc;
  }

  .settings-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--space-field-gap);
  }

  .model-role {
    padding-top: var(--space-3);
    border-top: 1px solid var(--color-border-subtle);
  }

  .model-role h2 {
    color: var(--color-text-primary);
  }

  .model-role p,
  .credentials-note,
  .form-error,
  .form-success {
    font-size: var(--font-size-caption);
    line-height: var(--line-height-compact);
  }

  .model-role p,
  .credentials-note {
    color: var(--color-text-tertiary);
  }

  .form-error {
    color: var(--color-danger-fg);
  }

  .form-success {
    color: var(--color-success-fg);
  }

  .form-actions {
    display: flex;
    justify-content: flex-end;
  }

  @media (max-width: 767.98px) {
    .settings-grid {
      grid-template-columns: minmax(0, 1fr);
    }
  }
</style>
