<script module lang="ts">
  /** One cached fetch result per catalog entry, keyed by productId — survives
   *  a transient unmount/remount of THIS component. DataTable's row
   *  virtualizer re-windows on every `flatItems.length` change (any row's
   *  expand/collapse, including a sibling's), which can briefly drop and
   *  re-add an already-open row's `expandedContent` block; without this
   *  cache that replayed the loading spinner and a redundant fetch for a row
   *  whose composition was already loaded (bug: expanding row B "reloaded"
   *  already-open row A). */
  type CompositionCacheEntry = {
    serviceRows: { childProductId: string; qty: number }[];
    consumptionRows: ConsumptionEdit[];
    validity: string;
  };
  // TODO(handoff): module-scoped for the page's lifetime, invalidated only by
  // this editor's own writes. A composition changed by another tab/user
  // while this one never reloads the page would show stale cached rows until
  // a full reload — see proposals/2026-10-12-hub-catalog-composition-cache-staleness.md.
  const compositionCache = new Map<string, CompositionCacheEntry>();
  /** One recipe row; `choicePath` places it among substitutes (meta spec 131). */
  type ConsumptionEdit = {
    itemId: string;
    qtyPerUnit: number;
    note: string | null;
    choicePath: string | null;
  };
</script>

<script lang="ts">
  /**
   * ONE composition list per catalog entry (spec 2026-10-10 catalog-service-
   * unification, Slice 2): "the catalog is a recipe book". A service is
   * composed of products and/or services; a product of products only.
   *
   * The editor picks the write path by child kind:
   *   service child → fin_product_components (PUT replace-set,
   *                   `/api/pos/sellables/[id]/components`) + the package
   *                   validity window
   *   product child → stk_consumption, the recipe (PATCH replace-set,
   *                   `/api/pos/sellables/[id]` `consumption`) — for a service
   *                   AND a product parent (meta spec 024: one stock path)
   * A product child is a stock item: what a sale or procedure consumes.
   */
  import { Trash2, ListFilter, Plus, Split, Star } from 'lucide-svelte';
  import {
    Badge,
    Button,
    Input,
    Picker,
    Spinner,
    iconSizes,
    type PickerColumn,
  } from '$lib/components/ui';
  import * as m from '$lib/paraglide/messages';
  import { formatMoney } from '$lib/utils/format';
  import { toastError } from '$lib/state/ui/toast.svelte';
  import {
    acceptsQty,
    candidatesFor,
    writePathFor,
    type Candidate,
    type Kind,
  } from './composition';
  import {
    addAlternative,
    makeDefault,
    recipeTree,
    type RecipeNode,
  } from '$lib/stock/recipe-choice';

  interface Sellable {
    productId: string;
    code: string;
    name: string;
    unitPrice: number | null;
    kind: 'product' | 'service' | 'bundle';
    active: boolean;
  }
  interface StockItem {
    id: string;
    code: string;
    name: string;
    uom: string;
  }
  interface Props {
    /** The entry being composed. */
    sellable: Pick<Sellable, 'productId' | 'kind'>;
    /** The whole catalog — service candidates. */
    sellables: Sellable[];
    /** Non-archived stock items — product candidates. */
    stockItems: StockItem[];
    stockEnabled: boolean;
    canEdit: boolean;
    onChanged: () => void;
  }

  let { sellable, sellables, stockItems, stockEnabled, canEdit, onChanged }: Props = $props();

  const parentKind = $derived<Kind>(sellable.kind === 'product' ? 'product' : 'service');

  /** One row of the list, whichever table it came from. */
  type Row = {
    id: string;
    kind: Kind;
    name: string;
    detail: string;
    qty: number;
    /** Storage handle: product id (service child), item id (consumption). */
    ref: string;
  };

  // svelte-ignore state_referenced_locally -- one-time seed from the module cache below
  const cacheHit = compositionCache.get(sellable.productId);
  let serviceRows = $state<{ childProductId: string; qty: number }[]>(cacheHit?.serviceRows ?? []);
  let consumptionRows = $state<ConsumptionEdit[]>(cacheHit?.consumptionRows ?? []);
  let validity = $state(cacheHit?.validity ?? '');
  let loading = $state(!cacheHit);
  // Writes queue instead of blocking: every edit lands, in order, and only the
  // rows still saving show a spinner.
  let saving = $state<string[]>([]);
  let queue: Promise<void> = Promise.resolve();
  let pickerOpen = $state(false);
  /** Where the picker's items land: the recipe itself, as a substitute of one
   *  row ("Or…"), or into one substitute option ("Add to this option"). */
  let pickTarget = $state<
    { kind: 'top' } | { kind: 'or'; itemId: string } | { kind: 'and'; path: string }
  >({ kind: 'top' });
  function openPicker(target: typeof pickTarget) {
    pickTarget = target;
    pickerOpen = true;
  }

  const productById = $derived(new Map(sellables.map((s) => [s.productId, s])));
  const itemById = $derived(new Map(stockItems.map((i) => [i.id, i])));

  const rows = $derived.by<Row[]>(() => {
    const out: Row[] = [];
    for (const r of serviceRows) {
      const p = productById.get(r.childProductId);
      out.push({
        id: `p:${r.childProductId}`,
        kind: 'service',
        name: p?.name ?? r.childProductId,
        detail: p?.unitPrice != null ? formatMoney(p.unitPrice) : '',
        qty: r.qty,
        ref: r.childProductId,
      });
    }
    for (const r of consumptionRows) out.push(consumptionRow(r));
    return out;
  });
  function consumptionRow(r: ConsumptionEdit): Row {
    const i = itemById.get(r.itemId);
    return {
      id: `i:${r.itemId}`,
      kind: 'product',
      name: i?.name ?? r.itemId,
      detail: i?.uom ?? '',
      qty: r.qtyPerUnit,
      ref: r.itemId,
    };
  }
  const recipe = $derived(recipeTree(consumptionRows));
  const picked = $derived(new Set(rows.map((r) => r.id)));
  const hasServiceChild = $derived(serviceRows.length > 0);

  const candidates = $derived(
    candidatesFor({ productId: sellable.productId, kind: parentKind }, sellables, stockItems, {
      stockEnabled,
      formatMoney,
    }).filter((c) => pickTarget.kind === 'top' || c.kind === 'product'),
  );

  const kindLabel = (k: Kind) =>
    k === 'product' ? m.pos_catalog_kind_product() : m.pos_catalog_kind_service();
  const kindTone = (k: Kind) => (k === 'product' ? 'accent' : 'info');

  const pickerColumns: PickerColumn<Candidate>[] = [
    { key: 'kind', label: m.pos_catalog_col_kind(), value: (c) => kindLabel(c.kind), priority: 5 },
    {
      key: 'code',
      label: m.stock_col_code(),
      value: (c) => c.code,
      searchable: true,
      priority: 10,
    },
    {
      key: 'name',
      label: m.stock_col_name(),
      value: (c) => c.name,
      emphasis: 'primary',
      searchable: true,
      priority: 20,
    },
    {
      key: 'detail',
      label: m.pos_sell_price(),
      value: (c) => c.detail,
      align: 'right',
      priority: 30,
    },
  ];

  $effect(() => {
    const id = sellable.productId;
    const kind = parentKind;
    const hit = compositionCache.get(id);
    if (hit) {
      // Already loaded (by this instance or a prior one for the same row) —
      // seed from cache instead of flashing the spinner and re-fetching.
      serviceRows = hit.serviceRows;
      consumptionRows = hit.consumptionRows;
      validity = hit.validity;
      loading = false;
      return;
    }
    loading = true;
    void (async () => {
      try {
        const [pkg, cons] = await Promise.all([
          kind === 'service'
            ? fetch(`/api/pos/sellables/${id}/components`).then((r) => (r.ok ? r.json() : null))
            : Promise.resolve(null),
          stockEnabled
            ? fetch(`/api/stock/consumption?finProductId=${id}`).then((r) => (r.ok ? r.json() : []))
            : Promise.resolve([]),
        ]);
        serviceRows = (pkg?.components ?? []).map(
          (c: { childProductId: string; qty: number | string }) => ({
            childProductId: c.childProductId,
            qty: Number(c.qty),
          }),
        );
        validity = pkg?.packageValidityDays == null ? '' : String(pkg.packageValidityDays);
        consumptionRows = (Array.isArray(cons) ? cons : []).map(
          (c: {
            itemId: string;
            qtyPerUnit: number | string;
            note?: string | null;
            choicePath?: string | null;
          }) => ({
            itemId: c.itemId,
            qtyPerUnit: Number(c.qtyPerUnit),
            note: c.note ?? null,
            choicePath: c.choicePath ?? null,
          }),
        );
      } catch {
        serviceRows = [];
        consumptionRows = [];
      } finally {
        loading = false;
      }
    })();
  });

  // Keep the cache in sync with settled state — covers both the fetch above
  // and every write below (add/setQty/remove/saveValidity all mutate these
  // $state vars directly). Guarded on `!loading` so the pre-fetch empty
  // defaults never overwrite a real cached entry.
  $effect(() => {
    if (loading) return;
    compositionCache.set(sellable.productId, {
      serviceRows,
      consumptionRows,
      validity,
    });
  });

  async function failed(res: Response): Promise<void> {
    const d = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
    toastError(
      d.code === 'component_cycle' ? m.pos_recipe_cycle() : (d.error ?? m.data_table_save_failed()),
    );
  }

  // ── Writes: each one replaces or edits exactly the table the row lives in ──
  async function writeServices(next: typeof serviceRows, days?: number | null) {
    const previous = serviceRows;
    serviceRows = next;
    let res: Response;
    try {
      res = await fetch(`/api/pos/sellables/${sellable.productId}/components`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          components: next.map((r, i) => ({ ...r, lineNo: i })),
          ...(days !== undefined ? { packageValidityDays: days } : {}),
        }),
      });
    } catch (error) {
      serviceRows = previous;
      throw error;
    }
    if (!res.ok) {
      serviceRows = previous;
      return failed(res);
    }
    serviceRows = next;
    onChanged();
  }
  async function writeConsumption(next: typeof consumptionRows) {
    const previous = consumptionRows;
    consumptionRows = next;
    let res: Response;
    try {
      res = await fetch(`/api/pos/sellables/${sellable.productId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ consumption: next }),
      });
    } catch (error) {
      consumptionRows = previous;
      throw error;
    }
    if (!res.ok) {
      consumptionRows = previous;
      return failed(res);
    }
    consumptionRows = next;
    onChanged();
  }
  /** Each write runs after the previous one settles and reads the rows as that
   *  one left them, so quick edits on several rows all reach the server. */
  function run(rowId: string, work: () => Promise<void>): Promise<void> {
    saving = [...saving, rowId];
    queue = queue
      .then(work)
      .catch(() => toastError(m.data_table_save_failed()))
      .finally(() => {
        const i = saving.indexOf(rowId);
        if (i >= 0) saving = saving.toSpliced(i, 1);
      });
    return queue;
  }

  function add(c: Candidate) {
    if (picked.has(c.id)) return;
    // Captured now: the queued write may run after the picker reopened elsewhere.
    const t = pickTarget;
    void run(c.id, async () => {
      switch (writePathFor(c.kind)) {
        case 'package':
          return writeServices([...serviceRows, { childProductId: c.ref, qty: 1 }]);
        case 'consumption': {
          const row: ConsumptionEdit = {
            itemId: c.ref,
            qtyPerUnit: 1,
            note: null,
            choicePath: null,
          };
          return writeConsumption(
            t.kind === 'or'
              ? addAlternative(consumptionRows, t.itemId, row)
              : [...consumptionRows, { ...row, choicePath: t.kind === 'and' ? t.path : null }],
          );
        }
      }
    });
  }

  function setDefault(group: number, option: number) {
    void run(`g${group}`, () => writeConsumption(makeDefault(consumptionRows, group, option)));
  }

  function setQty(row: Row, input: HTMLInputElement) {
    const n = Number(input.value);
    if (n === row.qty) return;
    // A refused value must not stay on screen looking saved.
    if (!acceptsQty(row.kind, n)) {
      input.value = String(row.qty);
      return;
    }
    void run(row.id, async () => {
      switch (writePathFor(row.kind)) {
        case 'package':
          return writeServices(
            serviceRows.map((r) => (r.childProductId === row.ref ? { ...r, qty: n } : r)),
          );
        case 'consumption':
          return writeConsumption(
            consumptionRows.map((r) => (r.itemId === row.ref ? { ...r, qtyPerUnit: n } : r)),
          );
      }
    });
  }

  function remove(row: Row) {
    void run(row.id, async () => {
      switch (writePathFor(row.kind)) {
        case 'package':
          return writeServices(serviceRows.filter((r) => r.childProductId !== row.ref));
        case 'consumption':
          return writeConsumption(consumptionRows.filter((r) => r.itemId !== row.ref));
      }
    });
  }

  function saveValidity() {
    const days = String(validity ?? '').trim() === '' ? null : Math.floor(Number(validity));
    void run('validity', () => writeServices(serviceRows, days && days > 0 ? days : null));
  }
</script>

{#snippet rowItem(r: Row)}
  <li class="row">
    <Badge variant="semantic" value={kindTone(r.kind)} size="sm">{kindLabel(r.kind)}</Badge>
    <Input
      size="sm"
      class="w-20"
      type="number"
      min="0"
      step="any"
      aria-label={m.pos_catalog_qty_per_unit()}
      value={String(r.qty)}
      disabled={!canEdit}
      onchange={(e: Event) => setQty(r, e.currentTarget as HTMLInputElement)}
    />
    <span class="t-caption unit">{r.kind === 'service' ? m.pos_pkg_sessions_per() : r.detail}</span>
    <span class="name">{r.name}</span>
    {#if r.kind === 'service' && r.detail}<span class="t-caption dim">{r.detail}</span>{/if}
    {#if canEdit}
      <span class="acts">
        {#if r.kind === 'product'}
          <Button
            variant="ghost"
            size="sm"
            title={m.pos_comp_or_hint()}
            aria-label={m.pos_comp_or()}
            onclick={() => openPicker({ kind: 'or', itemId: r.ref })}
          >
            <Split size={iconSizes.xs} aria-hidden="true" />
          </Button>
        {/if}
        <Button
          variant="ghost"
          size="sm"
          title={m.common_remove()}
          aria-label={m.common_remove()}
          loading={saving.includes(r.id)}
          onclick={() => remove(r)}
        >
          <Trash2 size={iconSizes.xs} aria-hidden="true" />
        </Button>
      </span>
    {/if}
  </li>
{/snippet}

{#snippet recipeNodes(list: RecipeNode<ConsumptionEdit>[])}
  {#each list as n (n.kind === 'item' ? n.row.itemId : `g${n.group}`)}
    {#if n.kind === 'item'}
      {@render rowItem(consumptionRow(n.row))}
    {:else}
      <li class="choice">
        <span class="t-caption dim">{m.pos_comp_alternatives()}</span>
        {#each n.options as o, i (o.option)}
          <ul class="rows option">
            <li class="option-head">
              <span class="t-caption dim">{m.pos_comp_option({ n: i + 1 })}</span>
              {#if i === 0}
                <Badge size="sm">{m.pos_comp_default()}</Badge>
              {:else if canEdit}
                <Button
                  variant="ghost"
                  size="sm"
                  loading={saving.includes(`g${n.group}`)}
                  onclick={() => setDefault(n.group, o.option)}
                >
                  <Star size={iconSizes.xs} aria-hidden="true" />
                  <span>{m.pos_comp_make_default()}</span>
                </Button>
              {/if}
              {#if canEdit}
                <span class="acts">
                  <Button
                    variant="ghost"
                    size="sm"
                    title={m.pos_comp_and()}
                    onclick={() => openPicker({ kind: 'and', path: o.path })}
                  >
                    <Plus size={iconSizes.xs} aria-hidden="true" />
                    <span>{m.pos_comp_add_here()}</span>
                  </Button>
                </span>
              {/if}
            </li>
            {@render recipeNodes(o.nodes)}
          </ul>
        {/each}
      </li>
    {/if}
  {/each}
{/snippet}

<div class="comp">
  <p class="t-caption head">
    {m.pos_comp_title()}
    {#if hasServiceChild}<Badge variant="semantic" value="brand" size="sm"
        >{m.pos_catalog_kind_bundle()}</Badge
      >{/if}
  </p>

  {#if loading}
    <Spinner />
  {:else}
    {#if rows.length === 0}
      <p class="t-caption dim">
        {parentKind === 'product' ? m.pos_comp_empty_product() : m.pos_comp_empty_service()}
      </p>
    {:else}
      <ul class="rows">
        {#each rows.filter((r) => r.kind === 'service') as r (r.id)}
          {@render rowItem(r)}
        {/each}
        {@render recipeNodes(recipe)}
      </ul>
    {/if}

    {#if canEdit}
      <div class="add">
        <Button variant="outline" size="sm" onclick={() => openPicker({ kind: 'top' })}>
          <ListFilter size={iconSizes.sm} aria-hidden="true" />
          <span>{m.pos_comp_add()}</span>
        </Button>
        {#if hasServiceChild}
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
              onchange={saveValidity}
            />
          </label>
        {/if}
      </div>
    {/if}
  {/if}
</div>

<Picker
  bind:open={pickerOpen}
  title={m.pos_comp_add()}
  subtitle={parentKind === 'product' ? m.pos_comp_empty_product() : m.pos_comp_empty_service()}
  columns={pickerColumns}
  rows={candidates}
  getRowId={(c) => c.id}
  onPick={add}
  selectionMode="multiple"
  duplicatePolicy="prevent"
  pickedIds={picked}
  storageKey="pos-composition"
/>

<style>
  .comp {
    padding: var(--space-2) var(--space-4);
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .head {
    display: flex;
    align-items: center;
    gap: var(--space-2);
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
  .choice {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    padding: var(--space-2);
    border: 1px dashed var(--color-border);
    border-radius: var(--radius-md);
  }
  .option + .option {
    border-top: 1px solid var(--color-border);
    padding-top: var(--space-1);
  }
  .option-head {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-height: var(--control-height-sm);
  }
  /* Actions share one right-aligned column, so every row's icons line up. */
  .acts {
    margin-left: auto;
    display: flex;
    align-items: center;
    gap: var(--space-1);
  }
  .unit {
    color: var(--color-text-secondary);
    white-space: nowrap;
  }
  .name {
    flex: 1;
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
