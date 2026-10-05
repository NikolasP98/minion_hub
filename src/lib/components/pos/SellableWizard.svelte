<script lang="ts">
  import * as m from '$lib/paraglide/messages';
  import { Plus, Trash2 } from 'lucide-svelte';
  import { Modal, Button, SegmentedControl, Input, Select, Combobox } from '$lib/components/ui';
  import StockItemPicker from '$lib/components/stock/StockItemPicker.svelte';
  import type { StockItemOption } from '$lib/components/stock/StockItemCreateForm.svelte';
  import TagsField from '$lib/components/tags/TagsField.svelte';
  import TagChip from '$lib/components/tags/TagChip.svelte';
  import type { CalTag } from '$lib/components/scheduling/calendar/types';
  import { toastError, toastSuccess, toastWarning } from '$lib/state/ui/toast.svelte';
  import { registerForm } from '$lib/assistant/forms';
  import { fuzzyFind } from '$lib/assistant/fuzzy';
  import { SELLABLE_FORM } from '$lib/assistant/catalog';
  import type { SaveStatus } from '$lib/records/save-status.svelte';
  import { tryUseActions } from '$lib/services/actions/context';
  import {
    requireOk,
    runCompoundMutation,
    runTrackedCommand,
  } from '$lib/services/actions/mutations';
  import {
    CODE_MAX,
    CODE_PATTERN,
    codeError,
    normalizeCode,
    uniqueCodeFrom,
    type CodeError,
  } from '$lib/catalog/code';

  // Narrow local shapes (mirrors server types) — avoids importing $server/*
  // runtime modules into a client component (same convention as ShiftBanner.svelte).
  export interface StockItemLike {
    id: string;
    code: string;
    name: string;
    uom: string;
    /** Set ⇒ already published as a sellable, so it can't be published again
     *  (enforced by the stk_items_org_fin_product_uniq partial index). */
    finProductId?: string | null;
    /** Consumption-side unit, when different from the stock uom (e.g. stock
     *  in boxes, consumed in units) — same field the /api/stock/consumption
     *  mapping reads. */
    consumptionUom?: string | null;
  }
  export interface ConsumptionLike {
    finProductId: string;
    itemId: string;
    qtyPerUnit: number;
    note?: string | null;
  }
  export interface SellableLike {
    productId: string;
    code: string;
    name: string;
    category: string | null;
    unitPrice: number | null;
    active: boolean;
    /** Mirrors SellableRow.kind. The wizard does not CREATE bundles (that is
     *  the bundle editor's job); it must merely not choke on editing one. */
    kind: 'product' | 'service' | 'bundle';
    itemId: string | null;
    /** Tag ids currently applied to this sellable (edit mode prefill). */
    tags?: string[];
  }

  interface Props {
    /** Bindable open state. */
    open?: boolean;
    /** Modal for legacy callers; page renders the same editor inline. */
    presentation?: 'modal' | 'page';
    stockEnabled: boolean;
    stockItems: StockItemLike[];
    /** Existing categories across the catalog — feeds the free-entry datalist. */
    categories: string[];
    /** Every code already in use, so the auto-suggestion never proposes a
     *  collision the server would then reject with `code_taken`. */
    takenCodes?: string[];
    /** Existing consumption mappings across the catalog — filtered to the
     *  edited product for prefill (see ★ note below). */
    consumption: ConsumptionLike[];
    /** Catalog-scope manual tags. */
    allTags?: CalTag[];
    /** Stock tags inherited from the recipe's ingredients / consumed items (read-only). */
    inheritedTags?: CalTag[];
    /** null = create mode; a row = edit mode, prefilled from it. */
    editing?: SellableLike | null;
    /** Called after a successful save — caller invalidates or navigates. */
    onSaved: () => void | Promise<void>;
    onCancel?: () => void;
    /** Edit mode only: drives the title-bar save indicator and serializes
     *  autosave requests. Omit in create mode (Save/Cancel path ignores it). */
    saveStatus?: SaveStatus;
  }

  let {
    open = $bindable(false),
    presentation = 'modal',
    stockEnabled,
    stockItems,
    categories,
    takenCodes = [],
    consumption,
    allTags = [],
    inheritedTags = [],
    editing = null,
    onSaved,
    onCancel,
    saveStatus,
  }: Props = $props();

  const visible = $derived(presentation === 'page' || open);

  // Code format is now ONE shared rail ($lib/catalog/code.ts), imported by both
  // this component and pos.service.ts. It used to be a hand-copied mirror of the
  // server's slugifyCode, and the two had drifted — which is how `CMSVP` and
  // `CM-SVP` both ended up in the catalog as separate products.
  const CODE_ERR_MSG: Record<CodeError, () => string> = {
    empty: m.catalog_code_err_empty,
    too_short: m.catalog_code_err_too_short,
    too_long: m.catalog_code_err_too_long,
    charset: m.catalog_code_err_charset,
  };

  let name = $state('');
  let code = $state('');
  let codeTouched = $state(false);
  let category = $state('');
  let unitPrice = $state('');
  /**
   * What backs this sellable. Replaces the old kind+trackStock pair:
   *   service       → no stock item at all
   *   new-item      → create a fresh tracked stk_item (was kind=product+trackStock)
   *   existing-item → publish an EXISTING raw material (task #10)
   * `kind` is derived from it — the server derives it again from the item link.
   */
  type Source = 'service' | 'new-item' | 'existing-item';
  let source = $state<Source>('service');
  let existingItemId = $state('');
  let existingItemPickerOpen = $state(false);
  let consumptionPickerOpen = $state(false);
  let createdStockItems = $state<StockItemLike[]>([]);
  let uom = $state('unit');
  const kind = $derived<'product' | 'service'>(source === 'service' ? 'service' : 'product');
  const allStockItems = $derived([...createdStockItems, ...stockItems]);
  /** Only items not already published can be linked. */
  const availableItems = $derived(allStockItems.filter((i) => !i.finProductId));
  let rows = $state<{ itemId: string; qtyPerUnit: string; note: string }[]>([]);
  let tagIds = $state<string[]>([]);
  let busy = $state(false);
  const actions = tryUseActions();
  let tagRepair = $state<{ productId: string; tagIds: string[] } | null>(null);
  let primaryUnknown = $state(false);
  let repairScopeVersion = actions?.scopeVersion;
  let repairOwnerKey: string | null | undefined;

  $effect(() => {
    const scopeVersion = actions?.scopeVersion;
    if (scopeVersion === repairScopeVersion) return;
    repairScopeVersion = scopeVersion;
    tagRepair = null;
    primaryUnknown = false;
    busy = false;
  });

  $effect(() => {
    const ownerKey = visible ? (editing?.productId ?? 'create') : null;
    if (ownerKey === repairOwnerKey) return;
    repairOwnerKey = ownerKey;
    tagRepair = null;
    primaryUnknown = false;
    busy = false;
  });

  /** Label a row's qty input with the CONSUMPTION uom when the item has one,
   *  falling back to its stock uom. Boxes on the shelf, units on the ticket. */
  function unitLabel(itemId: string): string {
    const item = allStockItems.find((i) => i.id === itemId);
    return item?.consumptionUom ?? item?.uom ?? '';
  }

  // Seed (or reset) the form whenever the wizard opens, from `editing` when
  // present. ★ Prefill for consumption mappings comes from the page's own
  // `consumption` list (already loaded org-wide by the catalog page) —
  // trivially available here, so edit mode filters it by productId rather
  // than starting empty.
  $effect(() => {
    if (!visible) return;
    const e = editing;
    name = e?.name ?? '';
    code = e?.code ?? '';
    codeTouched = !!e; // edit mode: never auto-overwrite an existing code
    category = e?.category ?? '';
    unitPrice = e?.unitPrice != null ? String(e.unitPrice) : '';
    // `source` is creation-only (hidden in edit mode), so edit just resets it.
    source = 'service';
    existingItemId = '';
    uom = (e?.itemId ? stockItems.find((i) => i.id === e.itemId)?.uom : undefined) ?? 'unit';
    rows = e
      ? consumption
          .filter((c) => c.finProductId === e.productId)
          .map((c) => ({ itemId: c.itemId, qtyPerUnit: String(c.qtyPerUnit), note: c.note ?? '' }))
      : [];
    tagIds = e?.tags ?? [];
  });

  // Auto-suggest the code from the name until the user edits it manually.
  $effect(() => {
    if (codeTouched) return;
    code = uniqueCodeFrom(name, takenCodes);
  });

  // Blank while the user is still typing the first character — an "at least 2
  // characters" error on an empty field the user just opened is noise, not help.
  const codeErr = $derived(codeTouched && code !== '' ? codeError(code) : null);

  function usedElsewhere(idx: number): Set<string> {
    return new Set(rows.filter((_, i) => i !== idx).map((r) => r.itemId));
  }
  function optionsFor(idx: number): StockItemLike[] {
    const used = usedElsewhere(idx);
    return allStockItems.filter((i) => !used.has(i.id));
  }
  const pickedConsumptionIds = $derived(new Set(rows.map((row) => row.itemId)));

  function rememberCreatedItem(item: StockItemOption): StockItemLike {
    const stockItem: StockItemLike = item;
    if (!allStockItems.some((candidate) => candidate.id === item.id)) {
      createdStockItems = [stockItem, ...createdStockItems];
    }
    return stockItem;
  }

  function pickExistingItem(item: StockItemOption) {
    existingItemId = rememberCreatedItem(item).id;
  }

  function addRow(item: StockItemOption) {
    const remembered = rememberCreatedItem(item);
    if (rows.some((row) => row.itemId === remembered.id)) return;
    rows = [...rows, { itemId: remembered.id, qtyPerUnit: '', note: '' }];
    autosaveConsumption();
  }
  function removeRow(idx: number) {
    rows = rows.filter((_, i) => i !== idx);
    autosaveConsumption();
  }
  /** Unpicking from inside the picker removes the matching consumption row, so
      the picker's checkmarks and the form's row list stay one shared truth. */
  function removeRowByItem(item: StockItemOption) {
    rows = rows.filter((row) => row.itemId !== item.id);
    autosaveConsumption();
  }

  const canSubmit = $derived(
    !busy &&
      !primaryUnknown &&
      (tagRepair !== null ||
        (name.trim() !== '' &&
          // Format is a hard gate, not a warning: a malformed code that reaches the
          // server becomes a permanent business key (see $lib/catalog/code.ts).
          codeError(code) === null &&
          // publishing an existing item requires one to be picked
          !(!editing && source === 'existing-item' && !existingItemId))),
  );

  // Assistant `fill_sellable` tool — create mode only (edit locks source/kind).
  // Writes the same $state the inputs bind to; the user still presses Save.
  $effect(() => {
    if (!visible || editing) return;
    const str = (x: unknown) => (x == null ? '' : String(x));
    return registerForm({
      def: SELLABLE_FORM,
      get: () => ({ name, code, category, unitPrice, source, existingItem: existingItemId }),
      set: (v) => {
        const filled: string[] = [];
        const rejected: { key: string; reason: string }[] = [];
        if ('name' in v) {
          name = str(v.name);
          filled.push('name');
        }
        if ('code' in v) {
          const next = normalizeCode(str(v.code));
          const err = codeError(next);
          if (err) rejected.push({ key: 'code', reason: CODE_ERR_MSG[err]() });
          else {
            codeTouched = true;
            code = next;
            filled.push('code');
          }
        }
        if ('category' in v) {
          category = str(v.category);
          filled.push('category');
        }
        if ('unitPrice' in v) {
          unitPrice = str(v.unitPrice);
          filled.push('unitPrice');
        }
        // `source` lands before `existingItem`: the picker only exists once
        // source is existing-item.
        if ('source' in v) {
          const s = str(v.source) as Source;
          if (s === 'service' || (stockEnabled && (s === 'new-item' || s === 'existing-item'))) {
            source = s;
            filled.push('source');
          } else {
            rejected.push({
              key: 'source',
              reason: stockEnabled
                ? `unknown source "${s}"`
                : 'stock module disabled — only "service" is available',
            });
          }
        }
        let note: string | undefined;
        if ('existingItem' in v) {
          const typed = str(v.existingItem).trim();
          const { match, candidates } = fuzzyFind(
            typed,
            stockEnabled ? availableItems : [],
            (i) => [i.code, i.name],
          );
          if (match) {
            source = 'existing-item';
            existingItemId = match.id;
            filled.push('existingItem');
            if (typed.toLowerCase() !== match.name.toLowerCase())
              note = `matched "${typed}" → "${match.name}"`;
          } else {
            rejected.push({
              key: 'existingItem',
              reason: `no unlinked stock item matches "${typed}"; did you mean: ${candidates.map((i) => `${i.code} — ${i.name}`).join(', ') || 'none'}`,
            });
          }
        }
        return { filled, rejected, note };
      },
    });
  });

  function cancel() {
    if (presentation === 'modal') open = false;
    onCancel?.();
  }

  // ── Networking (shared by the create/modal Save path and edit-mode autosave) ──

  async function throwIfNotOk(res: Response): Promise<void> {
    if (res.ok) return;
    const d = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
    throw new Error(
      d.code === 'code_taken' ? m.pos_catalog_code_taken() : (d.error ?? `Failed (${res.status})`),
    );
  }

  async function createSellable(
    payload: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<string> {
    const res = await fetch('/api/pos/sellables', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal,
    });
    await throwIfNotOk(res);
    const { sellable } = (await res.json()) as { sellable: { productId: string } };
    return sellable.productId;
  }

  async function saveSellable(
    productId: string,
    patch: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<void> {
    const res = await fetch(`/api/pos/sellables/${productId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(patch),
      signal,
    });
    await throwIfNotOk(res);
  }

  async function saveTags(productId: string, ids: string[], signal?: AbortSignal): Promise<void> {
    const response = await fetch(`/api/tags/product/${productId}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tagIds: ids }),
      signal,
    });
    await requireOk(response, m.data_table_bulk_tags_failed());
  }

  // ★ note MUST ride along: this is a replace-set (updateSellable deletes rows
  // missing from this array and setConsumption upserts the rest), so omitting
  // note here would silently blank it on every save.
  function consumptionPayload() {
    return rows
      .filter((r) => r.itemId && Number(r.qtyPerUnit) > 0)
      .map((r) => ({
        itemId: r.itemId,
        qtyPerUnit: Number(r.qtyPerUnit),
        note: r.note.trim() || null,
      }));
  }

  // ── Edit-mode autosave (no Save button — see SellableEditorPage) ──────────
  // Native `change` (not `input`) already only fires on blur-if-dirty for text
  // inputs, which is exactly "on blur/change if dirty" — so one handler serves
  // both the text-field and the "immediately on change" fields below.

  function autosaveField(key: 'code' | 'category' | 'unitPrice', raw: string | number | null) {
    // A `type="number"` Input binds a number; normalise before trimming.
    const value = raw == null ? '' : String(raw);
    if (!editing || !saveStatus) return;
    if (key === 'code' && codeError(value)) return; // invalid — inline error shows, no save
    const patch =
      key === 'unitPrice'
        ? { unitPrice: value.trim() === '' ? null : Number(value) }
        : key === 'category'
          ? { category: value.trim() || null }
          : { code: value.trim() };
    const productId = editing.productId;
    void saveStatus.run(() => saveSellable(productId, patch));
  }

  function autosaveConsumption() {
    if (!editing || !saveStatus) return;
    const productId = editing.productId;
    void saveStatus.run(() => saveSellable(productId, { consumption: consumptionPayload() }));
  }

  function autosaveTags(ids: string[]) {
    if (!editing || !saveStatus) return;
    void saveStatus.run(() => saveTags(editing!.productId, ids));
  }

  async function submit() {
    if (!canSubmit) return;
    busy = true;
    const scopeVersion = actions?.scopeVersion;
    try {
      const repair = tagRepair;
      const tagSnapshot = repair?.tagIds ?? [...tagIds];
      // `unitPrice` binds a `type="number"` input (see the Price field below).
      // Svelte coerces a bound value to a JS `number` on any native
      // number/range input once the user edits it, regardless of the
      // `$state('')` string seed — `autosaveField` below already guards the
      // same coercion for the edit-mode path via `String(raw)`; this
      // create/submit path needs the identical guard, or `.trim()` throws
      // `TypeError: unitPrice.trim is not a function` on a plain number.
      // Building the payload inside this try also means that throw (or any
      // other one here) still reaches `finally { busy = false }` instead of
      // leaving Save permanently disabled forever (canSubmit depends on
      // `!busy`) with no request ever sent — which is exactly what silently
      // "froze" /pos/catalog/new for a real user (2026-09-30 owner report).
      const priceStr = String(unitPrice);
      const payload: Record<string, unknown> = repair
        ? {}
        : {
            name: name.trim(),
            code: code.trim(),
            category: category.trim() || null,
            unitPrice: priceStr.trim() === '' ? null : Number(priceStr),
          };
      // kind/trackStock/uom/itemId are creation-only — updateSellable ignores
      // them on PATCH.
      if (!repair && !editing) {
        payload.kind = kind;
        if (stockEnabled) {
          if (source === 'new-item') {
            payload.trackStock = true;
            payload.uom = uom.trim() || 'unit';
          } else if (source === 'existing-item') {
            payload.itemId = existingItemId;
          }
        }
      }
      // Recipes are NOT service-only: a product-kind sellable may carry one too
      // (resolveIssueLines gives an authored recipe precedence over the 1:1
      // bridge). createSellable/updateSellable already accepted this for any
      // kind — only this form was gating it.
      if (!repair && stockEnabled) payload.consumption = consumptionPayload();

      const outcome = await runTrackedCommand(actions, 'pos.sellable.save', (context) =>
        runCompoundMutation({
          context,
          committed: repair?.productId,
          primaryAttemptId: 'pos.sellable.save.primary',
          primary: async (signal) => {
            const productId = editing ? editing.productId : await createSellable(payload, signal);
            if (editing) await saveSellable(productId, payload, signal);
            return productId;
          },
          followupAttemptId: 'pos.sellable.save.tags',
          followup: (productId, signal) => saveTags(productId, tagSnapshot, signal),
          onPrimaryCommitted: (productId) => {
            tagRepair = { productId, tagIds: tagSnapshot };
          },
          onFollowupCommitted: () => {
            tagRepair = null;
            primaryUnknown = false;
            if (presentation === 'modal') open = false;
          },
          refresh: async () => onSaved(),
          refreshAttemptId: 'pos.sellable.save.callback',
        }),
      );
      if (actions && actions.scopeVersion !== scopeVersion) return;
      if (outcome.status === 'succeeded') toastSuccess(m.common_save());
      else if (outcome.status === 'committed-refreshing') toastWarning(m.asyncAction_refreshing());
      else if (outcome.status === 'partial') toastWarning(m.asyncAction_partial());
      else if (outcome.status === 'unknown') {
        if (!tagRepair) primaryUnknown = true;
        toastError(m.asyncAction_unknown());
      } else
        toastError(
          m.data_table_save_failed(),
          outcome.error instanceof Error ? outcome.error.message : undefined,
        );
    } catch (error) {
      if (!actions || actions.scopeVersion === scopeVersion)
        toastError(
          m.data_table_save_failed(),
          error instanceof Error ? error.message : String(error),
        );
    } finally {
      if (!actions || actions.scopeVersion === scopeVersion) busy = false;
    }
  }
</script>

{#snippet nameField()}
  <Input size="sm" label={m.stock_field_name()} bind:value={name} data-assist="sellable.name" />
{/snippet}

{#snippet detailsRest()}
  <Input
    size="sm"
    inputClass="font-mono uppercase"
    label={m.stock_field_code()}
    helper={m.catalog_code_helper()}
    data-assist="sellable.code"
    error={codeErr ? CODE_ERR_MSG[codeErr]() : undefined}
    value={code}
    maxlength={CODE_MAX}
    pattern={CODE_PATTERN}
    autocapitalize="characters"
    spellcheck="false"
    oninput={(e) => {
      codeTouched = true;
      // Normalize in place so a pasted "CM-SVP" visibly becomes "CMSV"
      // instead of being silently rejected only on submit. Writing back to
      // the DOM value keeps the caret sane when nothing was stripped.
      const el = e.currentTarget as HTMLInputElement;
      code = normalizeCode(el.value);
      if (el.value !== code) el.value = code;
    }}
    onchange={(e: Event) => autosaveField('code', (e.currentTarget as HTMLInputElement).value)}
  />
  <Input
    size="sm"
    label={m.fin_col_category()}
    list="pos-catalog-categories"
    data-assist="sellable.category"
    bind:value={category}
    onchange={() => autosaveField('category', category)}
  />
  <datalist id="pos-catalog-categories">
    {#each categories as c (c)}<option value={c}></option>{/each}
  </datalist>
  <Input
    size="sm"
    type="number"
    min="0"
    step="0.01"
    label={m.pos_sell_price()}
    bind:value={unitPrice}
    data-assist="sellable.unitPrice"
    onchange={() => autosaveField('unitPrice', unitPrice)}
  />

  <div class="fld">
    <span>{m.tags_label()}</span>
    <TagsField scope="catalog" {allTags} bind:value={tagIds} onchange={autosaveTags} />
    {#if inheritedTags.length}
      <p class="t-caption">{m.tags_from_ingredients()}</p>
      <div class="inherited">
        {#each inheritedTags as t (t.id)}
          <TagChip size="sm" name={t.name} color={t.color} dashed origin="ingredient" />
        {/each}
      </div>
    {/if}
  </div>

  {#if editing}
    <!-- updateSellable ignores kind/trackStock/uom on PATCH — showing live
         controls here would silently no-op, so they're creation-only. -->
    <p class="t-caption">{m.pos_catalog_kind_locked()}</p>
  {:else}
    <div class="fld" data-assist="sellable.source">
      <span>{m.pos_catalog_source()}</span>
      <SegmentedControl
        aria-label={m.pos_catalog_source()}
        bind:value={source}
        items={[
          { value: 'service', label: m.pos_catalog_kind_service() },
          ...(stockEnabled
            ? [
                { value: 'new-item', label: m.pos_catalog_source_new_item() },
                {
                  value: 'existing-item',
                  label: m.pos_catalog_source_existing_item(),
                  disabled: availableItems.length === 0,
                  title:
                    availableItems.length === 0 ? m.pos_catalog_no_unlinked_items() : undefined,
                },
              ]
            : []),
        ]}
      />
    </div>

    {#if source === 'new-item' && stockEnabled}
      <Input size="sm" label={m.stock_field_uom()} bind:value={uom} />
    {:else if source === 'existing-item' && stockEnabled}
      <label class="fld">
        <span>{m.pos_catalog_pick_item()}</span>
        <Button
          variant="outline"
          size="sm"
          class="wizard-item-picker"
          data-assist="sellable.existingItem"
          onclick={() => (existingItemPickerOpen = true)}
        >
          {existingItemId
            ? `${allStockItems.find((item) => item.id === existingItemId)?.code ?? ''} — ${
                allStockItems.find((item) => item.id === existingItemId)?.name ?? existingItemId
              }`
            : m.pos_catalog_pick_item()}
        </Button>
      </label>
    {/if}
  {/if}
{/snippet}

{#snippet consumptionBlock()}
  {#if stockEnabled}
    <!-- TODO(handoff): other consumption-mapping surfaces (e.g.
         /stock/items/[id]/+page.svelte, /pos/appointments/+page.svelte)
         render a ConsumptionGauge per row for items with diagramEnabled
         (subunit-shape visual qty picker,
         $lib/components/stock/ConsumptionGauge.svelte + gaugeMax() from
         stock-ui.ts) — not ported here to keep this slice scoped. Wire it
         the same way those pages do, keyed off
         stockItems.find(i => i.id === row.itemId)?.diagramEnabled, when
         this wizard gets its next pass. -->
    <div class="fld">
      <span>{m.pos_catalog_consumption()}</span>
      <div class="consumption-rows">
        {#each rows as row, idx (idx)}
          <div class="consumption-row">
            <div class="cb-wrap">
              <Combobox
                id={`sellable-consumption-${idx}`}
                items={optionsFor(idx)}
                itemToValue={(item) => item.id}
                itemToString={(item) => `${item.code} — ${item.name}`}
                placeholder={m.stock_field_item()}
                bind:value={row.itemId}
                onValueChange={() => autosaveConsumption()}
              />
            </div>
            <Input
              size="sm"
              class="w-24"
              type="number"
              min="0"
              step="0.01"
              placeholder={`${m.pos_catalog_qty_per_unit()} (${unitLabel(row.itemId)})`}
              bind:value={row.qtyPerUnit}
              onchange={() => autosaveConsumption()}
            />
            <Input
              size="sm"
              class="flex-1"
              placeholder={m.stock_field_note()}
              bind:value={row.note}
              onchange={() => autosaveConsumption()}
            />
            <Button
              type="button"
              class="act-btn"
              onclick={() => removeRow(idx)}
              aria-label={m.common_remove()}><Trash2 size={12} /></Button
            >
          </div>
        {/each}
        <Button
          variant="outline"
          size="sm"
          onclick={() => (consumptionPickerOpen = true)}
          disabled={rows.length >= allStockItems.length}
        >
          <Plus size={13} />
          {m.common_add()}
        </Button>
      </div>
    </div>
  {/if}
{/snippet}

{#if presentation === 'modal'}
  <Modal bind:open title={editing ? m.pos_catalog_edit() : m.pos_catalog_new()}>
    <div class="flex flex-col gap-3">
      <!-- TODO(handoff): modal presentation has no consumer today (page
           presentation is the only one SellableEditorPage uses) — editing
           via modal still shows Name + Save/Cancel rather than the
           inline-title/autosave flow below. Port it the same way if a modal
           caller returns. -->
      {#if !editing}{@render nameField()}{/if}
      {@render detailsRest()}
      {@render consumptionBlock()}
    </div>
    {#snippet footer()}
      <Button variant="outline" size="sm" onclick={cancel}>{m.common_cancel()}</Button>
      <Button
        variant="primary"
        size="sm"
        onclick={submit}
        disabled={!canSubmit}
        data-assist="sellable.submit">{tagRepair ? m.asyncAction_retry() : m.common_save()}</Button
      >
    {/snippet}
  </Modal>
{:else if editing}
  <!-- Edit + page: flat sections (no Card, no Save/Cancel — every field
       autosaves on blur/change; see SellableEditorPage for the title-bar
       save indicator and the inline-editable name in the header). -->
  <section class="edit-section">
    {@render detailsRest()}
  </section>
  {#if stockEnabled}
    <section class="edit-section edit-section--divider">
      {@render consumptionBlock()}
    </section>
  {/if}
{:else}
  <form
    class="sellable-editor"
    onsubmit={(event) => {
      event.preventDefault();
      void submit();
    }}
  >
    {@render nameField()}
    {@render detailsRest()}
    {@render consumptionBlock()}
    <div class="editor-actions">
      <Button type="button" variant="outline" size="sm" onclick={cancel}>{m.common_cancel()}</Button
      >
      <Button
        type="submit"
        variant="primary"
        size="sm"
        disabled={!canSubmit}
        data-assist="sellable.submit">{tagRepair ? m.asyncAction_retry() : m.common_save()}</Button
      >
    </div>
  </form>
{/if}

<StockItemPicker
  bind:open={existingItemPickerOpen}
  items={availableItems}
  title={m.pos_catalog_pick_item()}
  onPick={pickExistingItem}
  selectionMode="single"
  duplicatePolicy="prevent"
  storageKey="sellable-existing-stock-item"
/>

<StockItemPicker
  bind:open={consumptionPickerOpen}
  items={allStockItems}
  title={m.pos_catalog_consumption()}
  onPick={addRow}
  onUnpick={removeRowByItem}
  selectionMode="multiple"
  duplicatePolicy="prevent"
  pickedIds={pickedConsumptionIds}
  columnsConfigurable
  storageKey="sellable-consumption-items"
/>

<style>
  .inherited {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1);
  }

  .sellable-editor {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
  }
  /* Edit mode drops the Card wrapper (owner: "box within a box") — sections
     separate with a hairline instead, full reading width. */
  .edit-section {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding-block: var(--space-section);
  }
  .edit-section--divider {
    border-top: 1px solid var(--hairline);
  }
  .editor-actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-2);
    padding-top: var(--space-4);
    border-top: 1px solid var(--color-border-subtle);
  }
  /* `.fld` survives only for the two grouping wrappers (consumption rows,
     existing-item picker) that aren't a single Input. */
  .fld {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    font-size: var(--font-size-caption);
    color: var(--color-text-secondary);
  }
  .consumption-rows {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .consumption-row {
    display: flex;
    gap: var(--space-2);
    align-items: center;
  }
  /* Combobox has no `class`/width prop of its own (see $lib/components/ui);
     the flex sizing that used to sit on the Select's fieldClass has to be
     forced onto a wrapper instead. */
  .consumption-row .cb-wrap {
    flex: 1;
    min-width: 0;
  }
  .consumption-row :global(.act-btn) {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.75rem;
    height: 1.75rem;
    border-radius: var(--radius-sm);
    border: 1px solid var(--hairline);
    background: transparent;
    cursor: pointer;
    color: var(--color-muted-foreground);
  }
  .consumption-row :global(.act-btn):hover {
    background: color-mix(in srgb, var(--color-foreground) 6%, transparent);
    color: var(--color-foreground);
  }
  .fld :global(.wizard-item-picker) {
    min-width: 0;
    justify-content: flex-start;
    overflow: hidden;
    text-overflow: ellipsis;
  }
</style>
