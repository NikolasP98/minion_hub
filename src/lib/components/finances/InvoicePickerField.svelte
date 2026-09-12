<script lang="ts" module>
  /** An invoice as the booking↔invoice picker sees it (spec S6). */
  export interface InvoiceOption {
    id: string;
    number: string | null;
    documentId: string | null;
    issuedAt: string | null;
    clientName: string | null;
    total: string | null;
  }
</script>

<script lang="ts">
  import { ListFilter, X } from 'lucide-svelte';
  import { Button, Picker, iconSizes, type PickerColumn } from '$lib/components/ui';
  import * as m from '$lib/paraglide/messages';

  let {
    value = $bindable<string | null>(null),
    /** Display label for an already-linked invoice (edit-time seed) — the
     *  picker never re-fetches just to resolve a label for the current value. */
    initialLabel = null,
    onchange,
  }: {
    value?: string | null;
    initialLabel?: string | null;
    onchange?: (id: string | null) => void;
  } = $props();

  // svelte-ignore state_referenced_locally
  let selectedLabel = $state<string | null>(initialLabel);
  let open = $state(false);

  const columns: PickerColumn<InvoiceOption>[] = [
    {
      key: 'document',
      label: m.fin_invoice_picker_document(),
      value: (inv) => inv.documentId ?? inv.number ?? '',
      priority: 10,
      emphasis: 'primary',
      hideable: false,
      searchable: true,
    },
    {
      key: 'clientName',
      label: m.fin_invoice_picker_client(),
      value: (inv) => inv.clientName ?? '',
      priority: 20,
      searchable: true,
    },
    {
      key: 'issuedAt',
      label: m.fin_invoice_picker_date(),
      value: (inv) => (inv.issuedAt ? new Date(inv.issuedAt).toLocaleDateString() : ''),
      priority: 30,
    },
    {
      key: 'total',
      label: m.fin_col_total(),
      value: (inv) => inv.total ?? '',
      align: 'right',
      priority: 40,
    },
  ];

  async function loadRows(q: string): Promise<InvoiceOption[]> {
    const res = await fetch(`/api/finances/invoices?q=${encodeURIComponent(q)}&limit=20`);
    if (!res.ok) return [];
    return (await res.json()) as InvoiceOption[];
  }

  function pick(inv: InvoiceOption) {
    value = inv.id;
    selectedLabel = inv.documentId ?? inv.number ?? inv.id;
    onchange?.(inv.id);
  }
  function clear() {
    value = null;
    selectedLabel = null;
    onchange?.(null);
  }
</script>

<div class="invoice-field">
  <Button
    type="button"
    variant="outline"
    size="sm"
    class="invoice-trigger"
    aria-haspopup="dialog"
    onclick={() => (open = true)}
  >
    <span class="invoice-label" class:is-placeholder={!value}>
      {selectedLabel ?? m.sched_invoice_choose()}
    </span>
    <ListFilter size={iconSizes.sm} aria-hidden="true" />
  </Button>
  {#if value}
    <Button
      type="button"
      variant="ghost"
      size="xs"
      shape="icon"
      aria-label={m.common_reset()}
      onclick={clear}
    >
      <X size={iconSizes.sm} aria-hidden="true" />
    </Button>
  {/if}
</div>

<Picker
  bind:open
  title={m.sched_invoice_choose()}
  {columns}
  {loadRows}
  getRowId={(inv) => inv.id}
  onPick={pick}
  selectionMode="single"
  searchPlaceholder={m.sched_invoice_choose()}
  emptyLabel={m.sched_invoice_empty()}
  storageKey="sched-invoice"
/>

<style>
  .invoice-field {
    display: flex;
    align-items: center;
    gap: var(--space-1);
  }
  .invoice-field :global(.invoice-trigger) {
    flex: 1;
    min-width: 0;
  }
  .invoice-field :global(.invoice-trigger > span) {
    width: 100%;
    justify-content: space-between;
  }
  .invoice-label {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .is-placeholder {
    color: var(--color-text-tertiary);
  }
</style>
