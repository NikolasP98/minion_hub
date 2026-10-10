<script lang="ts">
  /**
   * The org's custom columns on ONE booking, as a section any booking surface
   * mounts (HC-019): the detail drawer renders rows with the same
   * `CustomPropertyCell` editor the calendar Table uses; the bookings list
   * renders the read-only `summary` line on each card. Truth comes only from
   * the shared store — definitions, value, per-record edit right — so a value
   * saved here is what the grid, table and board show next, and a restricted
   * persona gets neither an enabled editor nor a value the server withheld.
   * Empty-and-hidden while there are no active definitions, when the
   * definitions call was refused (`failed`), or until this booking's values
   * arrived — the host decides when to `ensure([bookingId])`.
   */
  import CustomPropertyCell from '$lib/components/data-table/custom-properties/CustomPropertyCell.svelte';
  import type { CustomPropertyValueActions } from '$lib/components/data-table/custom-properties/types';
  import {
    customPropertyDisplay,
    isCustomPropertyRecordAvailable,
  } from '$lib/components/data-table/custom-properties/value';
  import * as m from '$lib/paraglide/messages';
  import { languageTag } from '$lib/paraglide/runtime';
  import type {
    CustomPropertyDefinition,
    CustomPropertyValue,
    CustomPropertyValueCell,
  } from '$lib/tables/custom-properties';
  import type { BookingCustomValues } from './kit/booking-custom-values.svelte';

  let {
    customValues,
    bookingId,
    summary = false,
  }: {
    customValues: BookingCustomValues;
    bookingId: string;
    /** One read-only caption line (`Label: value · …`) instead of fact rows. */
    summary?: boolean;
  } = $props();

  const bundle = $derived(customValues.bundle());
  const defs = $derived(customValues.failed ? [] : bundle.definitions);
  const loaded = $derived(isCustomPropertyRecordAvailable(bundle, bookingId));
  // The same gate DataTable applies to its custom cells.
  const canEdit = $derived(bundle.canEdit && (bundle.recordAccess[bookingId]?.canEdit ?? false));

  function cellFor(def: CustomPropertyDefinition): CustomPropertyValueCell {
    return (
      bundle.values[bookingId]?.[def.id] ?? {
        propertyId: def.id,
        recordId: bookingId,
        present: false,
        value: null,
        effectiveValue: def.hasDefault ? def.defaultValue : null,
        version: 0,
        updatedAt: null,
      }
    );
  }
  const display = (def: CustomPropertyDefinition) =>
    customPropertyDisplay(def, cellFor(def).effectiveValue, languageTag(), {
      yes: m.common_yes(),
      no: m.common_no(),
    });
  const summaryItems = $derived(
    defs.map((def) => ({ def, value: display(def) })).filter((item) => item.value),
  );

  const same = (a: CustomPropertyValue, b: CustomPropertyValue) =>
    JSON.stringify(a) === JSON.stringify(b);
  /** Saves go through the store's `apply` (one write, optimistic on every
   *  mounted view, re-read on refusal). `apply` reports no outcome yet
   *  (HC-011F), so a refused write is detected the way the cell itself does
   *  after a failed PUT: the authoritative value differs from the one asked
   *  for — which sends the cell into its own failed/retry state. */
  const actions: CustomPropertyValueActions = {
    async save(def, recordId, value) {
      await customValues.apply(def, [recordId], value);
      const cell = customValues.values[recordId]?.[def.id];
      if (!cell || !same(cell.value, value)) throw new Error('custom_value_not_saved');
      return { cell, refreshFailed: false };
    },
    async read(propertyId, recordId) {
      await customValues.refetch([recordId]);
      return customValues.values[recordId]?.[propertyId] ?? null;
    },
  };
</script>

{#if defs.length && loaded}
  {#if summary}
    {#if summaryItems.length}
      <span class="bcf-summary t-caption">
        {#each summaryItems as item (item.def.id)}
          <span class="bcf-item"><span class="bcf-label">{item.def.label}:</span> {item.value}</span
          >
        {/each}
      </span>
    {/if}
  {:else}
    <dl class="bcf-facts">
      {#each defs as def (def.id)}
        <dt class="t-caption">{def.label}</dt>
        <dd>
          <CustomPropertyCell
            definition={def}
            cell={cellFor(def)}
            recordId={bookingId}
            {canEdit}
            {actions}
            onconfirmed={() => {}}
          />
        </dd>
      {/each}
    </dl>
  {/if}
{/if}

<style>
  .bcf-facts {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: var(--space-1) var(--space-3);
    margin: 0;
  }
  .bcf-facts dt {
    color: var(--color-text-tertiary);
  }
  .bcf-facts dd {
    margin: 0;
    min-width: 0;
  }
  .bcf-summary {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1) var(--space-3);
    color: var(--color-text-secondary);
  }
  .bcf-label {
    color: var(--color-text-tertiary);
  }
</style>
