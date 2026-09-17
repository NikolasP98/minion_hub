<script lang="ts">
  import type { PageData } from './$types';
  import { page } from '$app/state';
  import { goto } from '$lib/navigation';
  import * as m from '$lib/paraglide/messages';
  import { ArrowLeftRight, Plus, Trash2 } from 'lucide-svelte';
  import { PageHeader, Button, Combobox } from '$lib/components/ui';
  import PartyPicker from '$lib/components/crm/PartyPicker.svelte';
  import StockItemPicker from '$lib/components/stock/StockItemPicker.svelte';
  import type { StockItemOption } from '$lib/components/stock/StockItemCreateForm.svelte';
  import { partyPickerSearchParams, type PartyOption } from '$lib/components/crm/party-picker';
  import { registerForm } from '$lib/assistant/forms';
  import { fuzzyFind } from '$lib/assistant/fuzzy';
  import { STOCK_ENTRY_FORM } from '$lib/assistant/catalog';
  import { mergePickedLine, type EntryLine } from './entry-lines';

  let { data }: { data: PageData } = $props();

  type EntryType = 'receipt' | 'issue' | 'transfer' | 'adjustment';
  const ENTRY_TYPES: EntryType[] = ['receipt', 'issue', 'transfer', 'adjustment'];
  function isEntryType(v: string | null): v is EntryType {
    return v != null && (ENTRY_TYPES as string[]).includes(v);
  }

  // The movement kind comes from the action the user picked on /stock/entries
  // (?type=...). A deep link without a valid type gets the chooser fallback.
  const urlType = $derived(page.url.searchParams.get('type'));
  const type = $derived(isEntryType(urlType) ? urlType : null);

  let partyId = $state<string | null>(null);
  let partyPicker = $state<ReturnType<typeof PartyPicker>>();
  let note = $state('');

  let lines = $state<EntryLine[]>([]);
  let pickerOpen = $state(false);
  let createdItems = $state<StockItemOption[]>([]);
  // Row index to flash+scroll-into-view after a duplicate pick merges into
  // an existing line, so the qty bump isn't invisible.
  let flashIndex = $state<number | null>(null);
  let rowEls = $state<(HTMLTableRowElement | null)[]>([]);

  $effect(() => {
    const idx = flashIndex;
    if (idx == null) return;
    rowEls[idx]?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    const timer = setTimeout(() => {
      flashIndex = null;
    }, 900);
    return () => clearTimeout(timer);
  });

  const needsFrom = $derived(type === 'issue' || type === 'transfer' || type === 'adjustment');
  const needsTo = $derived(type === 'receipt' || type === 'transfer' || type === 'adjustment');
  // A receipt always needs a rate. An adjustment only needs one on the
  // found-stock side (`toWarehouseId` set) — that's the positive delta the
  // server values at this rate (stock.logic.ts `validateEntryLine`); a
  // write-off (`fromWarehouseId` set) consumes at the bin's existing rate.
  const needsRate = $derived(type === 'receipt' || type === 'adjustment');
  function rateRequired(l: EntryLine): boolean {
    if (type === 'receipt') return true;
    if (type === 'adjustment') return l.toWarehouseId !== '';
    return false;
  }

  const availableItems = $derived([...createdItems, ...data.items]);
  const itemById = $derived(new Map(availableItems.map((item) => [item.id, item])));
  const defaultWarehouseId = $derived(
    data.warehouses.find((w) => w.isDefault)?.id ?? data.warehouses[0]?.id ?? '',
  );

  function itemLabel(id: string): string {
    const it = itemById.get(id);
    return it ? `${it.code} — ${it.name}` : id;
  }

  type Item = StockItemOption;
  const pickedItemIds = $derived(new Set(lines.map((l) => l.itemId)));

  function addItem(item: Item) {
    if (!itemById.has(item.id)) createdItems = [item, ...createdItems];
    const { lines: next, mergedIndex } = mergePickedLine(lines, item.id, () => ({
      itemId: item.id,
      qty: '1',
      rate: '',
      // Adjustment must end up with exactly ONE side — leave both empty and
      // let the row's validity highlight steer the choice.
      fromWarehouseId: needsFrom && type !== 'adjustment' ? defaultWarehouseId : '',
      toWarehouseId: needsTo && type !== 'adjustment' ? defaultWarehouseId : '',
    }));
    lines = next;
    flashIndex = mergedIndex;
  }
  function removeLine(i: number) {
    lines = lines.filter((_, idx) => idx !== i);
  }

  function lineValid(l: EntryLine): boolean {
    return (
      l.itemId !== '' &&
      Number(l.qty) > 0 &&
      (!needsFrom || type === 'adjustment' || l.fromWarehouseId !== '') &&
      (!needsTo || type === 'adjustment' || l.toWarehouseId !== '') &&
      (type !== 'adjustment' || (l.fromWarehouseId !== '') !== (l.toWarehouseId !== '')) &&
      (!rateRequired(l) || l.rate !== '')
    );
  }
  const allValid = $derived(lines.length > 0 && lines.every(lineValid));

  function payload() {
    return {
      type,
      partyId,
      note: note || null,
      lines: lines.map((l) => ({
        itemId: l.itemId,
        qty: Number(l.qty),
        rate: l.rate !== '' ? Number(l.rate) : null,
        fromWarehouseId: l.fromWarehouseId || null,
        toWarehouseId: l.toWarehouseId || null,
      })),
    };
  }

  let busy = $state(false);
  let err = $state<string | null>(null);

  async function errMessage(res: Response): Promise<string> {
    try {
      const body = await res.json();
      return body?.message ?? m.stock_create_failed();
    } catch {
      return m.stock_create_failed();
    }
  }

  async function saveDraft() {
    busy = true;
    err = null;
    try {
      const res = await fetch('/api/stock/entries', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload()),
      });
      if (res.ok) {
        const entry = await res.json();
        await goto(`/stock/entries/${entry.id}`);
      } else {
        err = await errMessage(res);
      }
    } finally {
      busy = false;
    }
  }

  async function saveAndSubmit() {
    busy = true;
    err = null;
    try {
      const createRes = await fetch('/api/stock/entries', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload()),
      });
      if (!createRes.ok) {
        err = await errMessage(createRes);
        return;
      }
      const entry = await createRes.json();
      const submitRes = await fetch(`/api/stock/entries/${entry.id}/submit`, { method: 'POST' });
      if (!submitRes.ok) {
        err = await errMessage(submitRes);
        // Draft was created even though submit failed — send them to it so the
        // error isn't a dead end.
        await goto(`/stock/entries/${entry.id}`);
        return;
      }
      await goto(`/stock/entries/${entry.id}`);
    } finally {
      busy = false;
    }
  }

  // ── Assistant fill tool ──────────────────────────────────────────────────
  // Entity fields arrive as free text; resolve them against what the page has
  // loaded (typo-tolerant, see $lib/assistant/fuzzy). `item` always appends a
  // line (lines have no "empty" state); qty / rate / warehouse land on that
  // line, else on the last one.
  $effect(() =>
    registerForm({
      def: STOCK_ENTRY_FORM,
      get: () => {
        const l = lines.at(-1);
        return {
          type,
          party: partyId,
          item: l?.itemId,
          qty: l?.qty,
          rate: l?.rate,
          warehouse: l?.toWarehouseId || l?.fromWarehouseId,
          note,
        };
      },
      set: async (v) => {
        const rejected: Array<{ key: string; reason: string }> = [];
        const notes: string[] = [];
        const matched = (typed: string, label: string) => {
          if (typed.trim().toLowerCase() !== label.trim().toLowerCase())
            notes.push(`matched "${typed}" → "${label}"`);
        };
        if (isEntryType(String(v.type ?? '')) && v.type !== type)
          await goto(`/stock/entries/new?type=${v.type}`, { replaceState: true });
        if (!type) return { rejected: [{ key: 'type', reason: 'pick an entry type first' }] };

        if (typeof v.note === 'string') note = v.note;

        if (typeof v.party === 'string' && v.party.trim()) {
          const res = await fetch(
            `/api/crm/parties?${partyPickerSearchParams(v.party, undefined, undefined, 'ruc')}`,
          );
          const found = res.ok ? ((await res.json()) as PartyOption[]) : [];
          const { match, candidates } = fuzzyFind(v.party, found, (p) => [
            p.name,
            p.docNumber,
            p.phone9,
          ]);
          if (match) {
            partyPicker?.pick(match);
            matched(v.party, match.name ?? '');
          } else
            rejected.push({
              key: 'party',
              reason: `no party matches "${v.party}"; did you mean: ${candidates.map((p) => p.name ?? p.docNumber ?? '—').join(', ') || 'none'}`,
            });
        }

        if (typeof v.item === 'string' && v.item.trim()) {
          const { match, candidates } = fuzzyFind(v.item, availableItems, (it) => [
            it.code,
            it.name,
          ]);
          if (match) {
            addItem(match);
            matched(v.item, match.name);
          } else
            rejected.push({
              key: 'item',
              reason: `no stock item matches "${v.item}"; did you mean: ${candidates.map((it) => `${it.code} — ${it.name}`).join(', ') || 'none'}`,
            });
        }

        const line = lines.at(-1);
        for (const key of ['qty', 'rate', 'warehouse'] as const) {
          if (v[key] == null) continue;
          if (!line) {
            rejected.push({ key, reason: 'add an item first' });
            continue;
          }
          if (key === 'warehouse') {
            const typed = String(v.warehouse);
            const { match: w, candidates } = fuzzyFind(typed, data.warehouses, (x) => [x.name]);
            if (!w) {
              rejected.push({
                key,
                reason: `no warehouse matches "${typed}"; did you mean: ${candidates.map((x) => x.name).join(', ') || 'none'}`,
              });
            } else {
              matched(typed, w.name);
              if (needsTo && type !== 'transfer') line.toWarehouseId = w.id;
              else line.fromWarehouseId = w.id;
            }
          } else line[key] = String(v[key]);
        }
        return { rejected, note: notes.join('; ') || undefined };
      },
    }),
  );

  function typeLabel(t: EntryType): string {
    return t === 'receipt'
      ? m.stock_type_receipt()
      : t === 'issue'
        ? m.stock_type_issue()
        : t === 'transfer'
          ? m.stock_type_transfer()
          : m.stock_type_adjustment();
  }
</script>

<svelte:head><title>{m.stock_new_entry_title()} — {m.nav_stock()}</title></svelte:head>

<div class="flex flex-col h-full min-h-0 flex-1 min-w-0">
  <PageHeader title={m.stock_new_entry_title()} subtitle={type ? typeLabel(type) : undefined}>
    {#snippet leading()}<ArrowLeftRight size={16} class="text-accent shrink-0" />{/snippet}
  </PageHeader>

  <div class="flex-1 min-h-0 overflow-auto p-4">
    <div class="w-full max-w-2xl mx-auto flex flex-col gap-4">
      {#if !type}
        <!-- Deep-link fallback: no (or invalid) ?type= — offer the four kinds. -->
        <div class="card flex flex-col gap-3">
          <p class="t-caption">{m.stock_step_type_hint()}</p>
          <div class="type-grid" data-assist="stock_entry.type">
            {#each ENTRY_TYPES.filter((t) => t !== 'transfer' || data.warehouses.length > 1) as t (t)}
              <Button
                variant="ghost"
                class="type-btn"
                onclick={() => goto(`/stock/entries/new?type=${t}`, { replaceState: true })}
              >
                {typeLabel(t)}
              </Button>
            {/each}
          </div>
        </div>
      {:else}
        <div class="card flex flex-col gap-3">
          <div data-assist="stock_entry.party">
            <PartyPicker
              bind:this={partyPicker}
              bind:value={partyId}
              label={m.stock_field_party()}
              docLookup
              doc="ruc"
            />
          </div>
          <label class="fld">
            <span>{m.stock_field_note()}</span>
            <textarea class="inp" rows="2" bind:value={note}></textarea>
          </label>
        </div>

        <div class="card flex flex-col gap-3">
          <div class="flex items-center justify-between">
            <span class="card-h">{m.stock_step_lines()}</span>
            <Button
              variant="outline"
              size="sm"
              onclick={() => (pickerOpen = true)}
              data-assist="stock_entry.item"
            >
              <Plus size={14} />
              {m.stock_add_items()}
            </Button>
          </div>

          {#if lines.length === 0}
            <p class="t-caption">{m.stock_lines_empty()}</p>
          {:else}
            <table class="mini-table">
              <thead>
                <tr>
                  <th>{m.stock_field_item()}</th>
                  <th class="num">{m.stock_field_qty()}</th>
                  {#if needsRate}<th class="num">{m.stock_field_rate()}</th>{/if}
                  {#if needsFrom}<th>{m.stock_field_from_warehouse()}</th>{/if}
                  {#if needsTo}<th>{m.stock_field_to_warehouse()}</th>{/if}
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {#each lines as l, i (l.itemId + i)}
                  <tr
                    bind:this={rowEls[i]}
                    class:invalid={!lineValid(l)}
                    class:flash={flashIndex === i}
                  >
                    <td class="item-cell" title={itemLabel(l.itemId)}>
                      <span class="item-code">{itemById.get(l.itemId)?.code ?? l.itemId}</span>
                      <span class="item-name">{itemById.get(l.itemId)?.name ?? ''}</span>
                    </td>
                    <td class="num">
                      <input
                        class="inp cell-in num"
                        type="number"
                        min="0"
                        step="0.01"
                        bind:value={l.qty}
                        aria-label={m.stock_field_qty()}
                        data-assist="stock_entry.qty"
                      />
                    </td>
                    {#if needsRate}
                      <td class="num">
                        {#if rateRequired(l)}
                          <input
                            class="inp cell-in num"
                            type="number"
                            min="0"
                            step="0.01"
                            bind:value={l.rate}
                            aria-label={m.stock_field_rate()}
                            data-assist="stock_entry.rate"
                          />
                        {:else if type === 'adjustment'}
                          <span class="t-caption">{m.stock_adjustment_rate_na()}</span>
                        {/if}
                      </td>
                    {/if}
                    {#if needsFrom}
                      <td class="wh-cell">
                        <Combobox
                          id={`line-${i}-from`}
                          items={data.warehouses}
                          itemToValue={(w) => w.id}
                          itemToString={(w) => w.name}
                          placeholder={m.stock_field_from_warehouse()}
                          bind:value={l.fromWarehouseId}
                        />
                      </td>
                    {/if}
                    {#if needsTo}
                      <td class="wh-cell">
                        <Combobox
                          id={`line-${i}-to`}
                          items={data.warehouses}
                          itemToValue={(w) => w.id}
                          itemToString={(w) => w.name}
                          placeholder={m.stock_field_to_warehouse()}
                          bind:value={l.toWarehouseId}
                        />
                      </td>
                    {/if}
                    <td class="actions-cell">
                      <Button variant="ghost" class="rm-btn" onclick={() => removeLine(i)}>
                        <Trash2 size={13} />
                      </Button>
                    </td>
                  </tr>
                {/each}
              </tbody>
            </table>
            {#if type === 'adjustment'}
              <p class="t-caption">{m.stock_adjustment_hint()}</p>
            {/if}
          {/if}

          {#if err}<p class="err-msg">{err}</p>{/if}
          <div class="flex justify-end gap-2">
            <Button variant="outline" size="sm" onclick={saveDraft} disabled={busy || !allValid}>
              {m.stock_save_draft()}
            </Button>
            <Button
              variant="primary"
              size="sm"
              onclick={saveAndSubmit}
              disabled={busy || !allValid}
              data-assist="stock_entry.submit"
            >
              {m.stock_submit()}
            </Button>
          </div>
        </div>
      {/if}
    </div>
  </div>
</div>

<StockItemPicker
  bind:open={pickerOpen}
  items={availableItems}
  title={m.stock_add_items()}
  onPick={addItem}
  selectionMode="multiple"
  duplicatePolicy="allow"
  pickedIds={pickedItemIds}
  columnsConfigurable
  storageKey="stock-entry-items"
/>

<style>
  .card {
    border: 1px solid var(--hairline);
    border-radius: var(--radius-lg);
    background: var(--color-card);
    padding: var(--space-4);
  }
  .card-h {
    font-size: var(--font-size-body);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    color: var(--color-muted-foreground);
  }
  .type-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: var(--space-2);
  }
  .type-grid :global(.type-btn) {
    padding: var(--space-2);
    border-radius: var(--radius-md);
    border: 1px solid var(--hairline);
    background: transparent;
    cursor: pointer;
    color: var(--color-foreground);
  }
  .type-grid :global(.type-btn:hover) {
    border-color: var(--color-accent);
    color: var(--color-accent);
  }
  .fld {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    font-size: var(--font-size-body);
    color: var(--color-muted-foreground);
  }
  .inp {
    min-height: 2rem;
    padding: var(--space-2) var(--space-2);
    font-size: var(--font-size-body);
    border-radius: var(--radius-sm);
    background: var(--color-bg3);
    border: 1px solid var(--hairline);
    color: var(--color-foreground);
    font-family: inherit;
  }
  .cell-in {
    min-height: 1.7rem;
    padding: 0 var(--space-1);
    width: 5.5rem;
  }
  .cell-in.num {
    text-align: right;
  }
  /* TODO(handoff): on adjustment/transfer entries (5 columns: item, qty,
     rate, from, to) this table already overflows the card's own right edge
     at ~1280px — pre-existing, confirmed unchanged by this PR (diffed
     against origin/master), out of scope here per the ticket ("desktop
     stays as it is"). Needs either a wider card for this route or a
     narrower column set (e.g. collapse from/to into one "warehouse" combo
     with a direction toggle) — see specs/ for the stock entries UI. */
  .mini-table {
    width: 100%;
    font-size: var(--font-size-body);
    border-collapse: collapse;
  }
  .mini-table th {
    text-align: left;
    font-weight: 500;
    color: var(--color-muted-foreground);
    padding: var(--space-1) var(--space-2);
    border-bottom: 1px solid var(--hairline);
  }
  .mini-table td {
    padding: var(--space-1) var(--space-2);
    border-bottom: 1px solid var(--hairline);
  }
  .mini-table .num {
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
  .mini-table tr.invalid td {
    background: color-mix(in srgb, var(--color-warning-fg) 7%, transparent);
  }
  .mini-table tr.flash td {
    animation: line-flash var(--duration-slow) var(--ease-standard);
  }
  @keyframes line-flash {
    from {
      background: color-mix(in srgb, var(--color-accent) 16%, transparent);
    }
    to {
      background: transparent;
    }
  }
  .mini-table :global(.rm-btn) {
    background: none;
    border: none;
    color: var(--color-muted-foreground);
    cursor: pointer;
  }
  .mini-table :global(.rm-btn):hover {
    color: var(--color-destructive);
  }
  .item-cell {
    display: flex;
    flex-direction: column;
    gap: var(--space-0-5);
    min-width: 0;
    max-width: 14rem;
  }
  .item-code {
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .item-name {
    color: var(--color-muted-foreground);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* Narrow viewports: the fixed-width table columns (qty/rate/warehouse
     selects) no longer fit side by side, so each row wraps its cells
     instead of forcing the card (and page) to scroll horizontally. */
  @media (max-width: 768px) {
    .mini-table,
    .mini-table tbody,
    .mini-table tr,
    .mini-table td {
      display: block;
      width: auto;
      max-width: none;
    }
    .mini-table thead {
      display: none;
    }
    .mini-table tr {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--space-2);
      padding: var(--space-2) 0;
    }
    .mini-table td {
      padding: 0;
      border-bottom: none;
    }
    .mini-table td.item-cell {
      flex: 1 1 100%;
    }
    .mini-table td.num {
      flex: 0 1 6rem;
    }
    .mini-table td.wh-cell {
      flex: 1 1 9rem;
      min-width: 0;
    }
    .mini-table td.actions-cell {
      flex: 0 0 auto;
      margin-left: auto;
    }
  }
  .err-msg {
    font-size: var(--font-size-body);
    color: var(--color-destructive);
  }
</style>
