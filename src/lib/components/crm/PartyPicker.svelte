<script lang="ts" module>
  export type { PartyOption } from './party-picker';
</script>

<script lang="ts">
  import { onDestroy } from 'svelte';
  import { IdCard, ListFilter, X } from 'lucide-svelte';
  import { canAct } from '$lib/access/can.svelte';
  import { Button, Input, Picker, iconSizes, type PickerColumn } from '$lib/components/ui';
  import * as m from '$lib/paraglide/messages';
  import { createAsyncDebouncer } from '$lib/pacer/index.svelte';
  import PartyCreateForm from './PartyCreateForm.svelte';
  import { creatablePartyTypes, type PartyOption } from './party-picker';

  let {
    value = $bindable(null),
    label = '',
    placeholder = m.party_picker_search(),
    types = undefined,
    initialName = '',
    docLookup = false,
    onPicked,
    allowCreate = true,
    columnsConfigurable = true,
    pickerColumns,
    pickerStorageKey,
  }: {
    value?: string | null;
    label?: string;
    placeholder?: string;
    /** Comma-separated party types to filter, e.g. `person,company`. */
    types?: string | undefined;
    initialName?: string;
    /** Offer DNI/RUC registry autofill for bare 8- or 11-digit queries. */
    docLookup?: boolean;
    onPicked?: (party: PartyOption) => void;
    allowCreate?: boolean;
    columnsConfigurable?: boolean;
    pickerColumns?: PickerColumn<PartyOption>[];
    pickerStorageKey?: string;
  } = $props();

  // svelte-ignore state_referenced_locally -- seed the editable query once from the prop
  let q = $state(initialName);
  let results = $state<PartyOption[]>([]);
  let menuOpen = $state(false);
  let pickerOpen = $state(false);

  const allowedCreateTypes = $derived(creatablePartyTypes(types));
  const canCreate = $derived(
    allowCreate && allowedCreateTypes.length > 0 && canAct('crm', 'create'),
  );
  const pickerKey = $derived(
    pickerStorageKey ?? `party-${(types ?? 'person-company').replaceAll(',', '-')}`,
  );
  const defaultColumns = $derived<PickerColumn<PartyOption>[]>([
    {
      key: 'name',
      label: m.party_picker_name(),
      value: (party) => party.name ?? m.party_picker_unnamed(),
      priority: 10,
      emphasis: 'primary',
      hideable: false,
    },
    {
      key: 'type',
      label: m.party_picker_type(),
      priority: 20,
      defaultHidden: Boolean(types && !types.includes(',')),
    },
    {
      key: 'docNumber',
      label: m.party_picker_document_number(),
      value: (party) => party.docNumber ?? '',
      priority: 30,
    },
    {
      key: 'email',
      label: m.party_picker_email(),
      value: (party) => party.email ?? '',
      priority: 40,
      defaultHidden: true,
    },
  ]);
  const resolvedColumns = $derived(pickerColumns ?? defaultColumns);

  let searchSequence = 0;

  async function loadParties(term: string): Promise<PartyOption[]> {
    const url = new URL('/api/crm/parties', location.origin);
    url.searchParams.set('q', term);
    if (types) url.searchParams.set('type', types);
    const response = await fetch(url);
    if (!response.ok) throw new Error('party search failed');
    return (await response.json()) as PartyOption[];
  }

  const search = createAsyncDebouncer(
    async (term: string) => {
      const sequence = ++searchSequence;
      try {
        const found = await loadParties(term);
        if (sequence !== searchSequence) return;
        results = found;
        menuOpen = true;
      } catch {
        if (sequence === searchSequence) {
          results = [];
          menuOpen = false;
        }
      }
    },
    { wait: 200 },
  );

  onDestroy(() => search.cancel());

  function onInput(event: Event) {
    q = (event.currentTarget as HTMLInputElement).value;
    value = null;
    docErr = null;
    search.run(q);
  }

  function pick(party: PartyOption) {
    value = party.id;
    q = party.name ?? party.email ?? party.id;
    menuOpen = false;
    onPicked?.(party);
  }

  function clear() {
    value = null;
    q = '';
    results = [];
    menuOpen = false;
    docErr = null;
  }

  const docQuery = $derived(docLookup ? q.trim() : '');
  const docKind = $derived(
    /^\d{8}$/.test(docQuery) ? 'dni' : /^\d{11}$/.test(docQuery) ? 'ruc' : null,
  );
  let docBusy = $state(false);
  let docErr = $state<string | null>(null);

  async function lookupDoc() {
    if (!docKind || docBusy) return;
    docBusy = true;
    docErr = null;
    try {
      const response =
        docKind === 'dni'
          ? await fetch('/api/crm/dni-lookup', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ dni: docQuery }),
            })
          : await fetch('/api/crm/ruc-lookup', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ ruc: docQuery }),
            });
      const found = response.ok ? ((await response.json()) as Record<string, unknown>) : null;
      if (!found?.found) {
        docErr = 'not_found';
        return;
      }
      const name = docKind === 'dni' ? String(found.name ?? '') : String(found.legalName ?? '');
      if (!name) {
        docErr = 'not_found';
        return;
      }
      const createResponse = await fetch('/api/crm/parties', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name,
          docType: docKind.toUpperCase(),
          docNumber: docQuery,
          type: docKind === 'ruc' ? 'company' : 'person',
        }),
      });
      if (!createResponse.ok) {
        docErr = 'failed';
        return;
      }
      const created = (await createResponse.json()) as {
        party: { id: string; name: string | null };
      };
      pick({
        id: created.party.id,
        name: created.party.name ?? name,
        type: docKind === 'ruc' ? 'company' : 'person',
        email: null,
        docNumber: docQuery,
      });
    } catch {
      docErr = 'failed';
    } finally {
      docBusy = false;
    }
  }
</script>

{#snippet createPartyForm(context: {
  oncreated: (party: PartyOption) => void;
  oncancel: () => void;
})}
  <PartyCreateForm
    allowedTypes={allowedCreateTypes}
    initialName={q}
    oncreated={context.oncreated}
    oncancel={context.oncancel}
  />
{/snippet}

<div class="party-picker">
  <div class="party-field">
    <Input
      size="sm"
      {label}
      {placeholder}
      inputClass="party-input"
      value={q}
      oninput={onInput}
      onfocus={() => q && search.run(q)}
      onblur={() => setTimeout(() => (menuOpen = false), 150)}
      autocomplete="off"
    />
    <div class="party-controls">
      {#if value || q}
        <Button
          variant="ghost"
          size="xs"
          shape="icon"
          aria-label={m.common_reset()}
          onclick={clear}
        >
          <X size={iconSizes.sm} aria-hidden="true" />
        </Button>
      {/if}
      <Button
        variant="ghost"
        size="xs"
        shape="icon"
        aria-label={m.party_picker_browse()}
        onclick={() => {
          menuOpen = false;
          pickerOpen = true;
        }}
      >
        <ListFilter size={iconSizes.sm} aria-hidden="true" />
      </Button>
    </div>

    {#if menuOpen && (results.length || docKind)}
      <ul class="party-menu">
        {#each results as party (party.id)}
          <li>
            <Button variant="ghost" type="button" onclick={() => pick(party)}>
              <span class="party-name">{party.name ?? m.party_picker_unnamed()}</span>
              <span class="party-meta">
                {party.type}{party.email
                  ? ` · ${party.email}`
                  : party.docNumber
                    ? ` · ${party.docNumber}`
                    : ''}
              </span>
            </Button>
          </li>
        {/each}
        {#if docKind}
          <li>
            <Button
              variant="ghost"
              type="button"
              class="doc-row"
              onclick={lookupDoc}
              disabled={docBusy}
            >
              <span class="party-name doc-name">
                <IdCard size={iconSizes.sm} aria-hidden="true" />
                {docBusy ? m.crm_dni_checking() : m.crm_dni_lookup()}
                {docKind.toUpperCase()}
                {docQuery}
              </span>
              {#if docErr}<span class="party-meta doc-error">{m.crm_dni_error()}</span>{/if}
            </Button>
          </li>
        {/if}
      </ul>
    {/if}
  </div>
</div>

<Picker
  bind:open={pickerOpen}
  title={m.party_picker_browse()}
  columns={resolvedColumns}
  loadRows={loadParties}
  getRowId={(party) => party.id}
  searchText={(party) =>
    `${party.name ?? ''} ${party.type} ${party.email ?? ''} ${party.docNumber ?? ''}`}
  onPick={pick}
  selectionMode="single"
  {columnsConfigurable}
  initialSearch={q}
  searchPlaceholder={placeholder}
  storageKey={pickerKey}
  create={canCreate
    ? {
        label: m.party_picker_new(),
        tabLabel: m.party_picker_new(),
        form: createPartyForm,
      }
    : undefined}
/>

<style>
  .party-picker {
    min-width: 0;
    flex: 1;
  }
  .party-field {
    position: relative;
  }
  .party-field :global(.party-input) {
    padding-right: calc(var(--control-height-xs) * 2 + var(--space-2));
  }
  .party-controls {
    position: absolute;
    right: var(--space-1);
    bottom: 0;
    display: flex;
    height: var(--control-height-sm);
    align-items: center;
    gap: var(--space-0-5);
  }
  .party-menu {
    position: absolute;
    top: calc(100% + var(--space-1));
    right: 0;
    left: 0;
    max-height: calc(var(--control-height-touch) * 6);
    overflow: auto;
    margin: 0;
    padding: var(--space-1);
    list-style: none;
    color: var(--color-text-primary);
    background: var(--color-overlay);
    border: 1px solid var(--color-border-strong);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-overlay);
    z-index: var(--layer-popover);
  }
  .party-menu li :global([data-part='button']) {
    width: 100%;
    justify-content: flex-start;
    text-align: left;
  }
  .party-menu li :global([data-part='button'] > span) {
    width: 100%;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--space-0-5);
  }
  .party-name {
    color: var(--color-text-primary);
    font-size: var(--font-size-body);
    font-weight: var(--font-weight-medium);
  }
  .party-meta {
    color: var(--color-text-tertiary);
    font-size: var(--font-size-caption);
  }
  .doc-name {
    display: inline-flex;
    flex-direction: row;
    align-items: center;
    gap: var(--space-1);
    color: var(--color-accent);
  }
  .doc-error {
    color: var(--color-danger-fg);
  }
  .party-menu li :global(.doc-row) {
    border-top: 1px solid var(--color-border-subtle);
  }
</style>
