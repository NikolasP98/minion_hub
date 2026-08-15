<script lang="ts">
  import type { PageData } from './$types';
  import { invalidate } from '$app/navigation';
  import { CreditCard, Plus, Trash2, Send } from 'lucide-svelte';
  import {
    Button,
    Input,
    Select,
    Toggle,
    PageHeader,
    SegmentedControl,
    iconSizes,
  } from '$lib/components/ui';
  import { PageBody, PageShell } from '$lib/components/ui/foundations';
  import * as m from '$lib/paraglide/messages';
  import { canAct } from '$lib/access/can.svelte';

  let { data }: { data: PageData } = $props();

  // Local editable draft — a working copy the user edits row-by-row before
  // hitting Save (same pattern as BrainAccessPanel's addRow/removeRow/save).
  interface MethodRowEdit {
    /** '' for a not-yet-saved row: id is auto-slugged from `label` on save. */
    id: string;
    label: string;
    enabled: boolean;
    takesTendered: boolean;
    surchargeType: 'percent' | 'fixed' | '';
    surchargeAmount: string;
    documentDefault: '' | '03' | '01';
  }

  function toRow(mth: PageData['settings']['methods'][number]): MethodRowEdit {
    return {
      id: mth.id,
      label: mth.label,
      enabled: mth.enabled,
      takesTendered: mth.takesTendered,
      surchargeType: mth.surcharge?.type ?? '',
      surchargeAmount: mth.surcharge ? String(mth.surcharge.amount) : '',
      documentDefault: mth.documentDefault ?? '',
    };
  }

  // svelte-ignore state_referenced_locally -- seeding the editable draft once
  // from the loaded `settings` prop; converting to $derived would wipe in-progress edits.
  let rows = $state<MethodRowEdit[]>(data.settings.methods.map(toRow));
  let saving = $state(false);
  let err = $state('');

  // svelte-ignore state_referenced_locally -- same seed-once pattern as `rows`.
  let emissionMode = $state<'off' | 'shadow'>(data.settings.emission.mode);
  // svelte-ignore state_referenced_locally
  let emissionDocTypeDefault = $state<'03' | '01'>(data.settings.emission.docTypeDefault);

  const canManage = $derived(canAct('pos', 'manage'));

  function slugId(label: string): string {
    return label
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  function addRow() {
    rows = [
      ...rows,
      {
        id: '',
        label: '',
        enabled: true,
        takesTendered: false,
        surchargeType: '',
        surchargeAmount: '',
        documentDefault: '',
      },
    ];
  }

  function removeRow(i: number) {
    rows = rows.filter((_, idx) => idx !== i);
  }

  async function save() {
    saving = true;
    err = '';
    try {
      const methods = rows.map((r) => ({
        id: r.id || slugId(r.label),
        label: r.label.trim(),
        enabled: r.enabled,
        takesTendered: r.takesTendered,
        ...(r.surchargeType
          ? { surcharge: { type: r.surchargeType, amount: Number(r.surchargeAmount) || 0 } }
          : {}),
        documentDefault: r.documentDefault || null,
      }));
      const res = await fetch('/api/pos/settings', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          methods,
          emission: { mode: emissionMode, docTypeDefault: emissionDocTypeDefault },
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        err = (body as { error?: string }).error ?? `Error ${res.status}`;
        return;
      }
      // 'pos:shift' is the (app)/pos/+layout.server.ts dependency key that
      // feeds posSettings to PosNav/ShiftBanner/sell — both need refreshing.
      await Promise.all([invalidate('pos:shift'), invalidate('pos:settings')]);
      const saved = (await res.json()).settings as PageData['settings'];
      rows = saved.methods.map(toRow);
      emissionMode = saved.emission.mode;
      emissionDocTypeDefault = saved.emission.docTypeDefault;
    } finally {
      saving = false;
    }
  }
</script>

<svelte:head><title>{m.pos_settings_title()}</title></svelte:head>

<PageShell archetype="form" scroll="region" labelledBy="pos-settings-title">
  <PageHeader
    titleId="pos-settings-title"
    title={m.pos_settings_title()}
    subtitle={m.pos_settings_subtitle()}
  >
    {#snippet leading()}
      <CreditCard size={iconSizes.md} class="text-accent shrink-0" />
    {/snippet}
  </PageHeader>

  <PageBody padding="compact" scroll="region">
    <section class="card max-w-4xl">
      <header class="card-h">
        <span>{m.pos_settings_methods_card()}</span>
        <Button variant="secondary" size="sm" disabled={!canManage} onclick={addRow}>
          {#snippet icon()}<Plus size={iconSizes.sm} />{/snippet}
          {m.pos_settings_add_method()}
        </Button>
      </header>

      <div class="rows">
        {#each rows as row, i (i)}
          <div class="row">
            <Input
              class="lbl-field"
              label={m.pos_settings_label()}
              placeholder={m.pos_settings_label_ph()}
              size="sm"
              disabled={!canManage}
              bind:value={row.label}
            />
            <Toggle size="sm" bind:checked={row.enabled} disabled={!canManage} label={m.pos_settings_enabled()} />
            <Toggle
              size="sm"
              bind:checked={row.takesTendered}
              disabled={!canManage}
              label={m.pos_settings_takes_tendered()}
            />
            <Select
              fieldClass="surcharge-type-field"
              label={m.pos_settings_surcharge_type()}
              size="sm"
              disabled={!canManage}
              bind:value={row.surchargeType}
              options={[
                { value: '', label: m.pos_settings_surcharge_none() },
                { value: 'percent', label: m.pos_settings_surcharge_percent() },
                { value: 'fixed', label: m.pos_settings_surcharge_fixed() },
              ]}
            />
            {#if row.surchargeType}
              <Input
                class="amount-field"
                label={m.pos_settings_surcharge_amount()}
                type="number"
                size="sm"
                disabled={!canManage}
                bind:value={row.surchargeAmount}
              />
            {/if}
            <Select
              fieldClass="document-field"
              label={m.pos_settings_document_default()}
              size="sm"
              disabled={!canManage}
              bind:value={row.documentDefault}
              options={[
                { value: '', label: m.pos_settings_document_none() },
                { value: '03', label: m.pos_settings_document_boleta() },
                { value: '01', label: m.pos_settings_document_factura() },
              ]}
            />
            <Button
              variant="ghost"
              size="sm"
              class="rm"
              disabled={!canManage}
              title={m.common_remove()}
              onclick={() => removeRow(i)}
            >
              <Trash2 size={iconSizes.sm} />
            </Button>
          </div>
        {/each}
      </div>

      {#if err}<p class="err-msg">{err}</p>{/if}

      <div class="actions">
        <Button
          variant="primary"
          size="sm"
          loading={saving}
          disabled={!canManage}
          title={canManage ? undefined : m.no_permission()}
          onclick={save}
        >
          {m.pos_settings_save()}
        </Button>
      </div>
    </section>

    <section class="card max-w-4xl emission-card">
      <header class="card-h">
        <span>{m.pos_settings_emission_card()}</span>
      </header>
      <p class="emission-subtitle">{m.pos_settings_emission_subtitle()}</p>

      <div class="emission-controls">
        <div class="emission-field">
          <span class="emission-field-label">{m.pos_settings_emission_mode()}</span>
          <SegmentedControl
            aria-label={m.pos_settings_emission_mode()}
            bind:value={emissionMode}
            items={[
              { value: 'off', label: m.pos_settings_emission_mode_off(), disabled: !canManage },
              {
                value: 'shadow',
                label: m.pos_settings_emission_mode_shadow(),
                disabled: !canManage,
              },
            ]}
          />
        </div>
        <Select
          fieldClass="doc-type-field"
          label={m.pos_settings_emission_doc_type_default()}
          size="sm"
          disabled={!canManage || emissionMode === 'off'}
          bind:value={emissionDocTypeDefault}
          options={[
            { value: '03', label: m.pos_settings_document_boleta() },
            { value: '01', label: m.pos_settings_document_factura() },
          ]}
        />
      </div>

      <h3 class="series-title">
        <Send size={iconSizes.sm} class="text-secondary shrink-0" />
        {m.pos_settings_emission_series_card()}
      </h3>
      {#if data.series.length === 0}
        <p class="series-empty">{m.pos_settings_emission_series_empty()}</p>
      {:else}
        <div class="series-table">
          <div class="series-row series-head">
            <span>{m.pos_settings_emission_series_doc_type()}</span>
            <span>{m.pos_settings_emission_series_serie()}</span>
            <span>{m.pos_settings_emission_series_next()}</span>
            <span>{m.pos_settings_emission_series_environment()}</span>
          </div>
          {#each data.series as s (s.id)}
            <div class="series-row">
              <span>{s.docType === '01' ? m.pos_settings_document_factura() : m.pos_settings_document_boleta()}</span>
              <span class="series-code">{s.serie}</span>
              <span>{s.nextNumber}</span>
              <span>{s.environment}</span>
            </div>
          {/each}
        </div>
      {/if}
    </section>
  </PageBody>
</PageShell>

<style>
  .card {
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    background: var(--color-surface-2);
    padding: var(--space-3) var(--space-4);
  }
  .card-h {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    margin-bottom: var(--space-3);
  }
  .card-h > span {
    font-size: var(--font-size-caption);
    font-weight: 600;
    color: var(--color-text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.03em;
  }
  .rows {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .row {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    gap: var(--space-3);
    padding: var(--space-2);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-surface-1);
  }
  .row :global(.lbl-field) {
    width: 12rem;
  }
  .row :global(.surcharge-type-field),
  .row :global(.document-field) {
    width: 10rem;
  }
  .row :global(.amount-field) {
    width: 7rem;
  }
  .row :global(.rm) {
    color: var(--color-text-secondary);
  }
  .row :global(.rm:hover) {
    color: var(--color-danger-fg);
  }
  .err-msg {
    font-size: var(--font-size-body);
    color: var(--color-danger-fg);
    margin-top: var(--space-2);
  }
  .actions {
    margin-top: var(--space-3);
  }
  .emission-card {
    margin-top: var(--space-4);
  }
  .emission-subtitle {
    font-size: var(--font-size-body);
    color: var(--color-text-secondary);
    margin-bottom: var(--space-3);
  }
  .emission-controls {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    gap: var(--space-4);
    margin-bottom: var(--space-4);
  }
  .emission-field {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }
  .emission-field-label {
    font-size: var(--font-size-caption);
    color: var(--color-text-secondary);
  }
  .emission-controls :global(.doc-type-field) {
    width: 12rem;
  }
  .series-title {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--font-size-caption);
    font-weight: 600;
    color: var(--color-text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.03em;
    margin-bottom: var(--space-2);
  }
  .series-empty {
    font-size: var(--font-size-body);
    color: var(--color-text-secondary);
  }
  .series-table {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }
  .series-row {
    display: grid;
    grid-template-columns: 6rem 6rem 8rem 1fr;
    gap: var(--space-3);
    padding: var(--space-2);
    border-radius: var(--radius-sm);
    font-size: var(--font-size-body);
  }
  .series-head {
    color: var(--color-text-secondary);
    font-size: var(--font-size-caption);
    text-transform: uppercase;
    letter-spacing: 0.03em;
  }
  .series-row:not(.series-head) {
    background: var(--color-surface-1);
    border: 1px solid var(--color-border);
  }
  .series-code {
    font-family: var(--font-mono);
  }
</style>
