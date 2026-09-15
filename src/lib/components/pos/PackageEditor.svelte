<script lang="ts">
  /**
   * Package composition for one sellable (spec
   * `2026-09-13-pos-scheduling-packages-payment-plans` §4.3): the
   * `fin_product_components` edges that make it a package, plus the validity
   * window grants inherit when it is sold.
   *
   * Reads/writes `GET|PUT /api/pos/sellables/[id]/components`. The PUT REPLACES
   * the edge set, so removing a row and saving is the delete path — one code
   * path instead of a per-row DELETE that could half-apply.
   */
  import { Plus, Trash2, ListFilter } from 'lucide-svelte';
  import { Button, Input, Picker, Spinner, iconSizes, type PickerColumn } from '$lib/components/ui';
  import * as m from '$lib/paraglide/messages';
  import { formatMoney } from '$lib/utils/format';
  import { toastError, toastSuccess } from '$lib/state/ui/toast.svelte';

  interface Candidate {
    productId: string;
    code: string;
    name: string;
    unitPrice: number | null;
    kind: 'product' | 'service' | 'bundle';
  }

  interface Props {
    /** The sellable being composed (fin_products.id). */
    productId: string;
    /** The whole catalog — the child picker's candidate pool. */
    sellables: Candidate[];
    canEdit: boolean;
    onChanged: () => void;
  }

  let { productId, sellables, canEdit, onChanged }: Props = $props();

  type Edge = { childProductId: string; qty: number };

  let rows = $state<Edge[]>([]);
  let validity = $state('');
  let loading = $state(true);
  let busy = $state(false);
  let pickerOpen = $state(false);

  const byId = $derived(new Map(sellables.map((s) => [s.productId, s])));
  const picked = $derived(new Set(rows.map((r) => r.childProductId)));
  /** The server's cycle guard is one level deep: a package may not contain a
   *  package. Mirror it so the picker never offers a row the PUT would reject. */
  const candidates = $derived(
    sellables.filter((s) => s.productId !== productId && s.kind !== 'bundle'),
  );

  const pickerColumns: PickerColumn<Candidate>[] = [
    { key: 'code', label: m.stock_col_code(), value: (s) => s.code, searchable: true },
    {
      key: 'name',
      label: m.stock_col_name(),
      value: (s) => s.name,
      emphasis: 'primary',
      searchable: true,
    },
    {
      key: 'unitPrice',
      label: m.pos_sell_price(),
      align: 'right',
      value: (s) => (s.unitPrice != null ? formatMoney(s.unitPrice) : '—'),
    },
  ];

  $effect(() => {
    const id = productId;
    loading = true;
    void (async () => {
      try {
        const res = await fetch(`/api/pos/sellables/${id}/components`);
        if (!res.ok) throw new Error(String(res.status));
        const j = (await res.json()) as {
          components: Array<{ childProductId: string; qty: number }>;
          packageValidityDays: number | null;
        };
        rows = j.components.map((c) => ({ childProductId: c.childProductId, qty: Number(c.qty) }));
        validity = j.packageValidityDays == null ? '' : String(j.packageValidityDays);
      } catch {
        rows = [];
        validity = '';
      } finally {
        loading = false;
      }
    })();
  });

  function addChild(s: Candidate) {
    if (picked.has(s.productId)) return;
    rows = [...rows, { childProductId: s.productId, qty: 1 }];
  }

  function setQty(i: number, raw: string) {
    const n = Number(raw);
    rows[i].qty = Number.isFinite(n) && n > 0 ? n : 1;
  }

  async function save() {
    busy = true;
    try {
      const days = validity.trim() === '' ? null : Math.floor(Number(validity));
      const res = await fetch(`/api/pos/sellables/${productId}/components`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          components: rows.map((r, i) => ({ ...r, lineNo: i })),
          packageValidityDays: days && days > 0 ? days : null,
        }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        toastError(j.error ?? m.data_table_save_failed());
        return;
      }
      toastSuccess(m.pos_pkg_saved());
      onChanged();
    } finally {
      busy = false;
    }
  }
</script>

<div class="pkg">
  <p class="t-caption head">{m.pos_pkg_editor_title()}</p>

  {#if loading}
    <Spinner />
  {:else}
    {#if rows.length === 0}
      <p class="t-caption dim">{m.pos_pkg_editor_empty()}</p>
    {:else}
      <ul class="rows">
        {#each rows as r, i (r.childProductId)}
          <li class="row">
            <Input
              size="sm"
              class="w-20"
              type="number"
              min="1"
              step="1"
              aria-label={m.pos_pkg_sessions_per()}
              value={String(r.qty)}
              disabled={!canEdit}
              oninput={(e: Event) => setQty(i, (e.currentTarget as HTMLInputElement).value)}
            />
            <span class="t-caption">{m.pos_pkg_sessions_per()}</span>
            <span class="name">{byId.get(r.childProductId)?.name ?? r.childProductId}</span>
            {#if canEdit}
              <Button
                variant="ghost"
                size="sm"
                aria-label={m.common_remove()}
                onclick={() => (rows = rows.filter((_, idx) => idx !== i))}
              >
                <Trash2 size={iconSizes.xs} />
              </Button>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}

    {#if canEdit}
      <div class="add">
        <Button variant="outline" size="sm" onclick={() => (pickerOpen = true)}>
          <ListFilter size={iconSizes.sm} aria-hidden="true" />
          <span>{m.pos_pkg_editor_pick()}</span>
        </Button>
        <label class="fld t-caption">
          {m.pos_pkg_validity()}
          <Input
            size="sm"
            class="w-24"
            type="number"
            min="1"
            step="1"
            placeholder={m.pos_pkg_validity_none()}
            bind:value={validity}
          />
        </label>
        <Button variant="outline" size="sm" disabled={busy} onclick={save}>
          <Plus size={iconSizes.xs} />
          {m.pos_pkg_save()}
        </Button>
      </div>
    {/if}
  {/if}
</div>

<Picker
  bind:open={pickerOpen}
  title={m.pos_pkg_editor_pick()}
  columns={pickerColumns}
  rows={candidates}
  getRowId={(s) => s.productId}
  onPick={addChild}
  selectionMode="multiple"
  duplicatePolicy="prevent"
  pickedIds={picked}
  storageKey="pos-package-components"
/>

<style>
  .pkg {
    padding: var(--space-2) var(--space-4);
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .head {
    color: var(--color-text-tertiary);
  }
  .dim {
    color: var(--color-text-tertiary);
  }
  .rows {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }
  .row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }
  .name {
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .add {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
  }
  .fld {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    color: var(--color-text-secondary);
  }
</style>
