<script lang="ts">
  import { Button, Input, Select } from '$lib/components/ui';
  import * as m from '$lib/paraglide/messages';
  import { classifyIdentityDoc, type CreatablePartyType, type PartyOption } from './party-picker';
  import { registerForm } from '$lib/assistant/forms';
  import { PARTY_FORM } from '$lib/assistant/catalog';

  let {
    allowedTypes,
    oncreated,
    oncancel,
    initialName = '',
  }: {
    allowedTypes: CreatablePartyType[];
    oncreated: (party: PartyOption) => void;
    oncancel: () => void;
    initialName?: string;
  } = $props();

  interface RucCompany {
    legalName: string;
    tradeName: string | null;
    companyType: string | null;
    address: string | null;
    active: boolean;
  }

  // svelte-ignore state_referenced_locally -- form seeds are intentionally one-shot
  const seededDoc = classifyIdentityDoc(initialName);
  // svelte-ignore state_referenced_locally -- form seeds are intentionally one-shot
  let type = $state<CreatablePartyType>(
    seededDoc === 'ruc' && allowedTypes.includes('company')
      ? 'company'
      : (allowedTypes[0] ?? 'person'),
  );
  // A picker query that is itself a document number seeds the document, not the name.
  // svelte-ignore state_referenced_locally -- form seeds are intentionally one-shot
  let name = $state(seededDoc ? '' : initialName);
  let phone = $state('');
  let email = $state('');
  // svelte-ignore state_referenced_locally -- document default follows the one-shot type seed
  let docType = $state(type === 'company' ? 'RUC' : 'DNI');
  // svelte-ignore state_referenced_locally -- form seeds are intentionally one-shot
  let docNumber = $state(seededDoc ? initialName.replace(/\D/g, '') : '');
  let busy = $state(false);
  let createError = $state<string | null>(null);

  // Company mode is RUC-first (owner rule: every business is SUNAT-verified):
  // the 11 digits fetch the registry record, which fills the name; only phone
  // and email stay hand-typed. The server re-verifies at create.
  const isCompany = $derived(type === 'company');
  const ruc = $derived(docNumber.replace(/\D/g, ''));
  let registry = $state<RucCompany | null>(null);
  let lookupBusy = $state(false);
  let lookupError = $state<string | null>(null);

  // Explicit search (owner ask 2026-09-18: "the sunat autofill should trigger
  // with a search button instead of auto-triggering. This saves on
  // unnecessary/unwanted queries.") — every registry call is metered.
  async function lookupRuc() {
    if (lookupBusy || ruc.length !== 11) return;
    lookupBusy = true;
    lookupError = null;
    try {
      const res = await fetch('/api/crm/ruc-lookup', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ruc }),
      });
      if (!res.ok) throw new Error(String(res.status));
      const j = (await res.json()) as ({ found: true } & RucCompany) | { found: false };
      if (j.found) {
        registry = j;
        name = j.legalName;
      } else {
        lookupError = m.pos_customer_ruc_unverified();
      }
    } catch {
      lookupError = m.pos_customer_dni_lookup_failed();
    } finally {
      lookupBusy = false;
    }
  }

  // Any change to the digits invalidates what SUNAT said about the old ones.
  $effect(() => {
    void ruc;
    void isCompany;
    registry = null;
    lookupError = null;
  });

  const valid = $derived(
    allowedTypes.includes(type) && (isCompany ? registry !== null : name.trim() !== ''),
  );

  function changeType(value: string | number) {
    const next = value === 'company' ? 'company' : 'person';
    type = next;
    if (docType === 'DNI' || docType === 'RUC') docType = next === 'company' ? 'RUC' : 'DNI';
  }

  function onRucInput() {
    docNumber = docNumber.replace(/\D/g, '').slice(0, 11);
  }

  // Assistant `fill_party` tool — registered for as long as this form is
  // mounted (PartyPicker create tab, /crm/customers?new=1). Never submits.
  $effect(() => {
    const str = (x: unknown) => (x == null ? '' : String(x)).trim();
    return registerForm({
      def: PARTY_FORM,
      get: () => ({ name, type, phone, email, docNumber }),
      set: (v) => {
        const filled: string[] = [];
        const rejected: { key: string; reason: string }[] = [];
        // `type` first so docType (DNI ↔ RUC) is settled before docNumber lands.
        if ('type' in v) {
          const t = str(v.type);
          if (allowedTypes.includes(t as CreatablePartyType)) {
            changeType(t);
            filled.push('type');
          } else {
            rejected.push({ key: 'type', reason: `allowed: ${allowedTypes.join(', ')}` });
          }
        }
        for (const key of ['name', 'phone', 'email', 'docNumber'] as const) {
          if (!(key in v)) continue;
          const val = str(v[key]);
          if (key === 'name') {
            if (isCompany) {
              rejected.push({ key, reason: 'company name is filled from the SUNAT registry' });
              continue;
            }
            name = val;
          } else if (key === 'phone') phone = val;
          else if (key === 'email') email = val;
          else docNumber = val;
          filled.push(key);
        }
        return { filled, rejected };
      },
    });
  });

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    if (!valid || busy) return;
    busy = true;
    createError = null;
    try {
      const response = await fetch('/api/crm/parties', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          type,
          name: name.trim(),
          phone: phone.trim() || null,
          email: email.trim() || null,
          docType: docNumber.trim() ? docType.trim() || null : null,
          docNumber: docNumber.trim() || null,
        }),
      });
      if (!response.ok) {
        const failure = (await response.json().catch(() => null)) as { code?: string } | null;
        createError =
          failure?.code === 'ruc_not_found'
            ? m.party_picker_ruc_not_found()
            : m.party_picker_create_failed();
        return;
      }
      const payload = (await response.json()) as {
        party: {
          id: string;
          name: string | null;
          phone9?: string | null;
          docNumber?: string | null;
        };
      };
      oncreated({
        id: payload.party.id,
        name: payload.party.name ?? name.trim(),
        type,
        email: email.trim() || null,
        docNumber: payload.party.docNumber ?? (docNumber.trim() || null),
        phone9: payload.party.phone9 ?? null,
      });
    } catch {
      createError = m.party_picker_create_failed();
    } finally {
      busy = false;
    }
  }
</script>

<form class="party-create" onsubmit={submit}>
  <div class="party-fields">
    {#if allowedTypes.length > 1}
      <Select
        size="sm"
        label={m.party_picker_type()}
        value={type}
        options={allowedTypes.map((value) => ({
          value,
          label: value === 'company' ? m.party_picker_type_company() : m.party_picker_type_person(),
        }))}
        onchange={changeType}
        data-assist="party.type"
      />
    {/if}
    {#if isCompany}
      <div class="party-ruc-row">
        <Input
          size="sm"
          inputmode="numeric"
          autocomplete="off"
          label={m.party_picker_ruc_label()}
          placeholder={m.party_picker_ruc_ph()}
          helper={lookupBusy ? m.pos_customer_dni_searching() : undefined}
          error={lookupError ?? undefined}
          required
          bind:value={docNumber}
          oninput={onRucInput}
          onkeydown={(e: KeyboardEvent) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void lookupRuc();
            }
          }}
          data-assist="party.docNumber"
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          loading={lookupBusy}
          disabled={ruc.length !== 11}
          onclick={lookupRuc}
        >
          {m.pos_customer_dni_find()}
        </Button>
      </div>
      <div class="party-registry" class:party-registry-empty={!registry} data-assist="party.name">
        {#if registry}
          <span class="t-caption party-registry-label">{m.crm_dni_found()}</span>
          <strong class="t-body">{registry.legalName}</strong>
          {#if registry.tradeName && registry.tradeName !== registry.legalName}
            <span class="t-caption">{registry.tradeName}</span>
          {/if}
          {#if registry.address}<span class="t-caption">{registry.address}</span>{/if}
          {#if !registry.active}
            <span class="t-caption party-registry-warn">{m.party_picker_ruc_inactive()}</span>
          {/if}
        {:else}
          <span class="t-caption">{m.party_picker_ruc_autofill_hint()}</span>
        {/if}
      </div>
    {:else}
      <Input
        size="sm"
        label={m.party_picker_name()}
        required
        bind:value={name}
        data-assist="party.name"
      />
      {#if allowedTypes.length === 1}<div></div>{/if}
    {/if}
    <Input
      size="sm"
      type="tel"
      label={m.party_picker_phone()}
      bind:value={phone}
      data-assist="party.phone"
    />
    <Input
      size="sm"
      type="email"
      label={m.party_picker_email()}
      bind:value={email}
      data-assist="party.email"
    />
    {#if !isCompany}
      <Input size="sm" label={m.party_picker_document_type()} bind:value={docType} />
      <Input
        size="sm"
        label={m.party_picker_document_number()}
        bind:value={docNumber}
        data-assist="party.docNumber"
      />
    {/if}
  </div>
  {#if createError}<p class="party-error t-caption" role="alert">{createError}</p>{/if}
  <div class="party-actions">
    <Button type="button" variant="outline" size="sm" onclick={oncancel}>
      {m.common_cancel()}
    </Button>
    <Button
      type="submit"
      variant="primary"
      size="sm"
      loading={busy}
      disabled={!valid}
      data-assist="party.submit"
    >
      {m.party_picker_create()}
    </Button>
  </div>
</form>

<style>
  .party-create {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }
  .party-fields {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--space-3);
  }
  .party-ruc-row {
    display: flex;
    align-items: flex-end;
    gap: var(--space-2);
    min-width: 0;
  }
  .party-ruc-row :global([data-part='field']) {
    flex: 1;
    min-width: 0;
  }
  .party-registry {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-md);
    background: var(--color-surface-2);
    color: var(--color-text-primary);
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .party-registry-empty,
  .party-registry-label {
    color: var(--color-text-secondary);
  }
  .party-registry-warn {
    color: var(--color-warning-fg);
  }
  .party-actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-2);
    padding-top: var(--space-3);
    border-top: 1px solid var(--color-border-subtle);
  }
  .party-error {
    color: var(--color-danger-fg);
  }
  @media (max-width: 47.99875rem) {
    .party-fields {
      grid-template-columns: minmax(0, 1fr);
    }
  }
</style>
