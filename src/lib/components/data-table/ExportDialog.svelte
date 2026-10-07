<script lang="ts">
  import { FileText, Sheet, Check } from 'lucide-svelte';
  import * as m from '$lib/paraglide/messages';
  import { Button, iconSizes } from '$lib/components/ui';
  import { Dialog } from '$lib/components/ui/foundations';

  type Col = { key: string; label: string; default: boolean };
  let {
    open = $bindable(),
    columns,
    count,
    formats = ['csv', 'xlsx'],
    onexport,
  }: {
    open: boolean;
    columns: Col[];
    count: number;
    formats?: ('csv' | 'xlsx')[];
    onexport: (format: 'csv' | 'xlsx', keys: string[]) => void;
  } = $props();

  let format = $state<'csv' | 'xlsx'>('csv');
  let selected = $state<Set<string>>(new Set());

  // Reset the column selection to the current defaults each time the dialog opens.
  $effect(() => {
    if (open) {
      selected = new Set(columns.filter((c) => c.default).map((c) => c.key));
      if (!formats.includes(format)) format = formats[0] ?? 'csv';
    }
  });

  function toggle(key: string) {
    const next = new Set(selected);
    next.has(key) ? next.delete(key) : next.add(key);
    selected = next;
  }
  function run() {
    // Preserve registry order; never export an empty column set.
    const keys = columns.filter((c) => selected.has(c.key)).map((c) => c.key);
    if (keys.length === 0) return;
    onexport(format, keys);
    open = false;
  }
</script>

<!-- HC-028: the shared native <dialog> contract owns modality, Escape,
     backdrop dismissal, scroll lock and focus return. -->
<Dialog bind:open title={m.crm_export_title()} size="md">
  <div class="dlg-body">
    {#if formats.length > 1}<div class="seg-label">{m.crm_export_format()}</div>{/if}
    {#if formats.length > 1}<div class="fmt">
        {#if formats.includes('csv')}
          <Button class="fmt-btn {format === 'csv' ? 'on' : ''}" onclick={() => (format = 'csv')}>
            <FileText size={iconSizes.sm} /> CSV
          </Button>
        {/if}
        {#if formats.includes('xlsx')}
          <Button class="fmt-btn {format === 'xlsx' ? 'on' : ''}" onclick={() => (format = 'xlsx')}>
            <Sheet size={iconSizes.sm} /> XLSX
          </Button>
        {/if}
      </div>{/if}

    <div class="seg-label flex items-center justify-between">
      <span>{m.crm_export_columns()}</span>
      <span class="t-caption"
        >{m.crm_export_selected({ n: selected.size, total: columns.length })}</span
      >
    </div>
    <div class="cols">
      {#each columns as c (c.key)}
        <Button class="col" onclick={() => toggle(c.key)}>
          <span class="cbx" class:on={selected.has(c.key)}
            >{#if selected.has(c.key)}<Check size={iconSizes.xs} />{/if}</span
          >
          <span class="col-label">{c.label}</span>
        </Button>
      {/each}
    </div>
  </div>

  {#snippet footer()}
    <Button variant="outline" size="sm" onclick={() => (open = false)}
      >{m.crm_export_cancel()}</Button
    >
    <Button variant="primary" size="sm" onclick={run} disabled={selected.size === 0}>
      {m.crm_export_download({ count })}
    </Button>
  {/snippet}
</Dialog>

<style>
  .seg-label {
    font-size: var(--font-size-caption);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    color: var(--color-muted-foreground);
    margin: var(--space-2) 0 var(--space-2);
  }
  .fmt {
    display: flex;
    gap: var(--space-2);
    margin-bottom: var(--space-2);
  }
  .dlg-body :global(.fmt-btn) {
    flex: 1;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    height: 2.2rem;
    border-radius: var(--radius-md);
    border: 1px solid var(--hairline);
    font-size: var(--font-size-body);
    font-weight: 600;
    color: var(--color-muted-foreground);
    background: var(--color-bg3);
    transition: color var(--duration-fast) var(--ease-standard);
  }
  .dlg-body :global(.fmt-btn):hover {
    color: var(--color-foreground);
  }
  .dlg-body :global(.fmt-btn.on) {
    color: var(--color-accent);
    border-color: var(--color-accent);
    background: color-mix(in srgb, var(--color-accent) 12%, transparent);
  }
  .cols {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-0-5);
  }
  .dlg-body :global(.col) {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-1) var(--space-2);
    border-radius: var(--radius-sm, 6px);
    text-align: left;
  }
  .dlg-body :global(.col):hover {
    background: color-mix(in srgb, var(--color-accent) 10%, transparent);
  }
  .cbx {
    display: grid;
    place-items: center;
    width: 1rem;
    height: 1rem;
    border-radius: var(--radius-sm);
    border: 1px solid var(--hairline);
    flex-shrink: 0;
  }
  .cbx.on {
    background: var(--color-accent);
    border-color: var(--color-accent);
    color: var(--color-bg);
  }
  .col-label {
    font-size: var(--font-size-body);
  }
</style>
