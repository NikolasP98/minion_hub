<script lang="ts">
  import { X, FileText, Sheet, Check } from 'lucide-svelte';
  import * as m from '$lib/paraglide/messages';
  import { Button } from '$lib/components/ui';

  type Col = { key: string; label: string; default: boolean };
  let {
    open = $bindable(),
    columns,
    count,
    onexport,
  }: {
    open: boolean;
    columns: Col[];
    count: number;
    onexport: (format: 'csv' | 'xlsx', keys: string[]) => void;
  } = $props();

  let format = $state<'csv' | 'xlsx'>('csv');
  let selected = $state<Set<string>>(new Set());

  // Reset the column selection to the current defaults each time the dialog opens.
  $effect(() => {
    if (open) selected = new Set(columns.filter((c) => c.default).map((c) => c.key));
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

{#if open}
  <Button class="ovl" aria-label="close" onclick={() => (open = false)}></Button>
  <div class="dlg" role="dialog" aria-modal="true" aria-label={m.crm_export_title()}>
    <header class="dlg-h">
      <span>{m.crm_export_title()}</span>
      <Button class="x" aria-label={m.crm_export_cancel()} onclick={() => (open = false)}
        ><X size={16} /></Button
      >
    </header>

    <div class="dlg-body">
      <div class="seg-label">{m.crm_export_format()}</div>
      <div class="fmt">
        <Button class="fmt-btn {format === 'csv' ? 'on' : ''}" onclick={() => (format = 'csv')}>
          <FileText size={15} /> CSV
        </Button>
        <Button class="fmt-btn {format === 'xlsx' ? 'on' : ''}" onclick={() => (format = 'xlsx')}>
          <Sheet size={15} /> XLSX
        </Button>
      </div>

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
              >{#if selected.has(c.key)}<Check size={12} />{/if}</span
            >
            <span class="col-label">{c.label}</span>
          </Button>
        {/each}
      </div>
    </div>

    <footer class="dlg-f">
      <Button variant="outline" size="sm" onclick={() => (open = false)}
        >{m.crm_export_cancel()}</Button
      >
      <Button variant="primary" size="sm" onclick={run} disabled={selected.size === 0}>
        {m.crm_export_download({ count })}
      </Button>
    </footer>
  </div>
{/if}

<style>
  :global(.ovl) {
    position: fixed;
    inset: 0;
    z-index: var(--layer-command);
    background: color-mix(in srgb, var(--color-bg) 50%, transparent);
  }
  .dlg {
    position: fixed;
    z-index: var(--layer-command);
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: min(28rem, calc(100vw - 2rem));
    max-height: min(80vh, 40rem);
    display: flex;
    flex-direction: column;
    background: var(--color-card);
    border: 1px solid var(--hairline);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-elevation-2);
  }
  .dlg-h {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--space-3) var(--space-4);
    border-bottom: 1px solid var(--hairline);
    font-weight: 600;
    font-size: var(--font-size-body);
  }
  .dlg :global(.x) {
    display: inline-flex;
    color: var(--color-muted-foreground);
  }
  .dlg :global(.x):hover {
    color: var(--color-foreground);
  }
  .dlg-body {
    padding: var(--space-3) var(--space-4);
    overflow: auto;
  }
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
  .dlg :global(.fmt-btn) {
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
  .dlg :global(.fmt-btn):hover {
    color: var(--color-foreground);
  }
  .dlg :global(.fmt-btn.on) {
    color: var(--color-accent);
    border-color: var(--color-accent);
    background: color-mix(in srgb, var(--color-accent) 12%, transparent);
  }
  .cols {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-0-5);
  }
  .dlg :global(.col) {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-1) var(--space-2);
    border-radius: var(--radius-sm, 6px);
    text-align: left;
  }
  .dlg :global(.col):hover {
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
  .dlg-f {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-2);
    padding: var(--space-3) var(--space-4);
    border-top: 1px solid var(--hairline);
  }
</style>
