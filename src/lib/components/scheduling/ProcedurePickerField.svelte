<script lang="ts">
  /** Single-select Picker over the catalog's service sellables (the "linked procedure"). */
  import { ListFilter, X } from 'lucide-svelte';
  import { Button, Picker, iconSizes, type PickerColumn } from '$lib/components/ui';
  import * as m from '$lib/paraglide/messages';

  type Product = { id: string; name: string };
  let {
    products,
    value = $bindable(null),
  }: {
    products: Product[];
    value?: string | null;
  } = $props();

  const selected = $derived(products.find((p) => p.id === value) ?? null);
  let open = $state(false);

  const columns: PickerColumn<Product>[] = [
    {
      key: 'name',
      label: m.sched_et_product(),
      priority: 10,
      emphasis: 'primary',
      hideable: false,
      searchable: true,
    },
  ];
</script>

<div class="procedure-field">
  <Button
    type="button"
    variant="outline"
    size="sm"
    class="procedure-trigger"
    aria-haspopup="dialog"
    onclick={() => (open = true)}
  >
    <span class="procedure-label" class:is-placeholder={!selected}>
      {selected?.name ?? m.sched_et_pick_procedure()}
    </span>
    <ListFilter size={iconSizes.sm} aria-hidden="true" />
  </Button>
  {#if selected}
    <Button
      type="button"
      variant="ghost"
      size="xs"
      shape="icon"
      aria-label={m.common_reset()}
      onclick={() => (value = null)}
    >
      <X size={iconSizes.sm} aria-hidden="true" />
    </Button>
  {/if}
</div>

<Picker
  bind:open
  title={m.sched_et_pick_procedure()}
  {columns}
  rows={products}
  getRowId={(p) => p.id}
  searchText={(p) => p.name}
  onPick={(p) => (value = p.id)}
  selectionMode="single"
  searchPlaceholder={m.sched_et_pick_procedure()}
  emptyLabel={m.sched_none()}
  storageKey="sched-procedure"
/>

<style>
  .procedure-field {
    display: flex;
    align-items: center;
    gap: var(--space-1);
  }
  .procedure-field :global(.procedure-trigger) {
    flex: 1;
    min-width: 0;
  }
  .procedure-field :global(.procedure-trigger > span) {
    width: 100%;
    justify-content: space-between;
  }
  .procedure-label {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .is-placeholder {
    color: var(--color-text-tertiary);
  }
</style>
