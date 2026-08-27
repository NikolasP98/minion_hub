<script lang="ts" module>
  export interface StockItemOption {
    id: string;
    code: string;
    name: string;
    uom: string;
    itemGroup?: string | null;
  }
</script>

<script lang="ts">
  import { Button, Input } from '$lib/components/ui';
  import * as m from '$lib/paraglide/messages';

  let {
    oncreated,
    oncancel,
    initialCode = '',
    initialName = '',
  }: {
    oncreated: (item: StockItemOption) => void;
    oncancel: () => void;
    initialCode?: string;
    initialName?: string;
  } = $props();

  // svelte-ignore state_referenced_locally -- form seeds are intentionally one-shot
  let code = $state(initialCode);
  // svelte-ignore state_referenced_locally -- form seeds are intentionally one-shot
  let name = $state(initialName);
  let uom = $state('unit');
  let itemGroup = $state('');
  let busy = $state(false);
  let createError = $state<string | null>(null);

  const valid = $derived(code.trim() !== '' && name.trim() !== '' && uom.trim() !== '');

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    if (!valid || busy) return;
    busy = true;
    createError = null;
    try {
      const response = await fetch('/api/stock/items', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          code: code.trim(),
          name: name.trim(),
          uom: uom.trim(),
          itemGroup: itemGroup.trim() || null,
        }),
      });
      if (!response.ok) {
        createError = m.stock_item_save_failed();
        return;
      }
      const item = (await response.json()) as StockItemOption;
      oncreated(item);
    } catch {
      createError = m.stock_item_save_failed();
    } finally {
      busy = false;
    }
  }
</script>

<form class="stock-item-create" onsubmit={submit}>
  <div class="stock-item-fields">
    <Input size="sm" label={m.stock_field_code()} required bind:value={code} />
    <Input size="sm" label={m.stock_field_name()} required bind:value={name} />
    <Input size="sm" label={m.stock_field_uom()} required bind:value={uom} />
    <Input size="sm" label={m.stock_col_group()} bind:value={itemGroup} />
  </div>
  {#if createError}<p class="stock-item-error t-caption" role="alert">{createError}</p>{/if}
  <div class="stock-item-actions">
    <Button type="button" variant="outline" size="sm" onclick={oncancel}>
      {m.common_cancel()}
    </Button>
    <Button type="submit" variant="primary" size="sm" loading={busy} disabled={!valid}>
      {m.stock_create()}
    </Button>
  </div>
</form>

<style>
  .stock-item-create {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }
  .stock-item-fields {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--space-3);
  }
  .stock-item-actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-2);
    padding-top: var(--space-3);
    border-top: 1px solid var(--color-border-subtle);
  }
  .stock-item-error {
    color: var(--color-danger-fg);
  }
  @media (max-width: 47.99875rem) {
    .stock-item-fields {
      grid-template-columns: minmax(0, 1fr);
    }
  }
</style>
