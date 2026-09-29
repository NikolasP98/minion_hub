<script lang="ts">
  /**
   * Shared "Overview" record-detail card (spec 2026-09-28 Bundle F): facts +
   * custom properties with per-USER configurable visibility (I5 — org-hidden
   * fields from `/settings/tables` never show, regardless of the user's own
   * toggle). One card, four callers: stock item, CRM contact, POS ticket,
   * finance invoice. Tags (when the entity has them) render last and are
   * never configurable — the caller's `tags` snippet owns its own dt/dd.
   *
   * `tableId` doubles as the org table-config lookup key AND the per-user
   * `recordOverview` preference key. A `tableId` with no `TABLE_BY_ID` entry
   * (e.g. `pos.tickets`, which has no list-page table registration) simply
   * has no org-hidden fields — per-user hiding still works.
   */
  import type { Snippet } from 'svelte';
  import { page } from '$app/state';
  import { Popover, Toggle } from '$lib/components/ui';
  import * as m from '$lib/paraglide/messages';
  import { resolveTable } from '$lib/tables/registry';
  import { tableConfig } from '$lib/tables/config.svelte';
  import { TABLE_BY_ID } from '$lib/tables/defs';
  import { syncPreferenceToServer } from '$lib/state/ui/preference-sync.svelte';
  import { invalidate } from '$lib/navigation';
  import { visibleProperties, toggleHidden, type OverviewProperty } from './overview-prefs';
  import CustomPropertyCell from '$lib/components/data-table/custom-properties/CustomPropertyCell.svelte';
  import { createCustomPropertyValueActions } from '$lib/components/data-table/custom-properties/api';
  import { isCustomPropertyRecordAvailable } from '$lib/components/data-table/custom-properties/value';
  import type {
    CustomPropertyBundle,
    CustomPropertyDefinition,
    CustomPropertyTableId,
    CustomPropertyValueCell,
  } from '$lib/tables/custom-properties';

  export interface OverviewFact {
    key: string;
    label: string;
    value?: string | null;
    render?: Snippet;
  }

  let {
    tableId,
    title,
    facts,
    customProperties,
    recordId,
    invalidateKey,
    tags,
    headerExtra,
  }: {
    tableId: string;
    title: string;
    facts: OverviewFact[];
    /** Only tables in `CUSTOM_PROPERTY_TABLE_IDS` carry these — omit for e.g. pos.tickets. */
    customProperties?: CustomPropertyBundle;
    recordId?: string;
    /** `depends()` key to invalidate after a custom-property save confirms. */
    invalidateKey?: string;
    /** Extra header control rendered before Configure (e.g. the CRM contact
     *  page's edit/forget kebab) — governance's "one link-style action" is
     *  Configure; this is for a pre-existing, unrelated affordance a caller
     *  still needs on the same header row. */
    headerExtra?: Snippet;
    tags?: Snippet;
  } = $props();

  const orgHiddenKeys = $derived.by(() => {
    const def = TABLE_BY_ID.get(tableId);
    if (!def) return new Set<string>();
    const fields = resolveTable(def, tableConfig()).fields;
    return new Set([...fields.entries()].filter(([, f]) => f.hidden === true).map(([k]) => k));
  });

  const recordOverviewPrefs = $derived(
    (
      page.data as {
        preferences?: {
          preferences?: { recordOverview?: Record<string, { hidden?: string[] }> };
        };
      }
    )?.preferences?.preferences?.recordOverview ?? {},
  );
  // svelte-ignore state_referenced_locally -- seeded once from the server bundle
  let userHiddenKeys = $state<string[]>(recordOverviewPrefs[tableId]?.hidden ?? []);
  // Resync when the caller (record) changes under an unkeyed peek/nav.
  $effect(() => {
    userHiddenKeys = recordOverviewPrefs[tableId]?.hidden ?? [];
  });

  const customPropertyDefs = $derived(customProperties?.definitions ?? []);
  const overviewProperties = $derived<OverviewProperty[]>([
    ...facts.map((f) => ({ key: f.key, label: f.label })),
    ...customPropertyDefs.map((d: CustomPropertyDefinition) => ({
      key: `custom:${d.id}`,
      label: d.label,
    })),
  ]);
  const visibleKeys = $derived(
    new Set(
      visibleProperties(overviewProperties, orgHiddenKeys, new Set(userHiddenKeys)).map(
        (p) => p.key,
      ),
    ),
  );
  const configurableProperties = $derived(
    overviewProperties.filter((p) => !orgHiddenKeys.has(p.key)),
  );

  function toggleProp(key: string) {
    userHiddenKeys = toggleHidden(userHiddenKeys, key);
    syncPreferenceToServer('recordOverview', {
      ...recordOverviewPrefs,
      [tableId]: { hidden: userHiddenKeys },
    });
  }

  // ── Custom properties: same read/edit contract the list DataTable's cell
  // uses, so a save here and a save on the list agree on one write path.
  // svelte-ignore state_referenced_locally -- resynced from the prop in the effect below
  let customBundle = $state(customProperties);
  $effect(() => {
    customBundle = customProperties;
  });
  const customValueActions = $derived(
    customProperties
      ? createCustomPropertyValueActions(tableId as CustomPropertyTableId, async () => {
          if (invalidateKey) await invalidate(invalidateKey);
        })
      : null,
  );
  const customUnavailable = $derived(
    !customBundle || !recordId || !isCustomPropertyRecordAvailable(customBundle, recordId),
  );
  const customCanEdit = $derived(
    !!customBundle?.canEdit &&
      !!recordId &&
      (customBundle.recordAccess[recordId]?.canEdit ?? false),
  );
  function customCellFor(definition: CustomPropertyDefinition): CustomPropertyValueCell {
    const existing = recordId ? customBundle?.values[recordId]?.[definition.id] : undefined;
    return (
      existing ?? {
        propertyId: definition.id,
        recordId: recordId ?? '',
        present: false,
        value: null,
        effectiveValue: definition.hasDefault ? definition.defaultValue : null,
        version: 0,
        updatedAt: null,
      }
    );
  }
  function confirmCustomCell(cell: CustomPropertyValueCell) {
    if (!customBundle || !recordId) return;
    customBundle = {
      ...customBundle,
      values: {
        ...customBundle.values,
        [recordId]: { ...customBundle.values[recordId], [cell.propertyId]: cell },
      },
    };
  }
</script>

<div class="card">
  <div class="card-h flex items-center justify-between gap-2">
    <span>{title}</span>
    <div class="flex items-center gap-3">
      {#if headerExtra}{@render headerExtra()}{/if}
      <Popover placement="bottom-end">
        {#snippet trigger()}<span class="link-action">{m.common_configure()}</span>{/snippet}
        {#snippet children()}
          <div class="configure-list">
            {#each configurableProperties as p (p.key)}
              <Toggle
                size="sm"
                checked={!userHiddenKeys.includes(p.key)}
                label={p.label}
                onchange={() => toggleProp(p.key)}
              />
            {/each}
          </div>
        {/snippet}
      </Popover>
    </div>
  </div>
  <dl class="meta-grid">
    {#each facts as f (f.key)}
      {#if visibleKeys.has(f.key)}
        <dt>{f.label}</dt>
        <dd>
          {#if f.render}{@render f.render()}{:else}{f.value ?? '—'}{/if}
        </dd>
      {/if}
    {/each}
    {#each customPropertyDefs as definition (definition.id)}
      {#if visibleKeys.has(`custom:${definition.id}`)}
        <dt>{definition.label}</dt>
        <dd>
          <CustomPropertyCell
            {definition}
            cell={customCellFor(definition)}
            recordId={recordId ?? ''}
            unavailable={customUnavailable}
            canEdit={customCanEdit}
            actions={customValueActions!}
            onconfirmed={confirmCustomCell}
          />
        </dd>
      {/if}
    {/each}
    {#if tags}
      {@render tags()}
    {/if}
  </dl>
</div>

<style>
  .card {
    border: 1px solid var(--hairline);
    border-radius: var(--radius-lg);
    background: var(--color-card);
    padding: var(--space-3) var(--space-4);
  }
  .card-h {
    font-size: var(--font-size-body);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    color: var(--color-muted-foreground);
    margin-bottom: var(--space-3);
  }
  .meta-grid {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: var(--space-2) var(--space-4);
    font-size: var(--font-size-body);
  }
  .meta-grid dt {
    color: var(--color-muted-foreground);
  }
  /* Card-header link-style action (governance detail-card header contract):
     collapsed to inline text, no button chrome. Zag wraps the trigger
     snippet in its own native button element, so this is a plain span, not
     a nested Button. */
  .link-action {
    color: var(--color-accent);
    font-size: var(--font-size-caption);
    font-weight: var(--font-weight-medium);
  }
  .configure-list {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    min-width: 12rem;
    max-height: 20rem;
    overflow-y: auto;
  }
</style>
